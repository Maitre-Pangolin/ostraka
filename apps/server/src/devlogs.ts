import {
  DevlogChangeSchema,
  FileLockedError,
  isBrokenDevlog,
  listDevlogs,
  MarkdownFileError,
  MarkdownFileNotFoundError,
  readDevlog,
  readDevlogsBetween,
  StaleVersionError,
  updateDevlog,
  type DevlogOptions,
} from '@ostraka/core'
import { Hono, type Context } from 'hono'
import { readBody } from './todos.ts'
import { loadedVersion } from './versions.ts'

function onDevlogError(error: Error, c: Context) {
  if (error instanceof MarkdownFileNotFoundError) return c.json({ error: error.message }, 404)
  if (error instanceof StaleVersionError) return c.json({ error: error.message }, 412)
  // The file's header is broken, or another writer holds the file.
  if (error instanceof MarkdownFileError || error instanceof FileLockedError) return c.json({ error: error.message }, 409)
  throw error
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * `/api/devlogs`: list the days and monthly summaries (a broken file with its error), read the days of a date range
 * with their bodies, open one, and change one's body. Each answered carries its `version`; a change sent with
 * `If-Match` is refused (412) if the file changed since. The header is the Dev log skill's: the app never writes it.
 */
export function devlogRoutes(options: DevlogOptions) {
  const routes = new Hono()
  routes.onError(onDevlogError)

  routes.get('/', async (c) => c.json(await listDevlogs(options)))

  routes.get('/days', async (c) => {
    const { from, to } = c.req.query()
    if (!from || !to || !DAY.test(from) || !DAY.test(to)) return c.json({ error: 'Expected ?from=YYYY-MM-DD&to=YYYY-MM-DD' }, 400)
    return c.json(await readDevlogsBetween({ from, to }, options))
  })

  routes.get('/:id', async (c) => {
    const log = await readDevlog(c.req.param('id'), options)
    if (isBrokenDevlog(log)) return c.json({ error: log.error }, 409)
    return c.json(log)
  })

  routes.patch('/:id', async (c) => {
    const body = await readBody(c, DevlogChangeSchema)
    if (!body.ok) return body.response
    return c.json(await updateDevlog(c.req.param('id'), body.data, { ...options, ifVersion: loadedVersion(c) }))
  })

  return routes
}
