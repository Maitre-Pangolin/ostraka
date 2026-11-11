// Backup: a plain `git push` of the content repo to its `origin` (a private project on the work gitlab.com), run by
// `ostraka backup` outside the app. git signs in as it does for the user (their SSH key or credential helper): nothing
// here reads a token. Never a force-push, never a merge: a rejected push is reported and left to the user.
import { mkdir, readdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { BackupResult, BackupState, SecretFile } from './backup-types.ts'
import { resolveContentRoot, type ContentRootOptions } from './content-root.ts'
import { git, runGit } from './git.ts'
import { findSecrets } from './secret-scan.ts'
import { ensureContentRepo } from './snapshots.ts'

export const BACKUP_REMOTE = 'origin'

export type BackupOptions = ContentRootOptions

type Failed = Extract<BackupResult, { status: 'failed' }>

async function headCommit(root: string): Promise<string | undefined> {
  const { code, stdout } = await runGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])
  return code === 0 ? stdout.trim() : undefined
}

async function currentBranch(root: string): Promise<string | undefined> {
  const { code, stdout } = await runGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  return code === 0 ? stdout.trim() : undefined
}

async function hasRemote(root: string): Promise<boolean> {
  return (await runGit(root, ['remote', 'get-url', BACKUP_REMOTE])).code === 0
}

/**
 * `git log` arguments leaving out what the remote's copy of the branch has, as last pushed or fetched
 * (`refs/remotes/origin/<branch>`): nothing when the branch was never pushed, every `origin` branch on a detached HEAD.
 */
