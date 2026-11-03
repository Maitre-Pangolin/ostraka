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
import { readTagsFile } from './tags.ts'
import { compareFinishedTodos, compareOpenTodos, localDay } from './todo-order.ts'
import {
  DropTodoSchema,
  FinishedQuerySchema,
  formatTodosFile,
  NewTodoSchema,
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

/** Adds an open Todo at the top level. Tokens in its title and description become its properties. */
export async function addTodo(input: NewTodo, options: TodoOptions = {}): Promise<Todo> {
  const {
    title: typedTitle,
    description: typedDescription,
    tags: chosenTags = [],
    priority: chosenPriority = 'none',
    due: chosenDue,
  } = NewTodoSchema.parse(input)
  const now = clock(options)
  const chosen: Editable = {
    title: typedTitle,
    tags: chosenTags,
    priority: chosenPriority,
    ...(chosenDue !== undefined && { due: chosenDue }),
  }
  const { title, description, tags, priority, due } = applyText(chosen, { title: typedTitle, description: typedDescription }, localDay(now))
  return updateTodos(options, (file) => {
    const todo: Todo = {
      id: newId(allIds(file)),
      title,
      ...(description !== undefined && { description }),
      priority,
      ...(due !== undefined && { due }),
      tags,
      status: 'open',
      createdAt: now.toISOString(),
      subTodos: [],
    }
    file.todos.push(todo)
    return todo
  })
}

/** The version of one Todo: a hash of its text as todos.json holds it, keys in their stable order. */
export function todoVersion(todo: Todo): string {
  return contentVersion(formatTodosFile({ todos: [todo] }))
}

// Top-level Todos only until Sub-todos arrive with their own finishing rules.
function findTodo(file: TodosFile, id: string, ifVersion?: string): Todo {
  const todo = file.todos.find((candidate) => candidate.id === id)
  if (!todo) throw new TodoNotFoundError(`No Todo with id ${id}`)
  assertCurrentVersion(ifVersion, todoVersion(todo), `The Todo “${todo.title}”`)
  return todo
}

/** Marks a Todo done and sets its finished timestamp. */
export async function completeTodo(id: string, options: TodoChangeOptions = {}): Promise<Todo> {
  const now = clock(options)
  return updateTodos(options, (file) => {
    const todo = findTodo(file, id, options.ifVersion)
    todo.status = 'done'
    todo.finishedAt = now.toISOString()
    delete todo.dropReason
    return structuredClone(todo)
  })
}

/** Drops a Todo: abandoned without being done, with an optional reason, and its finished timestamp set. */
export async function dropTodo(id: string, input: DropTodo, options: TodoChangeOptions = {}): Promise<Todo> {
  const reason = DropTodoSchema.parse(input).reason?.trim()
  const now = clock(options)
  return updateTodos(options, (file) => {
    const todo = findTodo(file, id, options.ifVersion)
    todo.status = 'dropped'
    todo.finishedAt = now.toISOString()
    if (reason) todo.dropReason = reason
    else delete todo.dropReason
    return structuredClone(todo)
  })
}

/** Puts a done or Dropped Todo back on the open list, clearing its finished timestamp (Undo). */
export async function reopenTodo(id: string, options: TodoChangeOptions = {}): Promise<Todo> {
  return updateTodos(options, (file) => {
    const todo = findTodo(file, id, options.ifVersion)
    todo.status = 'open'
    delete todo.finishedAt
    delete todo.dropReason
    return structuredClone(todo)
  })
}

/**
 * Changes a Todo's title, description, Tags, priority or due date; only the fields given change. Tokens in a new
 * title or description apply to the Todo, as on add.
 */
export async function updateTodo(id: string, input: TodoChange, options: TodoChangeOptions = {}): Promise<Todo> {
  const change = TodoChangeSchema.parse(input)
  const today = localDay(clock(options))
  return updateTodos(options, (file) => {
    const todo = findTodo(file, id, options.ifVersion)
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

/** Removes a Todo for good (for mistakes) and returns it, so the caller can offer Undo through `restoreTodo`. */
export async function deleteTodo(id: string, options: TodoChangeOptions = {}): Promise<Todo> {
  return updateTodos(options, (file) => {
    const todo = findTodo(file, id, options.ifVersion)
    file.todos.splice(file.todos.indexOf(todo), 1)
    return todo
  })
}

/** Puts a deleted Todo back as it was (Undo of delete). Refused if any of its ids is taken meanwhile. */
export async function restoreTodo(input: Todo, options: TodoOptions = {}): Promise<Todo> {
  const todo = TodoSchema.parse(input)
  return updateTodos(options, (file) => {
    const taken = allIds(file)
    const clash = [todo.id, ...todo.subTodos.map((sub) => sub.id)].find((id) => taken.has(id))
    if (clash) throw new TodoExistsError(`A Todo with id ${clash} already exists`)
    file.todos.push(todo)
    return structuredClone(todo)
  })
}

/**
 * Every Tag in use, once each, sorted: on open, done and Dropped Todos and their Sub-todos, and on Notes. Each has its
 * colour from `tags.yml`, or the one its name hashes to.
 */
export async function listTags(options: TodoOptions = {}): Promise<Tag[]> {
  const { todos } = await readTodosFile(await contentPath('todos', options))
  const settings = await readTagsFile(options)
  const notes = await listNotes(options)
  const names = new Set([
    ...todos.flatMap((todo) => [todo, ...todo.subTodos]).flatMap((todo) => todo.tags),
    ...notes.flatMap((note) => ('tags' in note ? note.tags : [])),
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
