import { randomInt } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { contentPath } from './content-path.ts'
import type { ContentRootOptions } from './content-root.ts'
import { withFileLock, writeFileAtomic, type LockOptions } from './locked-file.ts'
import { compareOpenTodos, localDay } from './todo-order.ts'
import {
  formatTodosFile,
  NewTodoSchema,
  TodoChangeSchema,
  TodosFileSchema,
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

const clock = (options: TodoOptions) => (options.now ?? (() => new Date()))()

export class TodosFileError extends Error {}
export class TodoNotFoundError extends Error {}
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

// Top-level Todos only until Sub-todos arrive with their own finishing rules.
function findTodo(file: TodosFile, id: string): Todo {
  const todo = file.todos.find((candidate) => candidate.id === id)
  if (!todo) throw new TodoNotFoundError(`No Todo with id ${id}`)
  return todo
}

/** Marks a Todo done and sets its finished timestamp. */
export async function completeTodo(id: string, options: TodoOptions = {}): Promise<Todo> {
  const now = clock(options)
  return updateTodos(options, (file) => {
    const todo = findTodo(file, id)
    todo.status = 'done'
    todo.finishedAt = now.toISOString()
    delete todo.dropReason
    return structuredClone(todo)
  })
}

/** Puts a done or Dropped Todo back on the open list, clearing its finished timestamp (Undo). */
export async function reopenTodo(id: string, options: TodoOptions = {}): Promise<Todo> {
  return updateTodos(options, (file) => {
    const todo = findTodo(file, id)
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
export async function updateTodo(id: string, input: TodoChange, options: TodoOptions = {}): Promise<Todo> {
  const change = TodoChangeSchema.parse(input)
  const today = localDay(clock(options))
  return updateTodos(options, (file) => {
    const todo = findTodo(file, id)
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

/** Every Tag in use in `todos.json`, once each, sorted: open, done and Dropped Todos and their Sub-todos. */
export async function listTags(options: TodoOptions = {}): Promise<string[]> {
  const { todos } = await readTodosFile(await contentPath('todos', options))
  const tags = new Set(todos.flatMap((todo) => [todo, ...todo.subTodos]).flatMap((todo) => todo.tags))
  return [...tags].toSorted()
}

/** Open Todos in their automatic order. */
export async function listTodos(options: TodoOptions = {}): Promise<Todo[]> {
  const { todos } = await readTodosFile(await contentPath('todos', options))
  const today = localDay(clock(options))
  return todos.filter((todo) => todo.status === 'open').toSorted(compareOpenTodos(today))
}
