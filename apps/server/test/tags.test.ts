import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/index.ts'

let contentRoot: string
let app: ReturnType<typeof createApp>
let changes: number

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  changes = 0
  app = createApp({ webDist: '/nonexistent', content: { env: { OSTRAKA_HOME: contentRoot } }, onContentChange: () => changes++ })
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
})

const headers = { host: '127.0.0.1:4747', origin: 'http://127.0.0.1:4747', 'content-type': 'application/json' }
const send = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers, ...(body !== undefined && { body: JSON.stringify(body) }) })
const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T

const write = async (path: string, text: string) => {
  await mkdir(join(contentRoot, path, '..'), { recursive: true })
  await writeFile(join(contentRoot, path), text)
}
const read = (path: string) => readFile(join(contentRoot, path), 'utf8')

beforeEach(async () => {
  await send('POST', '/api/todos', { title: 'Ship #infra #api' })
  await write('notes/plan.md', '---\ntags: [infra]\n---\n\n# Plan\n')
  await write('devlogs/2026-10-29.md', '---\ndate: 2026-10-29\ntags: [infra]\n---\n')
  changes = 0
})

describe('Tag management routes', () => {
  it('lists the Tags in use with their colours and how many items of each kind use them', async () => {
    expect(await json(send('GET', '/api/tags/usage'))).toEqual([
      { name: 'api', color: 'green', uses: { todos: 1, notes: 0, devlogs: 0, sketches: 0 } },
      { name: 'infra', color: 'orange', uses: { todos: 1, notes: 1, devlogs: 1, sketches: 0 } },
    ])
  })

  it('renames a Tag everywhere in one request, reported as one content change for the next Snapshot', async () => {
    const res = await send('POST', '/api/tags/infra/rename', { to: 'platform' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ todos: 1, notes: 1, devlogs: 1, sketches: 0 })
    expect(await read('notes/plan.md')).toBe('---\ntags: [platform]\n---\n\n# Plan\n')
    expect(changes).toBe(1)
  })

  it('merges a Tag into another', async () => {
    expect(await json(send('POST', '/api/tags/api/merge', { into: 'infra' }))).toEqual({ todos: 1, notes: 0, devlogs: 0, sketches: 0 })
    expect((await json<{ name: string }[]>(send('GET', '/api/tags'))).map((tag) => tag.name)).toEqual(['infra'])
  })

  it('deletes a Tag from everything using it', async () => {
    expect(await json(send('DELETE', '/api/tags/infra'))).toEqual({ todos: 1, notes: 1, devlogs: 1, sketches: 0 })
    expect(await read('devlogs/2026-10-29.md')).toBe('---\ndate: 2026-10-29\ntags: []\n---\n')
  })

  it('saves a colour to tags.yml, and clears it', async () => {
    expect((await send('PUT', '/api/tags/infra/color', { color: 'violet' })).status).toBe(204)
    expect(await read('tags.yml')).toBe('infra:\n  color: violet\n')
    await send('PUT', '/api/tags/infra/color', { color: null })
    expect(await read('tags.yml')).toBe('')
    expect(changes).toBe(2)
  })

  it('answers why a change is refused: a bad name or colour, a Tag not in use, a rename onto one in use', async () => {
    expect((await send('POST', '/api/tags/infra/rename', { to: '%%' })).status).toBe(400)
    expect((await send('PUT', '/api/tags/infra/color', { color: 'mauve' })).status).toBe(400)
    expect((await send('POST', '/api/tags/nope/rename', { to: 'other' })).status).toBe(404)
    const taken = await send('POST', '/api/tags/infra/rename', { to: 'api' })
    expect(taken.status).toBe(409)
    expect(await taken.json()).toEqual({ error: expect.stringContaining('merge') })
    expect(changes).toBe(0)
  })
})
