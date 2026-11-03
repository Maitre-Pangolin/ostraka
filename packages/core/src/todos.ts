import { randomInt } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { contentPath } from './content-path.ts'
import { assertCurrentVersion, contentVersion } from './content-version.ts'
import type { ContentRootOptions } from './content-root.ts'
import { withFileLock, writeFileAtomic, type LockOptions } from './locked-file.ts'
import { defaultTagColor, type Tag } from './tag-color.ts'
import { listNotes } from './notes.ts'
import { listSketches } from './sketches.ts'
import { readTagsFile } from './tags.ts'
import { compareFinishedTodos, compareOpenTodos, localDay } from './todo-order.ts'
import {
  DropTodoSchema,
  FinishedQuerySchema,
  formatTodosFile,
  NewTodoSchema,
  SubTodoSchema,
  TodoChangeSchema,
  TodoSchema,
  TodosFileSchema,
  type DropTodo,
  type FinishedQuery,
  type NewTodo,
  type SubTodo,
  type Todo,
  type TodoChange,
  type TodosFile,
} from './todo-schema.ts'
import { pullTokens } from './todo-tokens.ts'

export type TodoOptions = ContentRootOptions & {
  /** The clock; tests pass a fixed one. */
  now?: () => Date
  lock?: LockOptions
}

/** For a change to an existing Todo made from a loaded copy: the `todoVersion` of that copy. */
export type TodoChangeOptions = TodoOptions & { ifVersion?: string }

const clock = (options: TodoOptions) => (options.now ?? (() => new Date()))()

export class TodosFileError extends Error {}
export class TodoNotFoundError extends Error {}
export class TodoExistsError extends Error {}
/** The Todo asked for can't be: no title left once its tokens are pulled out. */
export class TodoInputError extends Error {}

async function readTodosFile(file: string): Promise<TodosFile> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { todos: [] }
    throw error
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new TodosFileError(`Invalid ${file}: ${(error as Error).message}`)
  }
  const result = TodosFileSchema.safeParse(json)
  if (!result.success) throw new TodosFileError(`Invalid ${file}:\n${z.prettifyError(result.error)}`)
  return result.data
}

/**
 * The only way `todos.json` is written: under its lock, read and validate the current file (an invalid one is
 * refused, never overwritten), apply the change, validate the result, then write a temp file and rename it.
 */
