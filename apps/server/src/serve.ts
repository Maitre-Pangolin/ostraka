import { fileURLToPath } from 'node:url'
import { serve, type ServerType } from '@hono/node-server'
import { searchIndexPath, startAutoSnapshots, type AutoSnapshotOptions } from '@ostraka/core'
import { systemClock } from './activity/clock.ts'
import type { Fetch } from './activity/http.ts'
import { workOverview } from './activity/work-overview.ts'
import { createApp, HOSTNAME, PORT } from './app.ts'
import { contentEvents } from './content-events.ts'
import { referenceLookup } from './references.ts'
import { startSearch } from './search.ts'
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
  /** When automatic Snapshots commit (an hour after the first change); tests shorten the wait. */
  snapshots?: Pick<AutoSnapshotOptions, 'intervalMs'>
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
  snapshots: snapshotTiming,
  fetch = globalThis.fetch,
}: StartOptions): Promise<RunningServer> {
  const credentials = await readCredentials(keychain, warn)
  const content = { env, homeDir }
  // Snapshots stay on this machine: nothing in the server talks to the remote (`ostraka backup` pushes).
  const snapshots = await startAutoSnapshots({ ...content, ...snapshotTiming })
  // Every change on disk, the CLI's and agents' included, is snapshotted; the same watcher feeds live updates.
  const events = contentEvents(content)
  const unwatch = await events.subscribe(() => snapshots.changed())
  // Search follows the same watcher, ahead of the browsers' live updates, and is rebuilt from the files in the
  // background ("indexing…" until then). Its file is in the cache folder, outside the content folder.
  const search = await startSearch({ content, events, file: searchIndexPath(homeDir) })
  // The work overview polls from startup, at its hidden rates until a window reports that it is visible.
  const activity = workOverview({ fetch, credentials, content: { homeDir }, clock: systemClock })
  const references = referenceLookup({ fetch, credentials, content: { homeDir } })
  const app = createApp({
    webDist,
    content,
    credentials,
    onContentChange: snapshots.changed,
    events,
    activity,
    references,
    search,
  })
  activity.start()
  try {
    const server = await new Promise<ServerType>((resolve, reject) => {
      const listening = serve({ fetch: app.fetch, hostname: HOSTNAME, port }, () => resolve(listening))
      listening.once('error', reject)
    })
    return {
      server,
      async stop() {
        const closed = new Promise((resolve) => server.close(resolve))
        // Open live-update streams never end on their own; a browser reconnects once the server is back.
        if ('closeAllConnections' in server) server.closeAllConnections()
        await closed
        activity.stop()
        unwatch()
        await search.stop()
        await snapshots.stop()
      },
    }
  } catch (error) {
    activity.stop()
    unwatch()
    await search.stop()
    await snapshots.stop()
    throw error
  }
}