async function notOnRemote(root: string, branch: string | undefined): Promise<string[]> {
  if (branch === undefined) return ['--not', `--remotes=${BACKUP_REMOTE}`]
  const ref = `refs/remotes/${BACKUP_REMOTE}/${branch}`
  return (await runGit(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).code === 0 ? ['--not', ref] : []
}

/**
 * The files whose lines added in commits not yet on the remote's branch look like secrets. Every commit counts, not
 * just the latest: a secret removed again would still leave in the history.
 */
async function scanUnpushed(root: string, commit: string, branch: string): Promise<SecretFile[]> {
  const args = ['-c', 'core.quotePath=false', 'log', '-p', '--no-color', '--no-ext-diff', '--unified=0', '--format=']
  const log = await git(root, [...args, commit, ...(await notOnRemote(root, branch))])
  const added = new Map<string, string[]>()
  let file: string | undefined
  let inHeader = false
  for (const line of log.split('\n')) {
    if (line.startsWith('diff --git ')) {
      inHeader = true
      file = undefined
    } else if (inHeader && line.startsWith('+++ ')) {
      file = line === '+++ /dev/null' ? undefined : line.slice('+++ b/'.length)
    } else if (line.startsWith('@@')) {
      inHeader = false
    } else if (!inHeader && file !== undefined && line.startsWith('+')) {
      const lines = added.get(file) ?? []
      lines.push(line.slice(1))
      added.set(file, lines)
    }
  }
  return [...added]
    .map(([path, lines]) => ({ file: path, kinds: findSecrets(lines.join('\n')) }))
    .filter(({ kinds }) => kinds.length > 0)
    .toSorted((a, b) => a.file.localeCompare(b.file))
}

/**
 * Scans the Snapshots not on `origin/<branch>` for secrets, then pushes the current branch to `origin` without force,
 * signing in as git does for the user. It runs outside the app, with or without the server running.
 */
export async function backup(options: BackupOptions = {}): Promise<BackupResult> {
  const root = await resolveContentRoot(options)
  const commit = await headCommit(root)
  if (commit === undefined) return { status: 'empty' }
  if (!(await hasRemote(root))) return { status: 'no-remote' }
  const branch = await currentBranch(root)
  if (branch === undefined) return { status: 'failed', reason: 'HEAD is detached: check out a branch in the content folder.' }

  const files = await scanUnpushed(root, commit, branch)
  if (files.length > 0) return { status: 'secrets', files }

  // The commit scanned, not the branch: a Snapshot the server makes meanwhile waits for the next backup. A successful
  // push also moves refs/remotes/origin/<branch>, which is how the app knows, offline, what is backed up.
  const pushed = await runGit(root, [
    '-c',
    'core.hooksPath=/dev/null',
    'push',
    '--porcelain',
    '--no-verify',
    BACKUP_REMOTE,
    `${commit}:refs/heads/${branch}`,
  ])
  if (pushed.code !== 0) {
    // --porcelain: `!<tab>from:to<tab>[rejected] (fetch first)` for each ref the remote refused.
    const refused = pushed.stdout
      .split('\n')
      .filter((line) => line.startsWith('!'))
      .map((line) => line.split('\t').at(-1)!.trim())
    if (refused.length > 0) return { status: 'rejected', reason: rejectionReason(refused.join('; '), root, branch, pushed.stderr) }
    return { status: 'failed', reason: gitReason(pushed.stderr) }
  }
  return { status: 'backed-up', commit, pushed: !pushed.stdout.includes('[up to date]') }
}

function rejectionReason(refusal: string, root: string, branch: string, stderr: string): string {
  const said = gitReason(stderr)
  const behind = /fetch first|non-fast-forward/.test(refusal)
    ? `\nThe remote's ${branch} has commits this machine doesn't. Ostraka never merges or force-pushes: bring them in by hand (git -C ${root} pull --rebase), then run ostraka backup again.`
    : ''
  return `Push ${refusal.replaceAll(/[[\]]/g, '')}.${said ? `\n${said}` : ''}${behind}`
}

export type CloneResult = { status: 'cloned'; path: string; commit: string | undefined } | Failed

export type CloneOptions = BackupOptions

/**
 * Restore on a new machine: clones the backup into the content folder (which must be missing or empty), with the
 * remote as `origin`, so backups carry on from there. git signs in as it would for the user (their SSH key or
 * credential helper, or by asking them).
 */
export async function cloneContent(url: string, options: CloneOptions = {}): Promise<CloneResult> {
  const root = await resolveContentRoot(options)
  const existing = await readdir(root).catch(() => [])
  if (existing.length > 0) throw new Error(`${root} already exists and is not empty: restore only sets up a new machine.`)
  await mkdir(dirname(root), { recursive: true })
  const cloned = await runGit(dirname(root), ['clone', '--quiet', '--origin', BACKUP_REMOTE, '--', url, root])
  if (cloned.code !== 0) return { status: 'failed', reason: gitReason(cloned.stderr) }
  await ensureContentRepo(options)
  return { status: 'cloned', path: root, commit: await headCommit(root) }
}

export const STALE_AFTER_MS = 24 * 60 * 60_000
export const LARGE_FILE_BYTES = 10 * 1024 * 1024

/**
 * What the repo says about its backup, with no network: whether HEAD is on `origin/<branch>` as last pushed or
 * fetched, how long the oldest Snapshot not on it has waited, and the content files over 10 MB.
 */
export async function backupState({
  now = () => new Date(),
  ...options
}: ContentRootOptions & { now?: () => Date } = {}): Promise<BackupState> {
  const root = await resolveContentRoot(options)
  const remote = await hasRemote(root)
  const commit = await headCommit(root)
  if (commit === undefined) return { remote, backedUp: false, stale: false, largeFiles: [] }

  const waiting = await git(root, ['log', '--format=%ct', commit, ...(await notOnRemote(root, await currentBranch(root)))])
  const times = waiting === '' ? [] : waiting.split('\n').map(Number)
  const largeFiles = (await git(root, ['-c', 'core.quotePath=false', 'ls-tree', '-r', '-l', '--full-tree', commit]))
    .split('\n')
    .map((line) => {
      // `<mode> blob <object> <size>\t<path>`
      const [meta, file] = line.split('\t') as [string, string]
      return { file, bytes: Number(meta.trim().split(/\s+/)[3]) }
    })
    .filter(({ bytes }) => bytes > LARGE_FILE_BYTES)
  if (times.length === 0) return { remote, backedUp: true, stale: false, largeFiles }
  const oldest = Math.min(...times) * 1000
  return {
    remote,
    backedUp: false,
    unbackedSince: new Date(oldest).toISOString(),
    stale: now().getTime() - oldest > STALE_AFTER_MS,
    largeFiles,
  }
}

/** git's own explanation, without hints, progress or any credentials in a URL. */
function gitReason(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('hint:'))
  return (lines.join('\n') || 'git failed without saying why.').replace(/\/\/[^/@\s]+@/g, '//')
}
