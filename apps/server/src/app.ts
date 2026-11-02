import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { configPath, loadConfig, locateContentRoot, type TodoOptions } from '@ostraka/core'
import { Hono } from 'hono'
import { KEYCHAIN_ITEMS, type CredentialName, type Credentials } from './keychain.ts'
import { tagRoutes, todoRoutes } from './todos.ts'

export const HOSTNAME = '127.0.0.1'
export const PORT = 4747

export type AppOptions = {
  /** Folder holding the built web app (index.html and assets). */
  webDist: string
  /** Where content and config.yml live (env and home folder) and the clock; defaults to the real ones. Tests point it at a temp folder. */
  content?: TodoOptions
  /** Read from the Keychain once at startup. Routes may say whether one exists, never return it. */
  credentials?: Credentials
}

const ALLOWED_HOSTS = new Set([`${HOSTNAME}:${PORT}`, `localhost:${PORT}`])
const ALLOWED_ORIGINS = new Set([...ALLOWED_HOSTS].map((host) => `http://${host}`))
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function createApp({ webDist, content = {}, credentials = {} }: AppOptions) {
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

  app.get('/api/health', (c) => c.json({ ok: true }))
  app.route('/api/todos', todoRoutes(content))
  app.route('/api/tags', tagRoutes(content))

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
