import {
  addTodo,
  completeTodo,
  FileLockedError,
  listTags,
  listTodos,
  NewTodoSchema,
  reopenTodo,
  TodoChangeSchema,
  TodoInputError,
  TodoNotFoundError,
  TodosFileError,
  updateTodo,
  type TodoOptions,
} from '@ostraka/core'
import { Hono, type Context } from 'hono'

type Schema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } }
}

function onTodoError(error: Error, c: Context) {
  if (error instanceof TodoNotFoundError) return c.json({ error: error.message }, 404)
  if (error instanceof TodoInputError) return c.json({ error: error.message }, 400)
  // The file is broken or another writer holds it: the request conflicts with the file's current state.
  if (error instanceof TodosFileError || error instanceof FileLockedError) return c.json({ error: error.message }, 409)
  throw error
}

/** The JSON body checked against `schema`, or the 400 answer naming what's wrong. */
async function body<T>(c: Context, schema: Schema<T>): Promise<{ data: T } | { answer: Response }> {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined))
  if (parsed.success) return { data: parsed.data }
  return { answer: c.json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') }, 400) }
}

/** `/api/todos`: list open Todos, add one, change one, mark one done, reopen one (Undo). All writes go through core. */
export function todoRoutes(options: TodoOptions) {
  const routes = new Hono()
  routes.onError(onTodoError)

  routes.get('/', async (c) => c.json(await listTodos(options)))

  routes.post('/', async (c) => {
    const input = await body(c, NewTodoSchema)
    if ('answer' in input) return input.answer
    return c.json(await addTodo(input.data, options), 201)
  })

  routes.patch('/:id', async (c) => {
    const change = await body(c, TodoChangeSchema)
    if ('answer' in change) return change.answer
    return c.json(await updateTodo(c.req.param('id'), change.data, options))
  })

  routes.post('/:id/done', async (c) => c.json(await completeTodo(c.req.param('id'), options)))
  routes.post('/:id/reopen', async (c) => c.json(await reopenTodo(c.req.param('id'), options)))

  return routes
}

/** `/api/tags`: the Tags in use, for suggestions. */
export function tagRoutes(options: TodoOptions) {
  const routes = new Hono()
  routes.onError(onTodoError)
  routes.get('/', async (c) => c.json(await listTags(options)))
  return routes
}
