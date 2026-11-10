import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addTodo } from '@ostraka/core'
import { startServer } from '../src/index.ts'
import { fakeKeychain } from './fake-keychain.ts'

let contentRoot: string
/** The home folder: config and the search index's cache live under it, never the real one. */
let home: string

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  home = await mkdtemp(join(tmpdir(), 'ostraka-home-'))
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

const start = () =>
  startServer({ port: 0, webDist: '/nonexistent', keychain: fakeKeychain({}).keychain, env: { OSTRAKA_HOME: contentRoot }, homeDir: home })
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

  it('snapshots a change made outside the app (CLI or agent) when its timer fires', async () => {
    await writeFile(join(contentRoot, 'people.json'), '[]\n')
    const { stop } = await startServer({
      port: 0,
      webDist: '/nonexistent',
      keychain: fakeKeychain({}).keychain,
      env: { OSTRAKA_HOME: contentRoot },
      homeDir: home,
      snapshots: { intervalMs: 100 },
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

  it('builds its search index from the files at start, in the cache folder outside the content folder', async () => {
    await mkdir(join(contentRoot, 'notes'), { recursive: true })
    await writeFile(join(contentRoot, 'notes', 'n1.md'), '---\ntags: []\n---\n\n# Plan\n\nwombat\n')
    const { server, stop } = await start()
    try {
      const { port } = server.address() as AddressInfo
      const search = () =>
        new Promise<{ indexing: boolean; hits: { id: string }[] }>((resolve, reject) => {
          const req = request({ host: '127.0.0.1', port, path: '/api/search?q=wombat', headers: { host: '127.0.0.1:4747' } }, (res) => {
            let body = ''
            res.setEncoding('utf8')
            res.on('data', (chunk: string) => (body += chunk))
            res.on('end', () => resolve(JSON.parse(body)))
          })
          req.on('error', reject)
          req.end()
        })
      await vi.waitUntil(async () => !(await search()).indexing, { timeout: 5000, interval: 50 })
      expect((await search()).hits.map((hit) => hit.id)).toEqual(['n1'])
      expect((await stat(join(home, 'Library', 'Caches', 'ostraka', 'search.db'))).isFile()).toBe(true)
      expect(git('status', '--porcelain', '--ignored')).not.toMatch(/search/)
    } finally {
      await stop()
    }
  })
})
