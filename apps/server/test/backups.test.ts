import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { snapshot, type BackupState } from '@ostraka/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startHttpRemote } from '../../../packages/core/test/http-remote.ts'
import { createApp, startServer } from '../src/index.ts'
import { fakeKeychain, TOKENS } from './fake-keychain.ts'

const HOUR = 60 * 60_000
const NOW = new Date('2026-11-02T12:00:00Z')

let dir: string
let content: string
let remote: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ostraka-backups-'))
  content = join(dir, 'content')
  remote = join(dir, 'remote.git')
  execFileSync('git', ['init', '--quiet', '--bare', remote])
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const options = () => ({ env: { OSTRAKA_HOME: content } })
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
const headers = { host: '127.0.0.1:4747' }

/** A Snapshot-like commit of todos.json dated `hoursAgo` before NOW. */
async function commitHoursAgo(hoursAgo: number) {
  await mkdir(content, { recursive: true })
  await writeFile(join(content, 'todos.json'), `{"todos":[],"at":${hoursAgo}}\n`)
  const date = new Date(NOW.getTime() - hoursAgo * HOUR).toISOString()
  if ((await snapshot('Automatic snapshot', options())) === undefined) throw new Error('nothing to commit')
  // An identity of its own, as CI has none configured.
  execFileSync(
    'git',
    ['-C', content, '-c', 'user.name=T', '-c', 'user.email=t@localhost', 'commit', '--quiet', '--amend', '--no-edit', `--date=${date}`],
    {
      env: { ...process.env, GIT_COMMITTER_DATE: date },
    },
  )
}

const getBackup = async () => {
  const app = createApp({ webDist: '/nonexistent', content: { ...options(), now: () => NOW } })
  return app.request('/api/backup', { headers })
}

// Each git process takes a few hundred ms to spawn under the test runner on macOS.
describe('GET /api/backup', { timeout: 60_000 }, () => {
  it('warns from the repo alone once Snapshots have waited 24 h for origin/<branch>', async () => {
    await commitHoursAgo(30)
    git(content, 'remote', 'add', 'origin', remote)
    // The remote is unreachable: the answer never depended on it.
    git(content, 'remote', 'set-url', 'origin', join(dir, 'missing.git'))

    const res = await getBackup()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      remote: true,
      backedUp: false,
      unbackedSince: new Date(NOW.getTime() - 30 * HOUR).toISOString(),
      stale: true,
      largeFiles: [],
    } satisfies BackupState)
  })

  it('is backed up once the branch was pushed, by ostraka backup or by hand', async () => {
    await commitHoursAgo(30)
    git(content, 'remote', 'add', 'origin', remote)
    git(content, 'push', '--quiet', 'origin', 'HEAD')

    expect(await (await getBackup()).json()).toEqual({ remote: true, backedUp: true, stale: false, largeFiles: [] })
  })

  it('says there is no remote', async () => {
    await commitHoursAgo(30)
    expect(await (await getBackup()).json()).toMatchObject({ remote: false, stale: true })
  })

  it('no longer pushes on request', async () => {
    await commitHoursAgo(1)
    git(content, 'remote', 'add', 'origin', remote)
    const app = createApp({ webDist: '/nonexistent', content: options() })

    const res = await app.request('/api/backup', { method: 'POST', headers })

    expect(res.status).toBe(404)
    expect(git(remote, 'for-each-ref')).toBe('')
  })
})

describe('startServer', { timeout: 60_000 }, () => {
  it('never contacts the remote, starting, snapshotting or stopping', async () => {
    const server = await startHttpRemote(dir, 'any-token-value')
    try {
      await commitHoursAgo(1)
      git(content, 'remote', 'add', 'origin', `${server.url}/remote.git`)
      // A change for the Snapshot on stop.
      await writeFile(join(content, 'todos.json'), '{"todos":[],"changed":true}\n')
      const { keychain } = fakeKeychain(TOKENS)

      const running = await startServer({ port: 0, webDist: '/nonexistent', keychain, env: { OSTRAKA_HOME: content }, homeDir: dir })
      await running.stop()

      expect(git(content, 'log', '-1', '--format=%s')).toBe('Automatic snapshot')
      expect(git(content, 'status', '--porcelain')).toBe('')
      expect(server.requests).toEqual([])
    } finally {
      await server.close()
    }
  })
})
