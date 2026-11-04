// Backup scheduling: push after a Snapshot, at most once every 15 minutes; check the remote at start.
import { backup, backupState, checkBackup, type BackupResult, type BackupStatus, type ContentOptions } from '@ostraka/core'
import { Hono } from 'hono'

export const BACKUP_INTERVAL_MS = 15 * 60_000

export type BackupsOptions = {
  /** Where content lives and the clock, as the app gets them. */
  content?: ContentOptions
  /** The push token (Keychain item `ostraka-push`, read once at startup), revealed for each check or push. */
  token?: () => string | undefined
  intervalMs?: number
  /** A backup that threw (not one that failed cleanly) is reported here. Default: console.error. */
  onError?: (error: unknown) => void
}

export type Backups = {
  /** A Snapshot was made: push it, now or once 15 minutes have passed since the last push. */
  snapshotted(): void
  /** The repo's backup state plus what the last push ran into. */
  status(): Promise<BackupStatus>
  /** Resolves once no check or push is running. */
  idle(): Promise<void>
  /** Schedules nothing more. */
  stop(): void
}

/** Checks the remote now (without blocking the caller), then pushes after each Snapshot reported to it. */
export function startBackups({
  content = {},
  token = () => undefined,
  intervalMs = BACKUP_INTERVAL_MS,
  onError = (error) => console.error('Backup failed:', error),
}: BackupsOptions): Backups {
  const options = { env: content.env, homeDir: content.homeDir }
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastPushAt: number | undefined
  let problem: BackupStatus['problem']
  let stopped = false
  let closed = false
  let inProgress: Promise<void> = Promise.resolve()

  const record = (result: BackupResult | Awaited<ReturnType<typeof checkBackup>>) => {
    if (result.status === 'secrets' || result.status === 'failed') problem = result
    else if (result.status === 'rejected') {
      problem = result
      stopped = true
    } else if (result.status !== 'not-backed-up') problem = undefined
    if (result.status === 'not-backed-up') schedule()
  }

  const run = (task: () => Promise<void>) => {
    inProgress = inProgress.then(task).catch(onError)
  }

  const push = () => {
    timer = undefined
    lastPushAt = Date.now()
    run(async () => record(await backup({ ...options, token: token() })))
  }

  function schedule() {
    if (closed || stopped || timer !== undefined) return
    const wait = lastPushAt === undefined ? 0 : Math.max(0, lastPushAt + intervalMs - Date.now())
    timer = setTimeout(push, wait)
  }

  run(async () => record(await checkBackup({ ...options, token: token() })))

  return {
    snapshotted: schedule,
    async status() {
      const state = await backupState({ ...options, now: content.now })
      // Backed up by any means (`ostraka backup`, a push by hand): whatever went wrong before is over.
      if (state.backedUp) {
        problem = undefined
        stopped = false
      }
      return { ...state, ...(problem && { problem }), stopped }
    },
    async idle() {
      // A push may queue behind the check that scheduled it with no delay.
      let seen: Promise<void> | undefined
      while (seen !== inProgress) {
        seen = inProgress
        await seen
      }
    },
    stop() {
      closed = true
      clearTimeout(timer)
      timer = undefined
    },
  }
}

/** `GET /api/backup`: the backup status the top bar's warning shows. */
export function backupRoutes(backups: Pick<Backups, 'status'>) {
  const routes = new Hono()
  routes.get('/', async (c) => {
    try {
      return c.json(await backups.status())
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
    }
  })
  return routes
}
