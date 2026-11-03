import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { snapshot, type FileSnapshot, type Restore } from '@ostraka/core'
import { createApp } from '../src/index.ts'

let contentRoot: string
let app: ReturnType<typeof createApp>
let changes: number
let backupsScheduled: number

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  changes = 0
  backupsScheduled = 0
  app = createApp({
    webDist: '/nonexistent',
    content: { env: { OSTRAKA_HOME: contentRoot } },
    onContentChange: () => changes++,
    backups: {
      status: () => Promise.reject(new Error('not used here')),
      snapshotted: () => backupsScheduled++,
    },
  })
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
})

const options = () => ({ env: { OSTRAKA_HOME: contentRoot } })
const headers = { host: '127.0.0.1:4747', origin: 'http://127.0.0.1:4747' }
const get = (path: string) => app.request(path, { headers })
const post = (path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T
const git = (...args: string[]) => execFileSync('git', ['-C', contentRoot, ...args], { encoding: 'utf8' }).trim()

const write = async (path: string, text: string) => {
  await mkdir(join(contentRoot, path, '..'), { recursive: true })
  await writeFile(join(contentRoot, path), text)
}

const V1 = '---\ntags: []\n---\n# Plan\n'
const V2 = '---\ntags: []\n---\n# Plan\n\nSecond.\n'

// Each git process takes a few hundred ms to spawn under the test runner on macOS.
describe('History routes', { timeout: 30_000 }, () => {
  it("lists a file's Snapshots, newest first, and answers one version's text", async () => {
    await write('notes/plan.md', V1)
    const first = await snapshot('first', options())
    await write('notes/plan.md', V2)
    const second = await snapshot('second', options())

    const history = await json<FileSnapshot[]>(get('/api/history?path=notes/plan.md'))
    expect(history).toEqual([
      { commit: second!.commit, message: 'second', date: expect.any(String) },
      { commit: first!.commit, message: 'first', date: expect.any(String) },
    ])

    const version = await json(get(`/api/history/${first!.commit}?path=notes/plan.md`))
    expect(version).toEqual({ path: 'notes/plan.md', commit: first!.commit, text: V1 })
  })

  it('works for todos.json like any other content file', async () => {
    await write('todos.json', '{"todos":[]}\n')
    const first = await snapshot('first', options())

    expect(await json(get('/api/history?path=todos.json'))).toEqual([{ commit: first!.commit, message: 'first', date: expect.any(String) }])
  })

  it('restores a version as a new Snapshot, counted as a content change and backed up, and answers the Snapshot to undo it', async () => {
    await write('notes/plan.md', V1)
    const first = await snapshot('first', options())
    await write('notes/plan.md', V2)
    const second = await snapshot('second', options())

    const res = await post('/api/history/restore', { path: 'notes/plan.md', commit: first!.commit })

    expect(res.status).toBe(200)
    expect(await json<Restore>(res)).toEqual({
      restored: {
        commit: git('rev-parse', 'HEAD'),
        message: expect.stringMatching(/^restore: notes\/plan\.md as of /),
        date: expect.any(String),
      },
      before: { commit: second!.commit, message: 'second', date: expect.any(String) },
    })
    expect(await readFile(join(contentRoot, 'notes/plan.md'), 'utf8')).toBe(V1)
    expect(git('rev-list', '--count', 'HEAD')).toBe('3')
    expect(changes).toBe(1)
    expect(backupsScheduled).toBe(1)
  })

  it('refuses a path that is not a content file (400) and a version that does not exist (404)', async () => {
    await write('todos.json', '{"todos":[]}\n')
    const first = await snapshot('first', options())

    expect((await get('/api/history?path=.git/config')).status).toBe(400)
    expect((await get('/api/history')).status).toBe(400)
    expect((await get(`/api/history/${first!.commit}?path=notes/plan.md`)).status).toBe(404)
    expect((await post('/api/history/restore', { path: '../todos.json', commit: first!.commit })).status).toBe(400)
    expect((await post('/api/history/restore', { path: 'todos.json' })).status).toBe(400)
    const missing = await post('/api/history/restore', { path: 'notes/plan.md', commit: first!.commit })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: expect.stringContaining('notes/plan.md') })
    expect(changes).toBe(0)
    expect(backupsScheduled).toBe(0)
  })
})
