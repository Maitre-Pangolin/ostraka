import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backup, backupState, checkBackup, cloneContent, snapshot, type ContentRootOptions } from '../src/index.ts'
import { startHttpRemote } from './http-remote.ts'

let dir: string
let content: string
let remote: string
let options: ContentRootOptions

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ostraka-backup-'))
  content = join(dir, 'content')
  remote = join(dir, 'remote.git')
  options = { env: { OSTRAKA_HOME: content } }
  execFileSync('git', ['init', '--quiet', '--bare', remote])
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
const remoteHas = (commit: string) => git(remote, 'cat-file', '-t', commit) === 'commit'
const remoteBranches = () => git(remote, 'for-each-ref', '--format=%(refname:short) %(objectname)')

async function write(file: string, text: string) {
  await mkdir(dirname(join(content, file)), { recursive: true })
  await writeFile(join(content, file), text)
}

/** A content repo with one Snapshot and the bare repo as its `origin`. */
async function contentWithRemote() {
  await write('todos.json', '{"todos":[]}\n')
  await snapshot('first', options)
  git(content, 'remote', 'add', 'origin', remote)
}

const head = () => git(content, 'rev-parse', 'HEAD')
const branch = () => git(content, 'symbolic-ref', '--short', 'HEAD')

// Each git process takes a few hundred ms to spawn under the test runner on macOS.
describe('backup', { timeout: 60_000 }, () => {
  it('pushes the current branch and checks that HEAD is on the remote', async () => {
    await contentWithRemote()

    const result = await backup(options)

    expect(result).toMatchObject({ status: 'backed-up', commit: head() })
    expect(remoteBranches()).toBe(`${branch()} ${head()}`)
  })

  it('pushes only what is new, and says when the remote already had it', async () => {
    await contentWithRemote()
    await backup(options)
    await write('notes/idea.md', '---\ntags: [idea]\n---\nA thought\n')
    await snapshot('second', options)

    expect(await backup(options)).toMatchObject({ status: 'backed-up', commit: head(), pushed: true })
    expect(await backup(options)).toEqual({ status: 'backed-up', commit: head(), pushed: false })
    expect(remoteHas(head())).toBe(true)
  })

  it('never force-pushes or merges when the remote has moved on, and says why', async () => {
    await contentWithRemote()
    await backup(options)
    // Another machine pushes first.
    const other = join(dir, 'other')
    execFileSync('git', ['clone', '--quiet', remote, other])
    await writeFile(join(other, 'todos.json'), '{"todos":[],"other":true}\n')
    git(other, '-c', 'user.name=Other', '-c', 'user.email=other@localhost', 'commit', '--quiet', '-am', 'other machine')
    git(other, 'push', '--quiet', 'origin', 'HEAD')
    const theirs = git(other, 'rev-parse', 'HEAD')
    await write('todos.json', '{"todos":[],"mine":true}\n')
    await snapshot('mine', options)
    const mine = head()

    const result = await backup(options)

    expect(result).toEqual({ status: 'rejected', reason: expect.stringMatching(/rejected/) })
    expect(remoteBranches()).toBe(`${branch()} ${theirs}`)
    expect(head()).toBe(mine)
    expect(git(content, 'log', '--format=%s')).toBe('mine\nfirst')
    expect(git(content, 'status', '--porcelain')).toBe('')
  })

  it('reports a content repo with no remote', async () => {
    await write('todos.json', '{"todos":[]}\n')
    await snapshot('first', options)
    expect(await backup(options)).toEqual({ status: 'no-remote' })
  })

  it('has nothing to back up before the first Snapshot', async () => {
    await mkdir(content)
    git(content, 'init', '--quiet')
    git(content, 'remote', 'add', 'origin', remote)
    expect(await backup(options)).toEqual({ status: 'empty' })
  })

  it('says why when the remote cannot be reached', async () => {
    await contentWithRemote()
    git(content, 'remote', 'set-url', 'origin', join(dir, 'missing.git'))
    expect(await backup(options)).toEqual({ status: 'failed', reason: expect.stringMatching(/missing\.git/) })
  })
})

