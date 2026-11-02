import { fileURLToPath } from 'node:url'
import { serve, type ServerType } from '@hono/node-server'
import { createApp, HOSTNAME, PORT } from './app.ts'
import { readCredentials, type Keychain } from './keychain.ts'

export const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url))

export type StartOptions = {
  /** Where credentials come from: `macKeychain()` in production, a fake in tests. Required so nothing reads the real Keychain by accident. */
  keychain: Keychain
  port?: number
  webDist?: string
  env?: Record<string, string | undefined>
  homeDir?: string
  /** Where a Keychain item that could not be read is reported. */
  warn?: (message: string) => void
}

/** Reads the Keychain items once, then starts the server on 127.0.0.1 only; resolves once it is listening. */
export async function startServer({
  keychain,
  port = PORT,
  webDist = DEFAULT_WEB_DIST,
  env,
  homeDir,
  warn,
}: StartOptions): Promise<ServerType> {
  const credentials = await readCredentials(keychain, warn)
  const app = createApp({ webDist, env, homeDir, credentials })
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: HOSTNAME, port }, () => resolve(server))
    server.once('error', reject)
  })
}
