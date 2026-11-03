import { fileURLToPath } from 'node:url'
import { serve, type ServerType } from '@hono/node-server'
import { startAutoSnapshots, type AutoSnapshotOptions } from '@ostraka/core'
import { systemClock } from './activity/clock.ts'
import type { Fetch } from './activity/http.ts'
import { workOverview } from './activity/work-overview.ts'
import { createApp, HOSTNAME, PORT } from './app.ts'
import { startBackups, type Backups } from './backups.ts'
import { contentEvents } from './content-events.ts'
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
  /** Calls to GitLab and Jira; tests pass a fake so nothing reaches a real instance. */
  fetch?: Fetch
  /** When automatic Snapshots commit; tests shorten the wait. */
  snapshots?: Pick<AutoSnapshotOptions, 'quietMs' | 'maxWaitMs'>
}

export type RunningServer = {
  server: ServerType
  /** Backup pushes, scheduled after each automatic Snapshot. */
  backups: Backups
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
  snapshots: snapshotTiming,
  fetch = globalThis.fetch,
}: StartOptions): Promise<RunningServer> {
  const credentials = await readCredentials(keychain, warn)
  const content = { env, homeDir }
  // Checks the remote now, in the background; pushes after each automatic Snapshot, at most every 15 min.
  const backups = startBackups({ content, token: () => credentials.push?.reveal() })
  const snapshots = await startAutoSnapshots({ ...content, ...snapshotTiming, onSnapshot: backups.snapshotted })
  // Every change on disk, the CLI's and agents' included, is snapshotted; the same watcher feeds live updates.
  const events = contentEvents(content)
  const unwatch = await events.subscribe(() => snapshots.changed())
  // The work overview polls from startup, at its hidden rates until a window reports that it is visible.
  const activity = workOverview({ fetch, credentials, content: { homeDir }, clock: systemClock })
  const app = createApp({ webDist, content, credentials, onContentChange: snapshots.changed, events, activity, backups })
  activity.start()
  try {
    const server = await new Promise<ServerType>((resolve, reject) => {
      const listening = serve({ fetch: app.fetch, hostname: HOSTNAME, port }, () => resolve(listening))
      listening.once('error', reject)
    })
    return {
      server,
      backups,
      async stop() {
        const closed = new Promise((resolve) => server.close(resolve))
        // Open live-update streams never end on their own; a browser reconnects once the server is back.
        if ('closeAllConnections' in server) server.closeAllConnections()
        await closed
        activity.stop()
        unwatch()
        await snapshots.stop()
        backups.stop()
        await backups.idle()
      },
    }
  } catch (error) {
    activity.stop()
    unwatch()
    await snapshots.stop()
    backups.stop()
    throw error
  }
}
