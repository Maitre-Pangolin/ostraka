// Automatic Snapshots for the server: at most one commit an hour, rather than one per change.
import type { ContentRootOptions } from './content-root.ts'
import { AUTO_SNAPSHOT_MESSAGE, ensureContentRepo, snapshot } from './snapshots.ts'

export type AutoSnapshotOptions = ContentRootOptions & {
  /** The first change after a Snapshot commits everything pending this long after it. Default 1 h. */
  intervalMs?: number
  /** A failed automatic commit is reported here and retried after the next change. Default: console.error. */
  onError?: (error: unknown) => void
}

export type AutoSnapshots = {
  /** Something in the content folder changed: an app write, or a file-watcher event (CLI, agents). */
  changed(): void
  /** Resolves once no Snapshot is in progress. */
  idle(): Promise<void>
  /** Commits pending changes now and stops scheduling. */
  stop(): Promise<void>
}

export { AUTO_SNAPSHOT_MESSAGE }

/**
 * Makes the content folder a git repo if needed, then commits on the hour: the first change after a Snapshot starts
 * the timer, later changes don't move it, and when it fires everything pending becomes one Snapshot.
 */
export async function startAutoSnapshots({
  intervalMs = 60 * 60_000,
  onError = (error) => console.error('Automatic snapshot failed:', error),
  ...options
}: AutoSnapshotOptions = {}): Promise<AutoSnapshots> {
  await ensureContentRepo(options)
  let timer: ReturnType<typeof setTimeout> | undefined
  let inProgress: Promise<void> = Promise.resolve()
  let stopped = false

  const commit = () => {
    clearTimeout(timer)
    timer = undefined
    // snapshot() queues behind any commit already running, so this settles after all of them.
    inProgress = snapshot(AUTO_SNAPSHOT_MESSAGE, options).then(() => {}, onError)
  }

  const changed = () => {
    if (stopped) return
    timer ??= setTimeout(commit, intervalMs)
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
      if (timer !== undefined) commit()
      await inProgress
    },
  }
}
