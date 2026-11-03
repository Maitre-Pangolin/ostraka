import {
  addSubTodo,
  addTodo,
  completeTodo,
  deleteTodo,
  dropTodo,
  DropTodoSchema,
  FileLockedError,
  listFinishedTodos,
  listTags,
  listTodos,
  TagsFileError,
  NewTodoSchema,
  reopenTodo,
  restoreSubTodo,
  restoreTodo,
  StaleVersionError,
  SubTodoSchema,
  TodoChangeSchema,
  TodoExistsError,
  TodoInputError,
  TodoNotFoundError,
  TodoSchema,
  TodosFileError,
  todoVersion,
  updateTodo,
  type SubTodo,
  type TodoItem,
  type TodoOptions,
} from '@ostraka/core'
import { Hono, type Context } from 'hono'
import { loadedVersion, withoutVersion, withVersion } from './versions.ts'

const versionedSub = (sub: SubTodo) => withVersion(sub, todoVersion(sub))

/** A Todo or Sub-todo with its version; a Todo's Sub-todos each carry their own. */
const versioned = (item: TodoItem) =>
  'subTodos' in item ? { ...withVersion(item, todoVersion(item)), subTodos: item.subTodos.map(versionedSub) } : versionedSub(item)

/** A Todo posted back as the API answered it: without its version or its Sub-todos' versions. */
function withoutVersions(value: unknown): unknown {
  const item = withoutVersion(value)
  if (typeof item !== 'object' || item === null || !('subTodos' in item) || !Array.isArray(item.subTodos)) return item
  return { ...item, subTodos: item.subTodos.map(withoutVersion) }
}

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
  const broken = error instanceof TodosFileError || error instanceof TagsFileError
  if (broken || error instanceof FileLockedError || error instanceof TodoExistsError) {
    return c.json({ error: error.message }, 409)
  }
  throw error
}

/**
 * `/api/todos`: list open and finished Todos, add one or a Sub-todo under one, change one, mark one done, Drop one,
 * reopen one (Undo of done or Drop), delete one and restore it (Undo of delete). Every action on a Todo works on a
 * Sub-todo by its id, and finishing a parent finishes its open Sub-todos. All writes go through core. Every Todo and
 * Sub-todo answered carries its own `version`; a change to an existing one sent with `If-Match` is refused (412) if it
 * changed since.
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
    const body = await readBody(c, { safeParse: (value: unknown) => TodoSchema.safeParse(withoutVersions(value)) })
    if (!body.ok) return body.response
    return c.json(versioned(await restoreTodo(body.data, options)), 201)
  })

  routes.post('/:id/sub-todos', async (c) => {
    const body = await readBody(c, NewTodoSchema)
    if (!body.ok) return body.response
    return c.json(versioned(await addSubTodo(c.req.param('id'), body.data, options)), 201)
  })

  routes.post('/:id/sub-todos/restore', async (c) => {
    const body = await readBody(c, { safeParse: (value: unknown) => SubTodoSchema.safeParse(withoutVersions(value)) })
    if (!body.ok) return body.response
    return c.json(versioned(await restoreSubTodo(c.req.param('id'), body.data, options)), 201)
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

/** `/api/tags`: the Tags in use with their colours, for suggestions, pills and the Tag filter. */
export function tagRoutes(options: TodoOptions) {
  const routes = new Hono()
  routes.onError(onTodoError)
  routes.get('/', async (c) => c.json(await listTags(options)))
  return routes
}
