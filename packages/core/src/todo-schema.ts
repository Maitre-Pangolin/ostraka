// The `todos.json` format. Imports only zod, so the web app can share these types.
import { z } from 'zod'

export const PRIORITIES = ['high', 'medium', 'low', 'none'] as const
export const TODO_STATUSES = ['open', 'done', 'dropped'] as const

const isRealDay = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(day)
}

const fields = {
  id: z.string().regex(/^[a-z0-9]{5}$/, 'Expected a 5-character id of a-z and 0-9'),
  title: z.string().trim().min(1, 'A Todo needs a title'),
  description: z.string().optional(),
  priority: z.enum(PRIORITIES),
  /** Day only, local: YYYY-MM-DD. */
  due: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a day as YYYY-MM-DD')
    .refine(isRealDay, 'Not a real day')
    .optional(),
  tags: z.array(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Tags are lowercase and hyphenated')),
  status: z.enum(TODO_STATUSES),
  dropReason: z.string().optional(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().optional(),
}

export const SubTodoSchema = z.strictObject(fields)

export const TodoSchema = z.strictObject({
  ...fields,
  /** One level only: Sub-todos have no Sub-todos of their own. Kept in creation order. */
  subTodos: z.array(SubTodoSchema),
})

export const TodosFileSchema = z.strictObject({ todos: z.array(TodoSchema) })

export type Priority = (typeof PRIORITIES)[number]
export type TodoStatus = (typeof TODO_STATUSES)[number]
export type SubTodo = z.infer<typeof SubTodoSchema>
export type Todo = z.infer<typeof TodoSchema>
export type TodosFile = z.infer<typeof TodosFileSchema>

/** What adding a Todo takes. Quick-entry tokens come later; for now the title is kept as typed. */
export const NewTodoSchema = z.strictObject({ title: fields.title })
export type NewTodo = z.infer<typeof NewTodoSchema>

// Every key in its place, so a write never reorders what an agent or git diff sees.
function ordered(todo: SubTodo): SubTodo {
  return {
    id: todo.id,
    title: todo.title,
    ...(todo.description !== undefined && { description: todo.description }),
    priority: todo.priority,
    ...(todo.due !== undefined && { due: todo.due }),
    tags: todo.tags,
    status: todo.status,
    ...(todo.dropReason !== undefined && { dropReason: todo.dropReason }),
    createdAt: todo.createdAt,
    ...(todo.finishedAt !== undefined && { finishedAt: todo.finishedAt }),
  }
}

/** `todos.json` text: two-space indent, stable key order, trailing newline. */
export function formatTodosFile(file: TodosFile): string {
  const todos = file.todos.map((todo) => ({ ...ordered(todo), subTodos: todo.subTodos.map(ordered) }))
  return `${JSON.stringify({ todos }, null, 2)}\n`
}
