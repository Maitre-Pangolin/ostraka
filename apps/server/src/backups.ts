// Backup scheduling: push after a Snapshot, at most once every 15 minutes; check the remote at start. `ostraka backup`
// asks the running server to push now (`POST /api/backup`), so only the server reads the push token.
import {
  backup,
  backupState,
  checkBackup,
  resolveContentRoot,
  type BackupResult,
  type BackupStatus,
  type ContentOptions,
  type ContentRootOptions,
} from '@ostraka/core'
import { Hono } from 'hono'
import { CONTENT_ROOT_HEADER } from './search.ts'

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
  /** Pushes now (scan, push, remote check), after any check or push running, and says how it went. */
  backupNow(): Promise<BackupResult>
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
    } else if (result.status !== 'not-backed-up') {
      problem = undefined
      if (result.status === 'backed-up') stopped = false
    }
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
    backupNow() {
      return new Promise<BackupResult>((resolve, reject) =>
        run(async () => {
          try {
            lastPushAt = Date.now()
            const result = await backup({ ...options, token: token() })
            record(result)
            resolve(result)
          } catch (error) {
            reject(error)
          }
        }),
      )
    },
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

const errorJson = (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) })

/**
 * `GET /api/backup`: the backup status the top bar's warning shows. `POST /api/backup`: push now, with the server's
 * own push token, answering the result and the files over 10 MB (never a token). Both say which content folder they
 * serve (`CONTENT_ROOT_HEADER`), so the CLI only asks a server for its own content.
 */
export function backupRoutes(backups: Pick<Backups, 'status'> & Partial<Pick<Backups, 'backupNow'>>, content: ContentRootOptions) {
  const routes = new Hono()
  routes.use(async (c, next) => {
    await next()
    c.header(CONTENT_ROOT_HEADER, encodeURIComponent(await resolveContentRoot(content)))
  })
  routes.get('/', async (c) => {
    try {
      return c.json(await backups.status())
    } catch (error) {
      return c.json(errorJson(error), 500)
    }
  })
  routes.post('/', async (c) => {
    if (!backups.backupNow) return c.json({ error: 'This server runs no backups.' }, 503)
    try {
      const result = await backups.backupNow()
      const { largeFiles } = await backupState(content)
      return c.json({ ...result, largeFiles })
    } catch (error) {
      return c.json(errorJson(error), 500)
    }
  })
  return routes
}
