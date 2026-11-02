import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { ConfigSchema, type Config } from './config-schema.ts'

export { ConfigSchema, type Config } from './config-schema.ts'

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
