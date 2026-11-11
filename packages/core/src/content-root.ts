import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadConfig } from './config.ts'
import type { LockOptions } from './locked-file.ts'

export type ContentRootOptions = {
  env?: Record<string, string | undefined>
  homeDir?: string
}

/** What reading and changing content takes, as the app, the CLI and agents pass it: where it lives, the clock, the lock. */
export type ContentOptions = ContentRootOptions & {
  /** The clock; tests pass a fixed one. */
  now?: () => Date
  lock?: LockOptions
}

function expandHome(path: string, homeDir: string): string {
  if (path === '~') return homeDir
  if (path.startsWith('~/')) return join(homeDir, path.slice(2))
  return resolve(homeDir, path)
}

/** Where the content root was set: the OSTRAKA_HOME env var, contentDir in config.yml, or the default. */
export type ContentRootSource = 'env' | 'config' | 'default'

/** Content root and where it was set: OSTRAKA_HOME, then contentDir in ~/.config/ostraka/config.yml, then ~/ostraka-content. */
export async function locateContentRoot({ env = process.env, homeDir = homedir() }: ContentRootOptions = {}): Promise<{
  path: string
  source: ContentRootSource
}> {
  if (env.OSTRAKA_HOME) return { path: expandHome(env.OSTRAKA_HOME, homeDir), source: 'env' }
  const { contentDir } = await loadConfig({ homeDir })
  if (contentDir) return { path: expandHome(contentDir, homeDir), source: 'config' }
  return { path: join(homeDir, 'ostraka-content'), source: 'default' }
}

/** Content root: OSTRAKA_HOME, then contentDir in ~/.config/ostraka/config.yml, then ~/ostraka-content. */
export async function resolveContentRoot(options?: ContentRootOptions): Promise<string> {
  return (await locateContentRoot(options)).path
}
