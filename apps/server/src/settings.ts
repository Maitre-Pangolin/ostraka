// The Settings view's data: where config.yml and the content folder are, the GitLab and Jira config, and which
// Keychain items were found (never their values).
import { configPath, loadConfig, locateContentRoot, type ContentRootOptions } from '@ostraka/core'
import { Hono } from 'hono'
import { KEYCHAIN_ITEMS, type CredentialName, type Credentials } from './keychain.ts'

export function settingsRoutes(content: ContentRootOptions, credentials: Credentials) {
  const routes = new Hono()

  // Read on each request, so the Settings view shows edits to config.yml without a restart.
  routes.get('/', async (c) => {
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

  return routes
}
