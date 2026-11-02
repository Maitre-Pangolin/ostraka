import { fileURLToPath } from 'node:url'
import { serve, type ServerType } from '@hono/node-server'
import { startAutoSnapshots } from '@ostraka/core'
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

export type RunningServer = {
  server: ServerType
  /** Stops listening, then commits any pending content changes as a Snapshot. */
  stop(): Promise<void>
}

/**
 * Reads the Keychain items once, makes the content folder a git repo if needed, then starts the server on
 * 127.0.0.1 only; resolves once it is listening.
 */
export async function startServer({
  keychain,
  port = PORT,
  webDist = DEFAULT_WEB_DIST,
  env,
  homeDir,
  warn,
}: StartOptions): Promise<RunningServer> {
  const credentials = await readCredentials(keychain, warn)
  const content = { env, homeDir }
  const snapshots = await startAutoSnapshots(content)
  const app = createApp({ webDist, content, credentials, onContentChange: snapshots.changed })
  try {
    const server = await new Promise<ServerType>((resolve, reject) => {
      const listening = serve({ fetch: app.fetch, hostname: HOSTNAME, port }, () => resolve(listening))
      listening.once('error', reject)
    })
    return {
      server,
      async stop() {
        await new Promise((resolve) => server.close(resolve))
        await snapshots.stop()
      },
    }
  } catch (error) {
    await snapshots.stop()
    throw error
  }
}
