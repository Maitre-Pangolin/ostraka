import {
  addTodo,
  completeTodo,
  deleteTodo,
  dropTodo,
  DropTodoSchema,
  FileLockedError,
  listFinishedTodos,
  listTags,
  listTodos,
  NewTodoSchema,
  reopenTodo,
  restoreTodo,
  StaleVersionError,
  TodoChangeSchema,
  TodoExistsError,
  TodoInputError,
  TodoNotFoundError,
  TodoSchema,
  TodosFileError,
  todoVersion,
  updateTodo,
  type Todo,
  type TodoOptions,
} from '@ostraka/core'
import { Hono, type Context } from 'hono'
import { loadedVersion, withoutVersion, withVersion } from './versions.ts'

const versioned = (todo: Todo) => withVersion(todo, todoVersion(todo))

type Schema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } }
}

/** The request body checked against one of core's schemas. A missing or unparsable body counts as `fallback`. */
async function readBody<T>(c: Context, schema: Schema<T>, fallback?: unknown) {
  const body = schema.safeParse(await c.req.json().catch(() => fallback))
  if (body.success) return { ok: true, data: body.data } as const
  return { ok: false, response: c.json({ error: body.error.issues.map((issue) => issue.message).join('; ') }, 400) } as const
}

function onTodoError(error: Error, c: Context) {
  if (error instanceof TodoNotFoundError) return c.json({ error: error.message }, 404)
  if (error instanceof StaleVersionError) return c.json({ error: error.message }, 412)
  // Nothing left of the title once its tokens are pulled out.
  if (error instanceof TodoInputError) return c.json({ error: error.message }, 400)
  // The file is broken, another writer holds it, or the id was taken meanwhile: it conflicts with the file's state.
  if (error instanceof TodosFileError || error instanceof FileLockedError || error instanceof TodoExistsError) {
    return c.json({ error: error.message }, 409)
  }
  throw error
}

/**
 * `/api/todos`: list open and finished Todos, add one, change one, mark one done, Drop one, reopen one (Undo of done
 * or Drop), delete one and restore it (Undo of delete). All writes go through core. Every Todo answered carries its
 * `version`; a change to an existing Todo sent with `If-Match` is refused (412) if the Todo changed since.
 */
export function todoRoutes(options: TodoOptions) {
  const routes = new Hono()
  routes.onError(onTodoError)

  // Changes to an existing Todo: checked against the version the request was made from, if it names one.
  const changing = (c: Context) => ({ ...options, ifVersion: loadedVersion(c) })

  routes.get('/', async (c) => c.json((await listTodos(options)).map(versioned)))
  routes.get('/finished', async (c) => c.json((await listFinishedTodos({}, options)).map(versioned)))

  routes.post('/', async (c) => {
    const body = await readBody(c, NewTodoSchema)
    if (!body.ok) return body.response
    return c.json(versioned(await addTodo(body.data, options)), 201)
  })

  routes.patch('/:id', async (c) => {
    const body = await readBody(c, TodoChangeSchema)
    if (!body.ok) return body.response
    return c.json(versioned(await updateTodo(c.req.param('id'), body.data, changing(c))))
  })

  routes.post('/restore', async (c) => {
    const body = await readBody(c, { safeParse: (value: unknown) => TodoSchema.safeParse(withoutVersion(value)) })
    if (!body.ok) return body.response
    return c.json(versioned(await restoreTodo(body.data, options)), 201)
  })

  routes.post('/:id/done', async (c) => c.json(versioned(await completeTodo(c.req.param('id'), changing(c)))))
  routes.post('/:id/reopen', async (c) => c.json(versioned(await reopenTodo(c.req.param('id'), changing(c)))))

  routes.post('/:id/drop', async (c) => {
    const body = await readBody(c, DropTodoSchema, {})
    if (!body.ok) return body.response
    return c.json(versioned(await dropTodo(c.req.param('id'), body.data, changing(c))))
  })

  routes.delete('/:id', async (c) => c.json(versioned(await deleteTodo(c.req.param('id'), changing(c)))))

  return routes
}

/** `/api/tags`: the Tags in use, for suggestions. */
export function tagRoutes(options: TodoOptions) {
  const routes = new Hono()
  routes.onError(onTodoError)
  routes.get('/', async (c) => c.json(await listTags(options)))
  return routes
}
