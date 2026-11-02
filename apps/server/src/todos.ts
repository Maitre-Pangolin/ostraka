import {
  addTodo,
  completeTodo,
  deleteTodo,
  dropTodo,
  DropTodoSchema,
  FileLockedError,
  listFinishedTodos,
  listTodos,
  NewTodoSchema,
  reopenTodo,
  restoreTodo,
  TodoExistsError,
  TodoNotFoundError,
  TodoSchema,
  TodosFileError,
  type TodoOptions,
} from '@ostraka/core'
import { Hono, type Context } from 'hono'

type Schema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } }
}

/** The request body checked against one of core's schemas. A missing or unparsable body counts as `fallback`. */
async function readBody<T>(c: Context, schema: Schema<T>, fallback?: unknown) {
  const body = schema.safeParse(await c.req.json().catch(() => fallback))
  if (body.success) return { ok: true, data: body.data } as const
  return { ok: false, response: c.json({ error: body.error.issues.map((issue) => issue.message).join('; ') }, 400) } as const
}

/**
 * `/api/todos`: list open and finished Todos, add one, mark one done, Drop one, reopen one (Undo of done or Drop),
 * delete one and restore it (Undo of delete). All writes go through core.
 */
export function todoRoutes(options: TodoOptions) {
  const routes = new Hono()

  routes.onError((error, c) => {
    if (error instanceof TodoNotFoundError) return c.json({ error: error.message }, 404)
    // The file is broken, another writer holds it, or the id was taken meanwhile: it conflicts with the file's state.
    if (error instanceof TodosFileError || error instanceof FileLockedError || error instanceof TodoExistsError) {
      return c.json({ error: error.message }, 409)
    }
    throw error
  })

  routes.get('/', async (c) => c.json(await listTodos(options)))
  routes.get('/finished', async (c) => c.json(await listFinishedTodos({}, options)))

  routes.post('/', async (c) => {
    const body = await readBody(c, NewTodoSchema)
    if (!body.ok) return body.response
    return c.json(await addTodo(body.data, options), 201)
  })

  routes.post('/restore', async (c) => {
    const body = await readBody(c, TodoSchema)
    if (!body.ok) return body.response
    return c.json(await restoreTodo(body.data, options), 201)
  })

  routes.post('/:id/done', async (c) => c.json(await completeTodo(c.req.param('id'), options)))
  routes.post('/:id/reopen', async (c) => c.json(await reopenTodo(c.req.param('id'), options)))

  routes.post('/:id/drop', async (c) => {
    const body = await readBody(c, DropTodoSchema, {})
    if (!body.ok) return body.response
    return c.json(await dropTodo(c.req.param('id'), body.data, options))
  })

  routes.delete('/:id', async (c) => c.json(await deleteTodo(c.req.param('id'), options)))

  return routes
}
