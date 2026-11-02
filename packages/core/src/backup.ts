// Backup: a plain `git push` of the content repo to its `origin` (a private project on the work gitlab.com).
// Never a force-push, never a merge: a rejected push is reported and left to the user.
import { resolveContentRoot, type ContentRootOptions } from './content-root.ts'
import { git, runGit, type GitRunOptions } from './git.ts'
import { findSecrets } from './secret-scan.ts'

export const BACKUP_REMOTE = 'origin'

export type BackupOptions = ContentRootOptions & {
  /** The push token (Keychain item `ostraka-push`). Without one, git uses the user's own setup (SSH key, helper). */
  token?: string
}

/** A content file (relative path) and the kinds of secret found in it; never the secret itself. */
export type SecretFile = { file: string; kinds: string[] }

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

const NETWORK_TIMEOUT_MS = 2 * 60_000

/**
 * How git authenticates, from the environment only: nothing is written to disk or put on a command line. With a
 * token, the only credential helper is one that answers with it; git never prompts either way.
 */
function remoteEnv(token: string | undefined): GitRunOptions {
  const env: Record<string, string> = {
    GIT_TERMINAL_PROMPT: '0',
    // An empty GIT_ASKPASS also stops git falling back to SSH_ASKPASS or core.askPass.
    GIT_ASKPASS: '',
    GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes',
  }
  if (token !== undefined) {
    Object.assign(env, {
      OSTRAKA_PUSH_TOKEN: token,
      GIT_CONFIG_COUNT: '2',
      // An empty value clears the helpers from the user's own config (osxkeychain would store the token).
      GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'credential.helper',
      GIT_CONFIG_VALUE_1: '!f() { test "$1" = get && printf "username=oauth2\\npassword=%s\\n" "$OSTRAKA_PUSH_TOKEN"; }; f',
    })
  }
  return { env, timeoutMs: NETWORK_TIMEOUT_MS }
}

async function headCommit(root: string): Promise<string | undefined> {
  const { code, stdout } = await runGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])
  return code === 0 ? stdout.trim() : undefined
}

async function hasRemote(root: string): Promise<boolean> {
  return (await runGit(root, ['remote', 'get-url', BACKUP_REMOTE])).code === 0
}

/** Fetches the remote's branches (into refs/remotes/origin, never merged) and says whether `commit` is on one. */
async function isOnRemote(root: string, commit: string, token: string | undefined): Promise<BackupResult | boolean> {
  const fetched = await runGit(
    root,
    ['fetch', '--quiet', '--no-tags', BACKUP_REMOTE, `+refs/heads/*:refs/remotes/${BACKUP_REMOTE}/*`],
    remoteEnv(token),
  )
  if (fetched.code !== 0) return { status: 'failed', reason: gitReason(fetched.stderr) }
  return (await git(root, ['for-each-ref', '--contains', commit, '--format=%(refname)', `refs/remotes/${BACKUP_REMOTE}/`])) !== ''
}

/**
 * The files whose lines added in commits not yet on the remote (as last fetched or pushed) look like secrets. Every
 * commit counts, not just the latest: a secret removed again would still leave in the history.
 */
async function scanUnpushed(root: string, commit: string): Promise<SecretFile[]> {
  const log = await git(root, [
    ...['-c', 'core.quotePath=false'],
    ...['log', '-p', '--no-color', '--no-ext-diff', '--unified=0', '--format=', commit],
    ...['--not', `--remotes=${BACKUP_REMOTE}`],
  ])
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
      added.set(file, [...(added.get(file) ?? []), line.slice(1)])
    }
  }
  return [...added]
    .map(([file, lines]) => ({ file, kinds: findSecrets(lines.join('\n')) }))
    .filter(({ kinds }) => kinds.length > 0)
    .sort((a, b) => a.file.localeCompare(b.file))
}

/** Scans what is new for secrets, pushes the current branch to `origin` without force, then checks that HEAD is on the remote. */
export async function backup({ token, ...options }: BackupOptions = {}): Promise<BackupResult> {
  const root = await resolveContentRoot(options)
  const commit = await headCommit(root)
  if (commit === undefined) return { status: 'empty' }
  if (!(await hasRemote(root))) return { status: 'no-remote' }
  const branch = await runGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (branch.code !== 0) return { status: 'failed', reason: 'HEAD is detached: check out a branch in the content folder.' }

  const files = await scanUnpushed(root, commit)
  if (files.length > 0) return { status: 'secrets', files }

  // The commit scanned, not HEAD: a Snapshot landing meanwhile waits for the next backup.
  const pushed = await runGit(
    root,
    ['-c', 'core.hooksPath=/dev/null', 'push', '--porcelain', '--no-verify', BACKUP_REMOTE, `${commit}:refs/heads/${branch.stdout.trim()}`],
    remoteEnv(token),
  )
  if (pushed.code !== 0) {
    // --porcelain: `!<tab>from:to<tab>[rejected] (fetch first)` for each ref the remote refused.
    const refused = pushed.stdout
      .split('\n')
      .filter((line) => line.startsWith('!'))
      .map((line) => line.split('\t').at(-1)!.trim())
    if (refused.length > 0) return { status: 'rejected', reason: rejectionReason(refused.join('; '), branch.stdout.trim()) }
    return { status: 'failed', reason: gitReason(pushed.stderr) }
  }

  const onRemote = await isOnRemote(root, commit, token)
  if (typeof onRemote !== 'boolean') return onRemote
  if (!onRemote) return { status: 'failed', reason: 'The push went through but the commit is not on the remote.' }
  return { status: 'backed-up', commit, pushed: !pushed.stdout.includes('[up to date]') }
}

function rejectionReason(refusal: string, branch: string): string {
  const behind = /fetch first|non-fast-forward/.test(refusal)
    ? ` The remote's ${branch} has commits this machine doesn't. Ostraka never merges or force-pushes: bring them in by hand in the content folder (git pull --rebase), then run ostraka backup.`
    : ''
  return `Push ${refusal}.${behind}`
}

/** git's own explanation, without hints, progress or any credentials in a URL. */
function gitReason(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('hint:'))
  return (lines.join('\n') || 'git failed without saying why.').replace(/\/\/[^/@\s]+@/g, '//')
}
