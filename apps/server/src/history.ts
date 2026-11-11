import {
  ContentPathError,
  fileAtSnapshot,
  FileLockedError,
  fileHistory,
  restoreFile,
  RestoreFileSchema,
  SnapshotNotFoundError,
  type ContentRootOptions,
  type FileVersion,
} from '@ostraka/core'
import { Hono, type Context } from 'hono'
import { readBody } from './todos.ts'

function onHistoryError(error: Error, c: Context) {
  if (error instanceof ContentPathError) return c.json({ error: error.message }, 400)
  if (error instanceof SnapshotNotFoundError) return c.json({ error: error.message }, 404)
  if (error instanceof FileLockedError) return c.json({ error: error.message }, 409)
  throw error
}

/** The `?path=` of a content file, relative to the content folder (`notes/<id>.md`, `todos.json`). */
const pathOf = (c: Context) => {
  const path = c.req.query('path')
  if (!path) throw new ContentPathError('Expected ?path= naming a content file, such as todos.json or notes/<id>.md')
  return path
}

/**
 * `/api/history`: any content file's Snapshots (`?path=`), one version's text (`/:commit?path=`), and a restore of
 * one version as a new Snapshot (`POST /restore { path, commit }`). Nothing rewrites history. All through core.
 */
export function historyRoutes(options: ContentRootOptions) {
  const routes = new Hono()
  routes.onError(onHistoryError)

  routes.get('/', async (c) => c.json(await fileHistory(pathOf(c), options)))

  routes.get('/:commit', async (c) => {
    const path = pathOf(c)
    const commit = c.req.param('commit')
    return c.json({ path, commit, text: await fileAtSnapshot(path, commit, options) } satisfies FileVersion)
  })

  routes.post('/restore', async (c) => {
    const body = await readBody(c, RestoreFileSchema)
    if (!body.ok) return body.response
    return c.json(await restoreFile(body.data.path, body.data.commit, options))
  })

  return routes
}
