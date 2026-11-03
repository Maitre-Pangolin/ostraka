import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backup, snapshot, type BackupStatus } from '@ostraka/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startHttpRemote } from '../../../packages/core/test/http-remote.ts'
import { createApp, startBackups, startServer, type Backups } from '../src/index.ts'
import { fakeKeychain, TOKENS } from './fake-keychain.ts'

const MINUTE = 60_000

let dir: string
let content: string
let remote: string
let backups: Backups | undefined
let edits = 0

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ostraka-backups-'))
  content = join(dir, 'content')
  remote = join(dir, 'remote.git')
  execFileSync('git', ['init', '--quiet', '--bare', remote])
})

afterEach(async () => {
  backups?.stop()
  await backups?.idle()
  backups = undefined
  vi.useRealTimers()
  await rm(dir, { recursive: true, force: true })
})

const options = () => ({ env: { OSTRAKA_HOME: content } })
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
const head = () => git(content, 'rev-parse', 'HEAD')
const remoteHead = () => git(remote, 'for-each-ref', '--format=%(objectname)')

/** Changes todos.json and commits it, as an automatic Snapshot would. */
async function snapshotAnEdit(text = `{"todos":[],"edit":${++edits}}\n`) {
  await mkdir(content, { recursive: true })
  await writeFile(join(content, 'todos.json'), text)
  await snapshot('Automatic snapshot', options())
}

/** A content repo with one Snapshot and the bare repo as its `origin`; pushed when `pushed`. */
async function contentWithRemote({ pushed }: { pushed: boolean }) {
  await snapshotAnEdit()
  git(content, 'remote', 'add', 'origin', remote)
  if (pushed) await backup(options())
}

/** Moves the fake clock on, then waits for any backup it started to finish. */
async function wait(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
  await backups!.idle()
}

async function start() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  backups = startBackups({ content: options() })
  await backups.idle()
  return backups
}

// Each git process takes a few hundred ms to spawn under the test runner on macOS.
describe('startBackups', { timeout: 90_000 }, () => {
  it('checks the remote at start and pushes what it is missing', async () => {
    await contentWithRemote({ pushed: false })

    await start()
    await wait(0)
    const status = await backups!.status()

    expect(remoteHead()).toBe(head())
    expect(status).toMatchObject({ remote: true, backedUp: true, stopped: false })
    expect(status.problem).toBeUndefined()
  })

  it('pushes after a Snapshot, at most once every 15 minutes', async () => {
    await contentWithRemote({ pushed: true })
    await start()

    await snapshotAnEdit()
    backups!.snapshotted()
    await wait(0)
    expect(remoteHead()).toBe(head())

    await wait(5 * MINUTE)
    await snapshotAnEdit()
    backups!.snapshotted()
    await wait(0)
    await snapshotAnEdit()
    backups!.snapshotted()
    await wait(10 * MINUTE - 1)
    expect(remoteHead()).not.toBe(head())

    await wait(1)
    expect(remoteHead()).toBe(head())
  })

  it('stops pushing after a rejected push and shows why, until HEAD is backed up again', async () => {
    await contentWithRemote({ pushed: true })
    const ours = head()
    await start()
    const other = join(dir, 'other')
    execFileSync('git', ['clone', '--quiet', remote, other])
    await writeFile(join(other, 'todos.json'), '{"todos":[],"other":true}\n')
    git(other, '-c', 'user.name=O', '-c', 'user.email=o@localhost', 'commit', '--quiet', '-am', 'other machine')
    git(other, 'push', '--quiet', 'origin', 'HEAD')

    await snapshotAnEdit()
    backups!.snapshotted()
    await wait(0)
    expect(await backups!.status()).toMatchObject({
      backedUp: false,
      stopped: true,
      problem: { status: 'rejected', reason: expect.stringMatching(/rejected/) },
    })

    // The remote is put back by hand: an automatic push would now go through, but pushing has stopped.
    git(remote, 'update-ref', `refs/heads/${git(content, 'symbolic-ref', '--short', 'HEAD')}`, ours)
    await snapshotAnEdit()
    backups!.snapshotted()
    await wait(30 * MINUTE)
    expect(remoteHead()).toBe(ours)

    // `ostraka backup` succeeds, and automatic pushes resume.
    await backup(options())
    expect(await backups!.status()).toMatchObject({ backedUp: true, stopped: false })
    expect((await backups!.status()).problem).toBeUndefined()
    await snapshotAnEdit()
    backups!.snapshotted()
    await wait(15 * MINUTE)
    expect(remoteHead()).toBe(head())
  })

  it('blocks a push holding a secret and names the file, then pushes once it is gone from history', async () => {
    await contentWithRemote({ pushed: true })
    await start()
    const base = head()
    await snapshotAnEdit(`{"todos":[{"title":"${['glpat', 'Ab12Cd34Ef56Gh78Ij90'].join('-')}"}]}\n`)
    backups!.snapshotted()
    await wait(0)

    const status = await backups!.status()
    expect(status).toMatchObject({
      stopped: false,
      problem: { status: 'secrets', files: [{ file: 'todos.json', kinds: ['GitLab token'] }] },
    })
    expect(remoteHead()).toBe(base)

    git(content, 'reset', '--quiet', '--hard', base)
    await snapshotAnEdit()
    backups!.snapshotted()
    await wait(15 * MINUTE)
    expect(remoteHead()).toBe(head())
    expect((await backups!.status()).problem).toBeUndefined()
  })
})

describe('GET /api/backup', { timeout: 60_000 }, () => {
  it('answers the backup status for the top bar', async () => {
    await contentWithRemote({ pushed: true })
    const status: BackupStatus = { remote: true, backedUp: true, stale: false, largeFiles: [], stopped: false }
    const app = createApp({ webDist: '/nonexistent', content: options(), backups: { status: async () => status } })

    const res = await app.request('/api/backup', { headers: { host: '127.0.0.1:4747' } })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(status)
  })

  it('reads the repo when the server runs no backups', async () => {
    const app = createApp({ webDist: '/nonexistent', content: options() })
    await snapshotAnEdit()

    const res = await app.request('/api/backup', { headers: { host: '127.0.0.1:4747' } })

    expect(await res.json()).toMatchObject({ remote: false, backedUp: false, stopped: false })
  })
})

describe('startServer backups', { timeout: 60_000 }, () => {
  it('push with the token from the Keychain item ostraka-push', async () => {
    const server = await startHttpRemote(dir, TOKENS['ostraka-push'])
    try {
      await contentWithRemote({ pushed: false })
      git(content, 'remote', 'set-url', 'origin', `${server.url}/remote.git`)
      const { keychain } = fakeKeychain(TOKENS)

      const running = await startServer({ port: 0, webDist: '/nonexistent', keychain, env: { OSTRAKA_HOME: content }, homeDir: dir })
      await running.backups.idle()
      await running.stop()

      expect(remoteHead()).toBe(head())
      expect(server.authorizations).toContain(`Basic ${Buffer.from(`oauth2:${TOKENS['ostraka-push']}`).toString('base64')}`)
    } finally {
      await server.close()
    }
  })
})
