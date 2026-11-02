import { fileURLToPath } from 'node:url'
import { serve, type ServerType } from '@hono/node-server'
import { createApp, HOSTNAME, PORT } from './app.ts'

export const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url))

export type StartOptions = {
  port?: number
  webDist?: string
}

/** Starts the server on 127.0.0.1 only; resolves once it is listening. */
export function startServer({ port = PORT, webDist = DEFAULT_WEB_DIST }: StartOptions = {}): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: createApp({ webDist }).fetch, hostname: HOSTNAME, port }, () => resolve(server))
    server.once('error', reject)
  })
}
