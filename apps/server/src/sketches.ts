import {
  createSketch,
  FileLockedError,
  isBrokenSketch,
  listSketches,
  MarkdownFileError,
  MarkdownFileNotFoundError,
  NewSketchSchema,
  readSketch,
  SketchChangeSchema,
  StaleVersionError,
  updateSketch,
  type SketchOptions,
} from '@ostraka/core'
import { Hono, type Context } from 'hono'
import { readBody } from './todos.ts'
import { loadedVersion } from './versions.ts'

function onSketchError(error: Error, c: Context) {
  if (error instanceof MarkdownFileNotFoundError) return c.json({ error: error.message }, 404)
  if (error instanceof StaleVersionError) return c.json({ error: error.message }, 412)
  // The file's header or Mermaid block is broken, or another writer holds the file.
  if (error instanceof MarkdownFileError || error instanceof FileLockedError) return c.json({ error: error.message }, 409)
  throw error
}

/**
 * `/api/sketches`: list Sketches by title and Tags (a broken one with its error; `?tag=` narrows), open one with its
 * Mermaid text, start one, and change its Mermaid text, title or Tags. Every Sketch answered carries its `version`;
 * a change sent with `If-Match` is refused (412) if the file changed since. All writes go through core.
 */
export function sketchRoutes(options: SketchOptions) {
  const routes = new Hono()
  routes.onError(onSketchError)

  routes.get('/', async (c) => c.json(await listSketches({ ...options, tag: c.req.query('tag') })))

  routes.get('/:id', async (c) => {
    const sketch = await readSketch(c.req.param('id'), options)
    if (isBrokenSketch(sketch)) return c.json({ error: sketch.error }, 409)
    return c.json(sketch)
  })

  routes.post('/', async (c) => {
    const body = await readBody(c, NewSketchSchema, {})
    if (!body.ok) return body.response
    return c.json(await createSketch(body.data, options), 201)
  })

  routes.patch('/:id', async (c) => {
    const body = await readBody(c, SketchChangeSchema)
    if (!body.ok) return body.response
    return c.json(await updateSketch(c.req.param('id'), body.data, { ...options, ifVersion: loadedVersion(c) }))
  })

  return routes
}