describe('backup over HTTP with the push token', { timeout: 60_000 }, () => {
  const token = `test-push-token-${'x'.repeat(12)}`

  it('authenticates with the token, from the environment only', async () => {
    const server = await startHttpRemote(dir, token)
    try {
      await contentWithRemote()
      git(content, 'remote', 'set-url', 'origin', `${server.url}/remote.git`)

      expect(await backup({ ...options, token })).toMatchObject({ status: 'backed-up', commit: head() })
      expect(remoteHas(head())).toBe(true)
      expect(server.authorizations).toContain(`Basic ${Buffer.from(`oauth2:${token}`).toString('base64')}`)
      // Nothing about the token was written into the content repo's config.
      expect(await readFile(join(content, '.git', 'config'), 'utf8')).not.toContain(token)
    } finally {
      await server.close()
    }
  })

  it('fails without prompting when the token is missing or wrong, never echoing it', async () => {
    const server = await startHttpRemote(dir, token)
    try {
      await contentWithRemote()
      git(content, 'remote', 'set-url', 'origin', `${server.url}/remote.git`)

      const missing = await backup(options)
      const wrong = await backup({ ...options, token: 'wrong-token-value' })

      expect(missing).toEqual({ status: 'failed', reason: expect.stringMatching(/Authentication failed|could not read Username/) })
      expect(wrong).toEqual({ status: 'failed', reason: expect.stringMatching(/Authentication failed/) })
      expect(JSON.stringify(wrong)).not.toContain('wrong-token-value')
      expect(remoteBranches()).toBe('')
    } finally {
      await server.close()
    }
  })
})

// Built from pieces so the repo itself never holds a token-shaped string.
const gitlabToken = ['glpat', 'Zz98Yy76Xx54Ww32Vv10'].join('-')
const keyHeader = ['-----BEGIN', 'EC PRIVATE KEY-----'].join(' ')

describe('backup secret scan', { timeout: 60_000 }, () => {
  it('blocks the push when a changed file holds a token, naming the file but not the token', async () => {
    await contentWithRemote()
    await backup(options)
    const before = remoteBranches()
    await write('notes/setup.md', `---\ntags: []\n---\nexport TOKEN=${gitlabToken}\n`)
    await write('devlogs/2026-11-02.md', '---\ntags: []\n---\nPaired on group/app!42.\n')
    await snapshot('notes', options)

    const result = await backup(options)

    expect(result).toEqual({ status: 'secrets', files: [{ file: 'notes/setup.md', kinds: ['GitLab token'] }] })
    expect(JSON.stringify(result)).not.toContain(gitlabToken)
    expect(remoteBranches()).toBe(before)
  })

  it('still blocks a secret removed again in a later Snapshot, since history would carry it', async () => {
    await contentWithRemote()
    await write('id_ec', `${keyHeader}\nMHcCAQEEI\n`)
    await snapshot('oops', options)
    await rm(join(content, 'id_ec'))
    await snapshot('removed', options)

    expect(await backup(options)).toEqual({ status: 'secrets', files: [{ file: 'id_ec', kinds: ['private key'] }] })
    expect(remoteBranches()).toBe('')
  })

  it('pushes content that only mentions token prefixes', async () => {
    await contentWithRemote()
    await write('notes/tokens.md', '---\ntags: []\n---\nGitLab tokens start with glpat- and Jira ones with ATATT.\n')
    await snapshot('notes', options)

    expect(await backup(options)).toMatchObject({ status: 'backed-up', commit: head() })
  })
})

const HOUR = 60 * 60_000
const NOW = new Date('2026-11-02T12:00:00Z')

/** A Snapshot-like commit dated `hoursAgo` before NOW. */
async function commitHoursAgo(hoursAgo: number, file = 'todos.json') {
  await write(file, `{"todos":[],"at":${hoursAgo}}\n`)
  const date = new Date(NOW.getTime() - hoursAgo * HOUR).toISOString()
  git(content, 'add', '--all')
  execFileSync('git', ['-C', content, '-c', 'user.name=T', '-c', 'user.email=t@localhost', 'commit', '--quiet', '-m', `${hoursAgo}h ago`], {
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  })
}

