import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addTodo } from '@ostraka/core'
import { startServer } from '../src/index.ts'
import { fakeKeychain } from './fake-keychain.ts'

let contentRoot: string

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
})

const start = () =>
  startServer({ port: 0, webDist: '/nonexistent', keychain: fakeKeychain({}).keychain, env: { OSTRAKA_HOME: contentRoot } })
const git = (...args: string[]) => execFileSync('git', ['-C', contentRoot, ...args], { encoding: 'utf8' }).trim()
const commits = () => Number(git('rev-list', '--count', '--all'))
const waitForCommits = (count: number) => vi.waitUntil(() => commits() === count, { timeout: 10_000, interval: 200 })

// Each git process takes a few hundred ms to spawn under the test runner on macOS.
describe('startServer', { timeout: 30_000 }, () => {
  it('listens on the loopback interface only', async () => {
    const { server, stop } = await start()
    try {
      expect((server.address() as AddressInfo).address).toBe('127.0.0.1')
    } finally {
      await stop()
    }
  })

  it('makes the content folder a git repo and commits pending changes when it stops', async () => {
    const { stop } = await start()
    expect(git('rev-parse', '--git-dir')).toBe('.git')
    await writeFile(join(contentRoot, 'todos.json'), '{"todos":[]}\n')

    await stop()

    expect(git('log', '--format=%s')).toBe('Automatic snapshot')
  })

  it('stops while a browser holds the live-updates stream open', async () => {
    const { server, stop } = await start()
    const { port } = server.address() as AddressInfo
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/api/events', headers: { host: '127.0.0.1:4747' } }, (res) =>
        resolve(res.statusCode),
      )
      req.on('error', reject)
      req.end()
    })
    expect(status).toBe(200)
    await stop()
  })

  it('snapshots a change made outside the app (CLI or agent) once it settles', async () => {
    await writeFile(join(contentRoot, 'people.json'), '[]\n')
    const { stop } = await startServer({
      port: 0,
      webDist: '/nonexistent',
      keychain: fakeKeychain({}).keychain,
      env: { OSTRAKA_HOME: contentRoot },
      snapshots: { quietMs: 100 },
    })
    try {
      // The Snapshot taken at start, of what was already there.
      await waitForCommits(1)
      await addTodo({ title: 'Added by an agent' }, { env: { OSTRAKA_HOME: contentRoot } })
      await waitForCommits(2)
      expect(git('status', '--porcelain')).toBe('')
    } finally {
      await stop()
    }
  })
})
