import {
  deleteTag,
  FileLockedError,
  listTags,
  mergeTag,
  MergeTagSchema,
  renameTag,
  RenameTagSchema,
  setTagColor,
  TagColorChangeSchema,
  TagExistsError,
  TagNameError,
  TagNotFoundError,
  TagsFileError,
  tagUsage,
  TodosFileError,
  type ContentOptions,
} from '@ostraka/core'
import { Hono, type Context } from 'hono'
import { readBody } from './todos.ts'

function onTagError(error: Error, c: Context) {
  if (error instanceof TagNameError) return c.json({ error: error.message }, 400)
  if (error instanceof TagNotFoundError) return c.json({ error: error.message }, 404)
  // A rename onto a Tag in use, a broken todos.json or tags.yml, or another writer holding a file.
  const conflict = error instanceof TagExistsError || error instanceof TagsFileError || error instanceof TodosFileError
  if (conflict || error instanceof FileLockedError) return c.json({ error: error.message }, 409)
  throw error
}

/**
 * `/api/tags`: the Tags in use by Todos, Notes, Dev logs and Sketches with their colours (for suggestions, pills and
 * the Tag filter), and Tag management: usage counts, rename, merge and delete (each rewriting every item using the
 * Tag in one request) and colour (saved to `tags.yml`). All through core.
 */
export function tagRoutes(options: ContentOptions) {
  const routes = new Hono()
  routes.onError(onTagError)
  routes.get('/', async (c) => c.json(await listTags(options)))
  routes.get('/usage', async (c) => c.json(await tagUsage(options)))

  routes.post('/:name/rename', async (c) => {
    const body = await readBody(c, RenameTagSchema)
    if (!body.ok) return body.response
    return c.json(await renameTag(c.req.param('name'), body.data.to, options))
  })

  routes.post('/:name/merge', async (c) => {
    const body = await readBody(c, MergeTagSchema)
    if (!body.ok) return body.response
    return c.json(await mergeTag(c.req.param('name'), body.data.into, options))
  })

  routes.delete('/:name', async (c) => c.json(await deleteTag(c.req.param('name'), options)))

  routes.put('/:name/color', async (c) => {
    const body = await readBody(c, TagColorChangeSchema)
    if (!body.ok) return body.response
    await setTagColor(c.req.param('name'), body.data.color ?? undefined, options)
    return c.body(null, 204)
  })

  return routes
}
