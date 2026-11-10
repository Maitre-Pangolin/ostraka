// Types only, no Node modules: the web app imports them from `@ostraka/core/backup-types`.

/** A content file (relative path) and the kinds of secret found in it; never the secret itself. */
export type SecretFile = { file: string; kinds: string[] }

/** A content file over 10 MB, by its size in bytes. */
export type LargeFile = { file: string; bytes: number }

/** How `ostraka backup` went. */
export type BackupResult =
  /** Local HEAD is on the remote; `pushed` is false when it already was. */
  | { status: 'backed-up'; commit: string; pushed: boolean }
  /** No Snapshot yet: nothing to back up. */
  | { status: 'empty' }
  /** Snapshots not on the remote hold what looks like a token: nothing was pushed. */
  | { status: 'secrets'; files: SecretFile[] }
  /** The content repo has no `origin` remote. */
  | { status: 'no-remote' }
  /** The remote refused the push (it has commits this repo doesn't, or a protected branch). */
  | { status: 'rejected'; reason: string }
  /** Anything else: offline, authentication, a detached HEAD. */
  | { status: 'failed'; reason: string }

/**
 * What the content repo says about its backup, with no network (GET /api/backup, for the top bar's warning). The
 * remote's branch is as `ostraka backup` last pushed it, or a fetch last saw it.
 */
export type BackupState = {
  /** The content repo has an `origin` remote. */
  remote: boolean
  /** HEAD is on `origin/<branch>`. */
  backedUp: boolean
  /** When the oldest Snapshot not on it was made. */
  unbackedSince?: string
  /** That Snapshot has waited more than 24 h. */
  stale: boolean
  largeFiles: LargeFile[]
}