describe('backupState', { timeout: 60_000 }, () => {
  it('is stale once a Snapshot has waited more than 24 h for a backup', async () => {
    await mkdir(content)
    git(content, 'init', '--quiet')
    await commitHoursAgo(25)
    await commitHoursAgo(1)

    expect(await backupState({ ...options, now: () => NOW })).toEqual({
      remote: false,
      backedUp: false,
      unbackedSince: new Date(NOW.getTime() - 25 * HOUR).toISOString(),
      stale: true,
      largeFiles: [],
    })
  })

  it('is not stale while what waits is less than 24 h old', async () => {
    await contentWithRemote()
    await commitHoursAgo(30)
    await backup(options)
    await commitHoursAgo(23)

    expect(await backupState({ ...options, now: () => NOW })).toMatchObject({
      remote: true,
      backedUp: false,
      unbackedSince: new Date(NOW.getTime() - 23 * HOUR).toISOString(),
      stale: false,
    })
  })

  it('is backed up, however long ago, while HEAD is on the remote', async () => {
    await contentWithRemote()
    await commitHoursAgo(72)
    await backup(options)

    expect(await backupState({ ...options, now: () => NOW })).toEqual({ remote: true, backedUp: true, stale: false, largeFiles: [] })
  })

  it('has nothing to warn about before the first Snapshot', async () => {
    expect(await backupState({ ...options, now: () => NOW })).toEqual({ remote: false, backedUp: false, stale: false, largeFiles: [] })
  })

  it('lists each content file over 10 MB', async () => {
    await mkdir(content)
    await writeFile(join(content, 'big.png'), Buffer.alloc(10 * 1024 * 1024 + 1))
    await writeFile(join(content, 'just-fits.png'), Buffer.alloc(10 * 1024 * 1024))
    await snapshot('images', options)

    expect((await backupState({ ...options, now: () => NOW })).largeFiles).toEqual([{ file: 'big.png', bytes: 10 * 1024 * 1024 + 1 }])
  })
})

describe('checkBackup', { timeout: 60_000 }, () => {
  it('finds a freshly cloned content repo backed up, by asking the remote', async () => {
    await contentWithRemote()
    await backup(options)
    const restored = join(dir, 'restored')
    execFileSync('git', ['clone', '--quiet', remote, restored])

    expect(await checkBackup({ env: { OSTRAKA_HOME: restored } })).toEqual({
      status: 'backed-up',
      commit: git(restored, 'rev-parse', 'HEAD'),
      pushed: false,
    })
  })

  it('finds a Snapshot not pushed yet', async () => {
    await contentWithRemote()
    await backup(options)
    await commitHoursAgo(1)

    expect(await checkBackup(options)).toEqual({ status: 'not-backed-up' })
  })

  it('reports no remote without contacting anything', async () => {
    await write('todos.json', '{"todos":[]}\n')
    await snapshot('first', options)
    expect(await checkBackup(options)).toEqual({ status: 'no-remote' })
  })
})

describe('cloneContent', { timeout: 60_000 }, () => {
  it('clones the backup into the content folder, with the remote as origin', async () => {
    await contentWithRemote()
    await backup(options)
    const restored = join(dir, 'new-machine', 'ostraka-content')

    const result = await cloneContent(remote, { env: { OSTRAKA_HOME: restored } })

    expect(result).toEqual({ status: 'cloned', path: restored, commit: head() })
    expect(git(restored, 'remote', 'get-url', 'origin')).toBe(remote)
    expect(await readFile(join(restored, 'todos.json'), 'utf8')).toBe('{"todos":[]}\n')
  })

  it('clones over HTTP with the push token', async () => {
    const token = `test-push-token-${'y'.repeat(12)}`
    const server = await startHttpRemote(dir, token)
    try {
      await contentWithRemote()
      await backup(options)
      const restored = join(dir, 'restored')

      expect(await cloneContent(`${server.url}/remote.git`, { env: { OSTRAKA_HOME: restored }, token })).toMatchObject({ status: 'cloned' })
      expect(await cloneContent(`${server.url}/remote.git`, { env: { OSTRAKA_HOME: join(dir, 'other') } })).toEqual({
        status: 'failed',
        reason: expect.stringMatching(/Authentication failed|could not read Username/),
      })
    } finally {
      await server.close()
    }
  })

  it('refuses a content folder that already has files', async () => {
    await contentWithRemote()
    await expect(cloneContent(remote, options)).rejects.toThrow(/already exists/)
  })
})
