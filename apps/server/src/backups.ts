// The top bar's backup warning, computed from the content repo alone. Nothing in the server talks to the remote:
// `ostraka backup` pushes, from the CLI, outside the app.
import { backupState, type ContentOptions } from '@ostraka/core'
import { Hono } from 'hono'

const errorJson = (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) })

/**
 * `GET /api/backup`: the backup state (`BackupState`), with no network: Snapshots not on `origin/<branch>` as last
 * pushed or fetched, how long they have waited, and the content files over 10 MB.
 */
export function backupRoutes(content: ContentOptions) {
  const routes = new Hono()
  routes.get('/', async (c) => {
    try {
      return c.json(await backupState({ env: content.env, homeDir: content.homeDir, now: content.now }))
    } catch (error) {
      return c.json(errorJson(error), 500)
    }
  })
  return routes
}
