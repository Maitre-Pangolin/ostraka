import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import type { ContentOptions } from '@ostraka/core'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { activityPoller, type Activity } from './activity/poller.ts'
import { activityRoutes } from './activity/routes.ts'
import { backupRoutes } from './backups.ts'
import { contentEvents, type ContentEvents } from './content-events.ts'
import type { Credentials } from './keychain.ts'
import { devlogRoutes } from './devlogs.ts'
import { historyRoutes } from './history.ts'
import { noteRoutes } from './notes.ts'
import { peopleRoutes } from './people.ts'
import { noReferenceLookup, referenceRoutes, type ReferenceLookup } from './references.ts'
import { searchRoutes, throwawaySearch, type Search } from './search.ts'
import { settingsRoutes } from './settings.ts'
import { sketchRoutes } from './sketches.ts'
import { tagRoutes } from './tags.ts'
import { todoRoutes } from './todos.ts'

export const HOSTNAME = '127.0.0.1'
export const PORT = 4747

export type AppOptions = {
  /** Folder holding the built web app (index.html and assets). */
  webDist: string
  /** Where content and config.yml live (env and home folder) and the clock; defaults to the real ones. Tests point it at a temp folder. */
  content?: ContentOptions
  /** Called after each successful write to content through the API; the server schedules a Snapshot from it. */
  onContentChange?: () => void
  /** Read from the Keychain once at startup. Routes may say whether one exists, never return it. */
  credentials?: Credentials
  /** Changes to the content folder, sent to the browser as live updates; shared with the server's other listeners. */
  events?: ContentEvents
  /** The work overview's pollers (`workOverview()`), started by the caller. None by default, so nothing is polled. */
  activity?: Activity
  /** Hover details for References the work overview didn't poll (`referenceLookup()`). None by default: nothing is fetched. */
  references?: ReferenceLookup
  /** The server's search index (`startSearch()`). Without one, each search builds a throwaway index in memory. */
  search?: Pick<Search, 'search'>
}

const ALLOWED_HOSTS = new Set([`${HOSTNAME}:${PORT}`, `localhost:${PORT}`])
const ALLOWED_ORIGINS = new Set([...ALLOWED_HOSTS].map((host) => `http://${host}`))
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
/** API writes that change no content, so schedule no Snapshot. */
const changesNoContent = (path: string) => path.startsWith('/api/activity/')

export function createApp({
  webDist,
  content = {},
  credentials = {},
  onContentChange,
  events = contentEvents(content),
  activity = activityPoller({ sources: [], clock: { now: Date.now, setTimeout: () => () => {} } }),
  references = noReferenceLookup,
  search = throwawaySearch(content),
}: AppOptions) {
  const app = new Hono()

  // DNS rebinding: a foreign page resolving its own name to 127.0.0.1 still sends its own Host.
  app.use(async (c, next) => {
    if (!ALLOWED_HOSTS.has(c.req.header('host') ?? '')) return c.text('Forbidden host', 403)
    await next()
  })

  // CSRF: browsers always send Origin on cross-origin writes. No Origin means a CLI or an agent, not a web page.
  app.use(async (c, next) => {
    const origin = c.req.header('origin')
    if (!SAFE_METHODS.has(c.req.method) && origin !== undefined && !ALLOWED_ORIGINS.has(origin)) {
      return c.text('Forbidden origin', 403)
    }
    await next()
  })

  // Every API write goes through core to the content folder, so a successful one means the content changed;
  // except the work overview's, which only report a window's visibility.
  app.use('/api/*', async (c, next) => {
    await next()
    if (!SAFE_METHODS.has(c.req.method) && c.res.ok && !changesNoContent(c.req.path)) onContentChange?.()
  })

  app.get('/api/health', (c) => c.json({ ok: true }))
  app.route('/api/todos', todoRoutes(content))
  app.route('/api/tags', tagRoutes(content))
  app.route('/api/notes', noteRoutes(content))
  app.route('/api/devlogs', devlogRoutes(content))
  app.route('/api/sketches', sketchRoutes(content))
  app.route('/api/history', historyRoutes(content))
  app.route('/api/references', referenceRoutes(references))
  app.route('/api/people', peopleRoutes(content))
  app.route('/api/search', searchRoutes(search, content))

  // Live updates: one stream of `{kind, id?}` changes, to content and to the work overview (`{ kind: 'activity',
  // id: source }`). `ready` comes first, once changes are being watched.
  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const closed = new Promise<void>((resolve) => stream.onAbort(resolve))
      const send = (change: object) => void stream.writeSSE({ data: JSON.stringify(change) })
      const unsubscribe = await events.subscribe(send)
      const unsubscribeActivity = activity.subscribe(send)
      // `?client=` names the window, which then reports its visibility to the work overview's schedule.
      const client = c.req.query('client')
      const disconnect = client ? activity.connect(client) : undefined
      try {
        await stream.writeSSE({ event: 'ready', data: '' })
        await closed
      } finally {
        unsubscribe()
        unsubscribeActivity()
        disconnect?.()
      }
    }),
  )

  app.route('/api/backup', backupRoutes(content))
  app.route('/api/activity', activityRoutes(activity))
  app.route('/api/settings', settingsRoutes(content, credentials))
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

  // The built web app, same origin as the API. Unknown paths are client routes, so they get index.html.
  if (existsSync(join(webDist, 'index.html'))) {
    app.use(serveStatic({ root: webDist }))
    app.get('*', serveStatic({ root: webDist, path: 'index.html' }))
  } else {
    app.get('*', (c) => c.text(`The web app is not built (no ${webDist}/index.html). Run \`pnpm build\` first.`, 503))
  }

  return app
}
