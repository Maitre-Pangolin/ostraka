// Snapshots: the content folder is its own git repo, and a Snapshot is one commit across the whole folder.
import { access, appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveContentRoot, type ContentRootOptions } from './content-root.ts'
import { git } from './git.ts'

export type Snapshot = { commit: string; message: string }

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

const FALLBACK_IDENTITY = ['user.name=Ostraka', 'user.email=ostraka@localhost']

async function hasIdentity(root: string): Promise<boolean> {
  try {
    await git(root, ['var', 'GIT_AUTHOR_IDENT'])
    return true
  } catch {
    return false
  }
}
