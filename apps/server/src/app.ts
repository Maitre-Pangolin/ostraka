import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { backupState, configPath, loadConfig, locateContentRoot, type TodoOptions } from '@ostraka/core'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { activityPoller, type Activity } from './activity/poller.ts'
import type { Backups } from './backups.ts'
import { contentEvents, type ContentEvents } from './content-events.ts'
import { KEYCHAIN_ITEMS, type CredentialName, type Credentials } from './keychain.ts'
import { devlogRoutes } from './devlogs.ts'
import { historyRoutes } from './history.ts'
import { noteRoutes } from './notes.ts'
import { noReferenceLookup, referenceRoutes, type ReferenceLookup } from './references.ts'
import { sketchRoutes } from './sketches.ts'
import { tagRoutes } from './tags.ts'
import { todoRoutes } from './todos.ts'

export const HOSTNAME = '127.0.0.1'
export const PORT = 4747

export type AppOptions = {
  /** Folder holding the built web app (index.html and assets). */
  webDist: string
  /** Where content and config.yml live (env and home folder) and the clock; defaults to the real ones. Tests point it at a temp folder. */
  content?: TodoOptions
  /** Called after each successful write to content through the API; the server schedules a Snapshot from it. */
  onContentChange?: () => void
  /** Read from the Keychain once at startup. Routes may say whether one exists, never return it. */
  credentials?: Credentials
  /** Changes to the content folder, sent to the browser as live updates; shared with the server's other listeners. */
  events?: ContentEvents
  /** The work overview's pollers (`workOverview()`), started by the caller. None by default, so nothing is polled. */
  activity?: Activity
  /**
   * The server's backup schedule, for the top bar's warning and to push a restore's Snapshot. Without one, the
   * status comes from the repo alone and nothing is pushed.
   */
  backups?: Pick<Backups, 'status'> & Partial<Pick<Backups, 'snapshotted'>>
  /** Hover details for References the work overview didn't poll (`referenceLookup()`). None by default: nothing is fetched. */
  references?: ReferenceLookup
}

const ALLOWED_HOSTS = new Set([`${HOSTNAME}:${PORT}`, `localhost:${PORT}`])
const ALLOWED_ORIGINS = new Set([...ALLOWED_HOSTS].map((host) => `http://${host}`))
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function createApp({
  webDist,
  content = {},
  credentials = {},
  onContentChange,
  events = contentEvents(content),
  activity = activityPoller({ sources: [], clock: { now: Date.now, setTimeout: () => () => {} } }),
  backups = { status: async () => ({ ...(await backupState(content)), stopped: false }) },
  references = noReferenceLookup,
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
    if (!SAFE_METHODS.has(c.req.method) && c.res.ok && !c.req.path.startsWith('/api/activity/')) onContentChange?.()
  })

  app.get('/api/health', (c) => c.json({ ok: true }))
  app.route('/api/todos', todoRoutes(content))
  app.route('/api/tags', tagRoutes(content))
  app.route('/api/notes', noteRoutes(content))
  app.route('/api/devlogs', devlogRoutes(content))
  app.route('/api/sketches', sketchRoutes(content))
  app.route('/api/history', historyRoutes(content, { onSnapshot: () => backups.snapshotted?.() }))
  app.route('/api/references', referenceRoutes(references))

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

  app.get('/api/backup', async (c) => {
    try {
      return c.json(await backups.status())
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
    }
  })

  // The work overview: each Activity source's latest data, or why it is failing or off.
  app.get('/api/activity', (c) => c.json({ sources: activity.statuses() }))
  // A window shows or hides the app: the server owns the schedule, the window only says whether it is seen.
  app.post('/api/activity/visibility', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as { client?: unknown; visible?: unknown } | undefined
    if (typeof body?.client !== 'string' || typeof body.visible !== 'boolean') {
      return c.json({ error: 'Expected { client: string, visible: boolean }' }, 400)
    }
    activity.setVisibility(body.client, body.visible)
    return c.body(null, 204)
  })

  // Read on each request, so the Settings view shows edits to config.yml without a restart.
  app.get('/api/settings', async (c) => {
    try {
      const config = await loadConfig({ homeDir: content.homeDir })
      return c.json({
        configFile: configPath(content.homeDir),
        content: await locateContentRoot(content),
        gitlab: config.gitlab ?? {},
        jira: config.jira ?? {},
        keychain: (Object.entries(KEYCHAIN_ITEMS) as [CredentialName, string][]).map(([name, item]) => ({
          name,
          item,
          found: credentials[name] !== undefined,
        })),
      })
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
    }
  })
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
