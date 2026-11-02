import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'

/**
 * `~/.config/ostraka/config.yml`. No secrets: tokens live in the macOS Keychain, read by the server only.
 * Keys it does not know are ignored.
 */
export const ConfigSchema = z.looseObject({
  /** The content folder; `~` expands to the home folder. `OSTRAKA_HOME` overrides it. */
  contentDir: z.string().min(1).optional(),
  gitlab: z
    .object({
      /** gitlab.com today; never assumed in code. */
      base_url: z.url({ protocol: /^https?$/ }).optional(),
    })
    .optional(),
  jira: z
    .object({
      /** The site URL, such as https://acme.atlassian.net. */
      site: z.url({ protocol: /^https?$/ }).optional(),
      /** Scoped tokens go through https://api.atlassian.com/ex/jira/<cloud_id>; from <site>/_edge/tenant_info. */
      cloud_id: z.guid().optional(),
      /** The board whose active sprint is shown. */
      board_id: z.int().positive().optional(),
      /** The "my tickets" JQL. */
      my_tickets_jql: z.string().min(1).optional(),
    })
    .optional(),
})

export type Config = z.infer<typeof ConfigSchema>

export type ConfigOptions = {
  homeDir?: string
}

export function configPath(homeDir: string = homedir()): string {
  return join(homeDir, '.config', 'ostraka', 'config.yml')
}

/** Reads and validates config.yml; an absent file means no settings. */
export async function loadConfig({ homeDir = homedir() }: ConfigOptions = {}): Promise<Config> {
  const file = configPath(homeDir)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  const raw: unknown = parse(text) ?? {}
  const secret = findSecret(raw)
  if (secret !== undefined) {
    throw new Error(
      `Invalid ${file}: \`${secret}\` looks like a secret. config.yml holds no secrets; store tokens in the Keychain (see README).`,
    )
  }
  const result = ConfigSchema.safeParse(raw)
  if (!result.success) throw new Error(`Invalid ${file}:\n${z.prettifyError(result.error)}`)
  return result.data
}

const SECRET_KEY = /token|secret|passw(or)?d|api[_-]?key|credential/i
// The same token shapes the backup scan blocks: GitLab, Atlassian, Slack, private keys.
const SECRET_VALUE = /glpat-|ATATT|xox[abeprs]-|-----BEGIN [A-Z ]*PRIVATE KEY/

/** The dotted path of the first key or value that looks like a secret. Never returns the value itself. */
function findSecret(value: unknown, path: string[] = []): string | undefined {
  if (typeof value === 'string') return SECRET_VALUE.test(value) ? path.join('.') : undefined
  if (value === null || typeof value !== 'object') return undefined
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key]
    if (SECRET_KEY.test(key)) return childPath.join('.')
    const found = findSecret(child, childPath)
    if (found !== undefined) return found
  }
  return undefined
}
