import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'

export type ContentRootOptions = {
  env?: Record<string, string | undefined>
  homeDir?: string
}

// Only the keys core reads so far; later keys (gitlab, jira) are added as they are used.
const ConfigSchema = z.looseObject({
  contentDir: z.string().min(1).optional(),
})

export function configPath(homeDir: string = homedir()): string {
  return join(homeDir, '.config', 'ostraka', 'config.yml')
}

async function readConfig(homeDir: string) {
  const file = configPath(homeDir)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  const result = ConfigSchema.safeParse(parse(text) ?? {})
  if (!result.success) throw new Error(`Invalid ${file}:\n${z.prettifyError(result.error)}`)
  return result.data
}

function expandHome(path: string, homeDir: string): string {
  if (path === '~') return homeDir
  if (path.startsWith('~/')) return join(homeDir, path.slice(2))
  return resolve(homeDir, path)
}

/** Content root: OSTRAKA_HOME, then contentDir in ~/.config/ostraka/config.yml, then ~/ostraka-content. */
export async function resolveContentRoot({ env = process.env, homeDir = homedir() }: ContentRootOptions = {}): Promise<string> {
  if (env.OSTRAKA_HOME) return expandHome(env.OSTRAKA_HOME, homeDir)
  const { contentDir } = await readConfig(homeDir)
  if (contentDir) return expandHome(contentDir, homeDir)
  return join(homeDir, 'ostraka-content')
}
