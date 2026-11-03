// Snapshots: the content folder is its own git repo, and a Snapshot is one commit across the whole folder.
import { execFile } from 'node:child_process'
import { access, appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { contentFileAt } from './content-path.ts'
import { resolveContentRoot, type ContentRootOptions } from './content-root.ts'
import { withFileLock, writeFileAtomic } from './locked-file.ts'

const execFileAsync = promisify(execFile)

export type Snapshot = { commit: string; message: string }

/** The message of a Snapshot made once changes settle, or of changes committed before a restore. */
export const AUTO_SNAPSHOT_MESSAGE = 'Automatic snapshot'

// Variables that would point git at another repo than the content folder (set when called from a git hook, say).
const REPO_LOCATION_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_PREFIX']

async function git(root: string, args: string[]): Promise<string> {
  return (await gitRaw(root, args)).trim()
}

// A content file may be large (a warning comes at 10 MB): its text comes back whole, never trimmed.
async function gitRaw(root: string, args: string[]): Promise<string> {
  const env = { ...process.env }
  for (const name of REPO_LOCATION_VARS) delete env[name]
  const { stdout } = await execFileAsync('git', ['-C', root, ...args], { encoding: 'utf8', env, maxBuffer: 256 * 1024 * 1024 })
  return stdout
}

/** Makes the content folder its own git repo (no remote) unless it already is one. */
export async function ensureContentRepo(options: ContentRootOptions = {}): Promise<string> {
  const root = await resolveContentRoot(options)
  await enqueue(root, () => initRepo(root))
  return root
}

// Files of a write in progress (see locked-file.ts), never content. Kept out of the repo without adding a file to it.
const EXCLUDE = '# ostraka: writes in progress\n*.lock\n*.tmp\n'

async function initRepo(root: string): Promise<void> {
  try {
    await access(join(root, '.git'))
  } catch {
    await mkdir(root, { recursive: true })
    await git(root, ['init', '--quiet'])
  }
  const exclude = join(root, '.git', 'info', 'exclude')
  const current = await readFile(exclude, 'utf8').catch(() => '')
  if (!current.includes(EXCLUDE)) {
    await mkdir(dirname(exclude), { recursive: true })
    await appendFile(exclude, `${current === '' || current.endsWith('\n') ? '' : '\n'}${EXCLUDE}`)
  }
}

// One queue per content folder in this process: git work on a folder never overlaps (index.lock).
const queues = new Map<string, Promise<unknown>>()

function enqueue<T>(root: string, task: () => Promise<T>): Promise<T> {
  const result = (queues.get(root) ?? Promise.resolve()).then(task)
  const tail = result.catch(() => {})
  queues.set(root, tail)
  void tail.then(() => {
    if (queues.get(root) === tail) queues.delete(root)
  })
  return result
}

/** Commits everything in the content folder now; resolves to undefined when nothing changed. */
export async function snapshot(message: string, options: ContentRootOptions = {}): Promise<Snapshot | undefined> {
  const root = await resolveContentRoot(options)
  return enqueue(root, () => commitAll(root, message))
}

async function commitAll(root: string, message: string): Promise<Snapshot | undefined> {
  await initRepo(root)
  await git(root, ['add', '--all'])
  if ((await git(root, ['status', '--porcelain'])) === '') return undefined
  // A Snapshot is ostraka's own unattended commit: the user's code-repo hooks don't run on it or rewrite its
  // message, signing (which may prompt) is off, and a machine with no git identity still gets one.
  const config = ['core.hooksPath=/dev/null', 'commit.gpgSign=false', ...((await hasIdentity(root)) ? [] : FALLBACK_IDENTITY)]
  await git(root, [...config.flatMap((entry) => ['-c', entry]), 'commit', '--quiet', '--no-verify', '--message', message])
  return { commit: await git(root, ['rev-parse', 'HEAD']), message }
}

/** A Snapshot in a file's history: when it was made, and its message. */
export type FileSnapshot = Snapshot & { date: string }

const FIELD = '\x1f'

/**
 * The Snapshots that changed one content file (`notes/<id>.md`, `todos.json`; relative to the content folder),
 * newest first. None before the first Snapshot.
 */
export async function fileHistory(path: string, options: ContentRootOptions = {}): Promise<FileSnapshot[]> {
  contentFileAt(path)
  const root = await resolveContentRoot(options)
  if (!(await hasHead(root))) return []
  return snapshotsIn(root, ['--', path])
}

/** `git log` for the arguments given, read as Snapshots. */
async function snapshotsIn(root: string, args: string[]): Promise<FileSnapshot[]> {
  const log = await git(root, ['log', `--format=%H${FIELD}%aI${FIELD}%s`, ...args])
  return log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [commit, date, message] = line.split(FIELD) as [string, string, string]
      return { commit, message, date }
    })
}

/** What a restore did: the Snapshot it made (none when the file already was that version), and the Snapshot of
 * the content folder just before it, which restoring undoes the restore. */
export type Restore = { restored: FileSnapshot | undefined; before: FileSnapshot | undefined }

/**
 * Brings back a file as one Snapshot held it, without rewriting history: changes not yet in a Snapshot are
 * committed first (so nothing is lost and the restore can be undone by restoring `before`), then the old text is
 * written as the current file, under its lock, and committed as a new Snapshot `restore: <path> as of <date>`.
 */
export async function restoreFile(path: string, commit: string, options: ContentRootOptions = {}): Promise<Restore> {
  const text = await fileAtSnapshot(path, commit, options)
  const root = await resolveContentRoot(options)
  const [source] = await snapshotsIn(root, ['-1', commit])
  const message = `restore: ${path} as of ${source!.date.slice(0, 10)} ${source!.date.slice(11, 16)}`
  const file = join(root, path)
  await mkdir(dirname(file), { recursive: true })
  return enqueue(root, () =>
    withFileLock(file, async () => {
      await commitAll(root, AUTO_SNAPSHOT_MESSAGE)
      const [before] = await snapshotsIn(root, ['-1'])
      await writeFileAtomic(file, text)
      const committed = await commitAll(root, message)
      const [restored] = committed ? await snapshotsIn(root, ['-1', committed.commit]) : []
      return { restored, before }
    }),
  )
}

/** No Snapshot by that commit holds the file. */
export class SnapshotNotFoundError extends Error {}

/** A file's text exactly as one Snapshot (a commit from `fileHistory`) held it. */
export async function fileAtSnapshot(path: string, commit: string, options: ContentRootOptions = {}): Promise<string> {
  contentFileAt(path)
  const root = await resolveContentRoot(options)
  const notFound = new SnapshotNotFoundError(`No Snapshot ${commit} of ${path}`)
  if (!/^[0-9a-f]{4,64}$/i.test(commit) || !(await hasHead(root))) throw notFound
  try {
    return await gitRaw(root, ['cat-file', 'blob', `${commit}:${path}`])
  } catch {
    throw notFound
  }
}

/** Whether the content folder is its own repo with a first commit (and not a folder inside another repo). */
async function hasHead(root: string): Promise<boolean> {
  try {
    await access(join(root, '.git'))
    await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])
    return true
  } catch {
    return false
  }
}

const FALLBACK_IDENTITY = ['user.name=Ostraka', 'user.email=ostraka@localhost']

async function hasIdentity(root: string): Promise<boolean> {
  try {
    await git(root, ['var', 'GIT_AUTHOR_IDENT'])
    return true
  } catch {
    return false
  }
}
