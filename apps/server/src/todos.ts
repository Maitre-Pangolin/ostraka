import {
  addTodo,
  completeTodo,
  FileLockedError,
  listTodos,
  NewTodoSchema,
  reopenTodo,
  StaleVersionError,
  TodoNotFoundError,
  TodosFileError,
  todoVersion,
  type Todo,
  type TodoOptions,
} from '@ostraka/core'
import { Hono } from 'hono'
import { loadedVersion, withVersion } from './versions.ts'

const versioned = (todo: Todo) => withVersion(todo, todoVersion(todo))

/**
 * `/api/todos`: list open Todos, add one, mark one done, reopen one (Undo). All writes go through core. Every Todo
 * answered carries its `version`; a change sent with `If-Match` is refused (412) if the Todo changed since.
 */
export function todoRoutes(options: TodoOptions) {
  const routes = new Hono()

  routes.onError((error, c) => {
    if (error instanceof TodoNotFoundError) return c.json({ error: error.message }, 404)
    if (error instanceof StaleVersionError) return c.json({ error: error.message }, 412)
    // The file is broken or another writer holds it: the request conflicts with the file's current state.
    if (error instanceof TodosFileError || error instanceof FileLockedError) return c.json({ error: error.message }, 409)
    throw error
  })

  routes.get('/', async (c) => c.json((await listTodos(options)).map(versioned)))

  routes.post('/', async (c) => {
    const body = NewTodoSchema.safeParse(await c.req.json().catch(() => undefined))
    if (!body.success) return c.json({ error: body.error.issues.map((issue) => issue.message).join('; ') }, 400)
    return c.json(versioned(await addTodo(body.data, options)), 201)
  })

  routes.post('/:id/done', async (c) =>
    c.json(versioned(await completeTodo(c.req.param('id'), { ...options, ifVersion: loadedVersion(c) }))),
  )
  routes.post('/:id/reopen', async (c) =>
    c.json(versioned(await reopenTodo(c.req.param('id'), { ...options, ifVersion: loadedVersion(c) }))),
  )

  return routes
}
