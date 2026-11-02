// Automatic Snapshots for the server: one commit once changes settle, rather than one per change.
import type { ContentRootOptions } from './content-root.ts'
import { ensureContentRepo, snapshot } from './snapshots.ts'

export type AutoSnapshotOptions = ContentRootOptions & {
  /** Commit once the content has had no change for this long. Default 60 s. */
  quietMs?: number
  /** While changes keep coming, commit at the latest this long after the first uncommitted one. Default 10 min. */
  maxWaitMs?: number
  /** A failed automatic commit is reported here and retried on the next change. Default: console.error. */
  onError?: (error: unknown) => void
}

export type AutoSnapshots = {
  /** Something in the content folder changed (an app write now; file-watcher events later). */
  changed(): void
  /** Resolves once no Snapshot is in progress. */
  idle(): Promise<void>
  /** Commits pending changes now and stops scheduling. */
  stop(): Promise<void>
}

export const AUTO_SNAPSHOT_MESSAGE = 'Automatic snapshot'

/** Makes the content folder a git repo if needed, then commits after changes settle. */
export async function startAutoSnapshots({
  quietMs = 60_000,
  maxWaitMs = 10 * 60_000,
  onError = (error) => console.error('Automatic snapshot failed:', error),
  ...options
}: AutoSnapshotOptions = {}): Promise<AutoSnapshots> {
  await ensureContentRepo(options)
  let quietTimer: ReturnType<typeof setTimeout> | undefined
  let maxWaitTimer: ReturnType<typeof setTimeout> | undefined
  let inProgress: Promise<void> = Promise.resolve()
  let stopped = false

  const commit = () => {
    clearTimeout(quietTimer)
    clearTimeout(maxWaitTimer)
    quietTimer = maxWaitTimer = undefined
    // snapshot() queues behind any commit already running, so this settles after all of them.
    inProgress = snapshot(AUTO_SNAPSHOT_MESSAGE, options).then(() => {}, onError)
  }

  const changed = () => {
    if (stopped) return
    clearTimeout(quietTimer)
    quietTimer = setTimeout(commit, quietMs)
    maxWaitTimer ??= setTimeout(commit, maxWaitMs)
  }
  // Files may have changed while the server was down (CLI writes, agent edits): treat start as a change.
  changed()

  return {
    changed,
    async idle() {
      await inProgress
    },
    async stop() {
      stopped = true
      if (maxWaitTimer !== undefined) commit()
      await inProgress
    },
  }
}
