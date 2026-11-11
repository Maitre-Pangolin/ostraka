// Safe writes to a content file shared with agents and the CLI: an O_EXCL lock file next to it,
// then a temp file renamed over the target, so no reader ever sees a half-written file.
import { randomBytes } from 'node:crypto'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'

export type LockOptions = {
  /** How long to wait for another writer before giving up. Default 5 s. */
  timeoutMs?: number
  /** A lock older than this is taken over even if its owner still runs (pid reuse, hung writer). Default 30 s. */
  staleMs?: number
}

type LockOwner = { pid: number; createdAt: string }

const RETRY_MS = 10

export class FileLockedError extends Error {}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function readOwner(lockFile: string): Promise<LockOwner | undefined> {
  try {
    const owner = JSON.parse(await readFile(lockFile, 'utf8')) as Partial<LockOwner>
    if (typeof owner.pid === 'number' && typeof owner.createdAt === 'string') return { pid: owner.pid, createdAt: owner.createdAt }
  } catch {
    // Gone since EEXIST, or caught half-written: treated as unknown below.
  }
  return undefined
}

// For a lock whose owner can't be read (empty or garbled): judge it by its age on disk.
async function olderThan(file: string, ms: number): Promise<boolean> {
  try {
    return Date.now() - (await stat(file)).mtimeMs > ms
  } catch {
    return false
  }
}

async function acquire(lockFile: string, { timeoutMs = 5000, staleMs = 30_000 }: LockOptions): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await writeFile(lockFile, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), { flag: 'wx' })
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const owner = await readOwner(lockFile)
    const stale = owner ? !isRunning(owner.pid) || Date.now() - Date.parse(owner.createdAt) > staleMs : await olderThan(lockFile, staleMs)
    if (stale) {
      await rm(lockFile, { force: true })
      continue
    }
    if (Date.now() >= deadline) {
      const who = owner ? `process ${owner.pid} since ${owner.createdAt}` : 'another process'
      throw new FileLockedError(
        `${lockFile.replace(/\.lock$/, '')} is locked by ${who}. If no Ostraka command is running, delete ${lockFile}.`,
      )
    }
    await sleep(RETRY_MS)
  }
}

/** Runs `fn` while holding `<file>.lock`; the lock is released whether `fn` succeeds or not. */
export async function withFileLock<T>(file: string, fn: () => Promise<T>, options: LockOptions = {}): Promise<T> {
  const lockFile = `${file}.lock`
  await acquire(lockFile, options)
  try {
    return await fn()
  } finally {
    await rm(lockFile, { force: true })
  }
}

/** Writes a temp file beside the target, then renames it over the target. */
export async function writeFileAtomic(file: string, text: string): Promise<void> {
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(temp, text)
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}
