// Types only, no Node modules: the web app imports them from `@ostraka/core/backup-types`.

/** A content file (relative path) and the kinds of secret found in it; never the secret itself. */
export type SecretFile = { file: string; kinds: string[] }

/** A content file over 10 MB, by its size in bytes. */
export type LargeFile = { file: string; bytes: number }

export type BackupResult =
  /** Local HEAD is on the remote; `pushed` is false when it already was. */
  | { status: 'backed-up'; commit: string; pushed: boolean }
  /** No Snapshot yet: nothing to back up. */
  | { status: 'empty' }
  /** Changed files look like they hold a token: nothing was pushed. */
  | { status: 'secrets'; files: SecretFile[] }
  /** The content repo has no `origin` remote. */
  | { status: 'no-remote' }
  /** The remote refused the push (it has commits this repo doesn't, or a protected branch). */
  | { status: 'rejected'; reason: string }
  /** Anything else: offline, authentication, a detached HEAD. */
  | { status: 'failed'; reason: string }

/** Whether local HEAD is on the remote, asked of the remote itself. */
export type BackupCheck =
  | Extract<BackupResult, { status: 'backed-up' | 'empty' | 'no-remote' | 'failed' }>
  /** HEAD has Snapshots the remote doesn't have yet. */
  | { status: 'not-backed-up' }

/** What the content repo says about its backup, without contacting the remote. */
export type BackupState = {
  /** The content repo has an `origin` remote. */
  remote: boolean
  /** HEAD is on `origin`, as last fetched or pushed. */
  backedUp: boolean
  /** When the oldest Snapshot not on the remote was made. */
  unbackedSince?: string
  /** That Snapshot has waited more than 24 h. */
  stale: boolean
  largeFiles: LargeFile[]
}

/** GET /api/backup: the repo's state plus what the server's last backup ran into. Never carries a token. */
export type BackupStatus = BackupState & {
  /** Why the last backup did not go through; cleared once HEAD is on the remote. */
  problem?: Extract<BackupResult, { status: 'secrets' | 'rejected' | 'failed' }>
  /** Automatic pushes stopped after a rejected push; they resume once HEAD is on the remote (`ostraka backup`). */
  stopped: boolean
}