async function updateTodos<T>(options: TodoOptions, change: (file: TodosFile) => T): Promise<T> {
  const file = await contentPath('todos', options)
  await mkdir(dirname(file), { recursive: true })
  return withFileLock(
    file,
    async () => {
      const todos = await readTodosFile(file)
      const result = change(todos)
      const checked = TodosFileSchema.safeParse(todos)
      if (!checked.success) throw new TodosFileError(`Refusing to write an invalid ${file}:\n${z.prettifyError(checked.error)}`)
      await writeFileAtomic(file, formatTodosFile(checked.data))
      return result
    },
    options.lock,
  )
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function newId(taken: Set<string>): string {
  for (;;) {
    const id = Array.from({ length: 5 }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join('')
    if (!taken.has(id)) return id
  }
}

const allIds = (file: TodosFile) => new Set(file.todos.flatMap((todo) => [todo.id, ...todo.subTodos.map((sub) => sub.id)]))

type Editable = Pick<SubTodo, 'title' | 'description' | 'tags' | 'priority' | 'due'>

/**
 * Applies newly typed text to `todo`: the tokens are pulled out of the title and description given, Tags they name
 * are added, and a priority or date replaces the one before. Throws when no title is left.
 */
function applyText(todo: Editable, typed: { title?: string; description?: string }, today: string): Editable {
  const title = typed.title === undefined ? undefined : pullTokens(typed.title, { today })
  const description = typed.description === undefined ? undefined : pullTokens(typed.description, { today })
  if (title && !title.text) throw new TodoInputError('A Todo needs a title, not only #tag, *prio or ^date')
  const result: Editable = {
    title: title?.text ?? todo.title,
    tags: [...new Set([...todo.tags, ...(title?.tags ?? []), ...(description?.tags ?? [])])],
    priority: description?.priority ?? title?.priority ?? todo.priority,
  }
  const due = description?.due ?? title?.due ?? todo.due
  if (due !== undefined) result.due = due
  const text = description ? description.text : todo.description
  if (text) result.description = text
  return result
}

/**
 * The properties of a new item from what was typed: tokens in its title and description become properties, on top
 * of those already pulled out in quick entry. Throws when no title is left.
 */
function typedProperties(input: NewTodo, now: Date): Editable {
  const { title, description, tags = [], priority = 'none', due } = NewTodoSchema.parse(input)
  const chosen: Editable = { title, tags, priority, ...(due !== undefined && { due }) }
  return applyText(chosen, { title, description }, localDay(now))
}

/** A new open item with a fresh id. */
function newItem({ title, description, tags, priority, due }: Editable, file: TodosFile, now: Date): SubTodo {
  return {
    id: newId(allIds(file)),
    title,
    ...(description !== undefined && { description }),
    priority,
    ...(due !== undefined && { due }),
    tags,
    status: 'open',
    createdAt: now.toISOString(),
  }
}

/** Adds an open Todo at the top level. Tokens in its title and description become its properties. */
export async function addTodo(input: NewTodo, options: TodoOptions = {}): Promise<Todo> {
  const now = clock(options)
  const properties = typedProperties(input, now)
  return updateTodos(options, (file) => {
    const todo: Todo = { ...newItem(properties, file, now), subTodos: [] }
    file.todos.push(todo)
    return todo
  })
}

/**
 * Adds an open Sub-todo at the end of a Todo's Sub-todos (they keep creation order). It inherits nothing from its
 * parent. A Sub-todo can't have Sub-todos of its own: one level only.
 */
export async function addSubTodo(parentId: string, input: NewTodo, options: TodoOptions = {}): Promise<SubTodo> {
  const now = clock(options)
  const properties = typedProperties(input, now)
  return updateTodos(options, (file) => {
    const found = locate(file, parentId)
    if (found.parent) throw new TodoInputError('A Sub-todo can’t have Sub-todos of its own')
    const parent = found.todo
    const sub = newItem(properties, file, now)
    parent.subTodos.push(sub)
    return structuredClone(sub)
  })
}

/** A Todo, or a Sub-todo under its parent. Both are written the same way. */
export type TodoItem = Todo | SubTodo

/**
 * The version of one Todo or Sub-todo: a hash of its own fields as todos.json holds them, keys in their stable order.
 * A parent's Sub-todos are left out, so a change to one Sub-todo never makes its parent's copy stale.
 */
export function todoVersion(item: TodoItem): string {
  return contentVersion(formatTodosFile({ todos: [{ ...item, subTodos: [] }] }))
}

/** A Todo or Sub-todo by id; a Sub-todo comes with its parent. */
type Found = { todo: Todo; parent?: undefined } | { todo: SubTodo; parent: Todo }

/** Finds a Todo or Sub-todo; with `ifVersion`, refuses it if it changed since that copy was loaded. */
function locate(file: TodosFile, id: string, ifVersion?: string): Found {
  const found = ((): Found | undefined => {
    for (const todo of file.todos) {
      if (todo.id === id) return { todo }
      const sub = todo.subTodos.find((candidate) => candidate.id === id)
      if (sub) return { todo: sub, parent: todo }
    }
  })()
  if (!found) throw new TodoNotFoundError(`No Todo with id ${id}`)
  const what = `The ${found.parent ? 'Sub-todo' : 'Todo'} “${found.todo.title}”`
  assertCurrentVersion(ifVersion, todoVersion(found.todo), what)
  return found
}

/** Done or Dropped from now on, with a reason only when Dropped for one. */
function finish(todo: SubTodo, status: 'done' | 'dropped', finishedAt: string, reason?: string) {
  todo.status = status
  todo.finishedAt = finishedAt
  if (reason) todo.dropReason = reason
  else delete todo.dropReason
}

/**
 * Finishes a Todo or Sub-todo. Finishing a parent finishes its open Sub-todos too, at the same moment, so that
 * reopening it knows which ones to bring back.
 */
function finishItem(found: Found, status: 'done' | 'dropped', now: Date, reason?: string): TodoItem {
  const { todo, parent } = found
  const finishedAt = now.toISOString()
  if (!parent) for (const sub of todo.subTodos) if (sub.status === 'open') finish(sub, status, finishedAt, reason)
  finish(todo, status, finishedAt, reason)
  return structuredClone(todo)
}

/** Marks a Todo or Sub-todo done and sets its finished timestamp. A parent's open Sub-todos are marked done with it. */
export async function completeTodo(id: string, options: TodoChangeOptions = {}): Promise<TodoItem> {
  const now = clock(options)
  return updateTodos(options, (file) => finishItem(locate(file, id, options.ifVersion), 'done', now))
}

/**
 * Drops a Todo or Sub-todo: abandoned without being done, with an optional reason, and its finished timestamp set.
 * A parent's open Sub-todos are Dropped with it, for the same reason.
 */
export async function dropTodo(id: string, input: DropTodo, options: TodoChangeOptions = {}): Promise<TodoItem> {
  const reason = DropTodoSchema.parse(input).reason?.trim()
  const now = clock(options)
  return updateTodos(options, (file) => finishItem(locate(file, id, options.ifVersion), 'dropped', now, reason))
}

const reopen = (todo: SubTodo) => {
  todo.status = 'open'
  delete todo.finishedAt
  delete todo.dropReason
}

/**
 * Puts a done or Dropped Todo or Sub-todo back on the open list, clearing its finished timestamp (Undo). A parent
 * brings back the Sub-todos it finished; those finished before it stay finished.
 */
export async function reopenTodo(id: string, options: TodoChangeOptions = {}): Promise<TodoItem> {
  return updateTodos(options, (file) => {
    const { todo, parent } = locate(file, id, options.ifVersion)
    if (!parent && todo.finishedAt) {
      for (const sub of todo.subTodos) if (sub.finishedAt === todo.finishedAt) reopen(sub)
    }
    reopen(todo)
    return structuredClone(todo)
  })
}

/**
 * Changes a Todo's or Sub-todo's title, description, Tags, priority or due date; only the fields given change.
 * Tokens in a new title or description apply to it, as on add.
 */
export async function updateTodo(id: string, input: TodoChange, options: TodoChangeOptions = {}): Promise<TodoItem> {
  const change = TodoChangeSchema.parse(input)
  const today = localDay(clock(options))
  return updateTodos(options, (file) => {
    const { todo } = locate(file, id, options.ifVersion)
    const chosen: Editable = {
      title: todo.title,
      description: todo.description,
      tags: change.tags ?? todo.tags,
      priority: change.priority ?? todo.priority,
      due: change.due === null ? undefined : (change.due ?? todo.due),
    }
    const next = applyText(chosen, { title: change.title, description: change.description }, today)
    todo.title = next.title
    todo.tags = next.tags
    todo.priority = next.priority
    for (const key of ['description', 'due'] as const) {
      if (next[key] === undefined) delete todo[key]
      else todo[key] = next[key]
    }
    return structuredClone(todo)
  })
}

/**
 * Removes a Todo (with its Sub-todos) or a Sub-todo for good (for mistakes) and returns it, so the caller can offer
 * Undo through `restoreTodo` or `restoreSubTodo`.
 */
export async function deleteTodo(id: string, options: TodoChangeOptions = {}): Promise<TodoItem> {
  return updateTodos(options, (file) => {
    const { todo, parent } = locate(file, id, options.ifVersion)
    if (parent) parent.subTodos.splice(parent.subTodos.indexOf(todo), 1)
    else file.todos.splice(file.todos.indexOf(todo), 1)
    return todo
  })
}

const refuseTaken = (file: TodosFile, ids: string[]) => {
  const taken = allIds(file)
  const clash = ids.find((id) => taken.has(id))
  if (clash) throw new TodoExistsError(`A Todo with id ${clash} already exists`)
}

/** Puts a deleted Todo back as it was (Undo of delete). Refused if any of its ids is taken meanwhile. */
export async function restoreTodo(input: Todo, options: TodoOptions = {}): Promise<Todo> {
  const todo = TodoSchema.parse(input)
  return updateTodos(options, (file) => {
    refuseTaken(file, [todo.id, ...todo.subTodos.map((sub) => sub.id)])
    file.todos.push(todo)
    return structuredClone(todo)
  })
}

/**
 * Puts a deleted Sub-todo back under its parent as it was, in its creation place (Undo of delete). Refused if its id
 * is taken meanwhile.
 */
export async function restoreSubTodo(parentId: string, input: SubTodo, options: TodoOptions = {}): Promise<SubTodo> {
  const sub = SubTodoSchema.parse(input)
  return updateTodos(options, (file) => {
    const found = locate(file, parentId)
    if (found.parent) throw new TodoInputError('A Sub-todo can’t have Sub-todos of its own')
    refuseTaken(file, [sub.id])
    const subTodos = found.todo.subTodos
    const after = subTodos.findIndex((other) => other.createdAt > sub.createdAt)
    subTodos.splice(after === -1 ? subTodos.length : after, 0, sub)
    return structuredClone(sub)
  })
}

/**
 * Every Tag in use, once each, sorted: on open, done and Dropped Todos and their Sub-todos, on Notes and on Sketches. Each has its
 * colour from `tags.yml`, or the one its name hashes to.
 */
export async function listTags(options: TodoOptions = {}): Promise<Tag[]> {
  const { todos } = await readTodosFile(await contentPath('todos', options))
  const settings = await readTagsFile(options)
  const [notes, sketches] = await Promise.all([listNotes(options), listSketches(options)])
  const names = new Set([
    ...todos.flatMap((todo) => [todo, ...todo.subTodos]).flatMap((todo) => todo.tags),
    ...[...notes, ...sketches].flatMap((item) => ('tags' in item ? item.tags : [])),
  ])
  return [...names].toSorted().map((name) => ({ name, color: settings[name]?.color ?? defaultTagColor(name) }))
}

/** Open Todos in their automatic order. */
export async function listTodos(options: TodoOptions = {}): Promise<Todo[]> {
  const { todos } = await readTodosFile(await contentPath('todos', options))
  const today = localDay(clock(options))
  return todos.filter((todo) => todo.status === 'open').toSorted(compareOpenTodos(today))
}

/** Done and Dropped Todos, kept forever, newest-finished first; `finishedOn` narrows to one local day. */
export async function listFinishedTodos(query: FinishedQuery, options: TodoOptions = {}): Promise<Todo[]> {
  const { finishedOn } = FinishedQuerySchema.parse(query)
  const { todos } = await readTodosFile(await contentPath('todos', options))
  return todos
    .filter((todo) => todo.status !== 'open' && todo.finishedAt !== undefined)
    .filter((todo) => finishedOn === undefined || localDay(new Date(todo.finishedAt!)) === finishedOn)
    .toSorted(compareFinishedTodos)
}
