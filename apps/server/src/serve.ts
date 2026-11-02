import { fileURLToPath } from 'node:url'
import { serve, type ServerType } from '@hono/node-server'
import { startAutoSnapshots, type TodoOptions } from '@ostraka/core'
import { createApp, HOSTNAME, PORT } from './app.ts'

export const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url))

export type StartOptions = {
  port?: number
  webDist?: string
  /** Where content lives; defaults to the real content root. Tests point it at a temp folder. */
  content?: TodoOptions
}

export type RunningServer = {
  server: ServerType
  /** Stops listening, then commits any pending content changes as a Snapshot. */
  stop(): Promise<void>
}

/** Makes the content folder a git repo if needed, then starts the server on 127.0.0.1 only. */
export async function startServer({ port = PORT, webDist = DEFAULT_WEB_DIST, content = {} }: StartOptions = {}): Promise<RunningServer> {
  const snapshots = await startAutoSnapshots(content)
  const app = createApp({ webDist, content, onContentChange: snapshots.changed })
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
