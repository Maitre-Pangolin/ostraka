import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Devlog, DevlogListing } from '@ostraka/core'
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

const headers = { host: '127.0.0.1:4747', origin: 'http://127.0.0.1:4747' }
const get = (path: string) => app.request(path, { headers })
const send = (method: string, path: string, body: unknown, ifMatch?: string) =>
  app.request(path, {
    method,
    headers: { ...headers, 'content-type': 'application/json', ...(ifMatch !== undefined && { 'if-match': `"${ifMatch}"` }) },
    body: JSON.stringify(body),
  })
const json = async <T = Devlog>(res: Response | Promise<Response>) => (await (await res).json()) as T

const devlogFile = (id: string) => join(contentRoot, 'devlogs', `${id}.md`)
const writeDevlog = async (id: string, text: string) => {
  await mkdir(join(contentRoot, 'devlogs'), { recursive: true })
  await writeFile(devlogFile(id), text)
}

describe('Dev log routes', () => {
  it('lists days and monthly summaries without bodies, broken files with their error', async () => {
    await writeDevlog('2026-10-29', '---\ndate: 2026-10-29\ntags: [billing]\n---\n\n## Done\n\n- One\n')
    await writeDevlog('2026-10', '---\nmonth: 2026-10\n---\n\n# October\n')
    await writeDevlog('2026-10-30', '---\ndate: [oops\n---\n')
    const listed = await json<DevlogListing[]>(get('/api/devlogs'))
    expect(listed.map((log) => [log.id, 'kind' in log ? log.kind : 'broken', 'body' in log])).toEqual([
      ['2026-10-30', 'broken', false],
      ['2026-10-29', 'day', false],
      ['2026-10', 'month', false],
    ])
  })

  it('opens one with its body, answers a broken one with its error and a missing one with 404', async () => {
    await writeDevlog('2026-10-29', '---\ndate: 2026-10-29\n---\n\n## Done\n\n- One\n')
    await writeDevlog('2026-10-30', '---\ndate: 2026-10-31\n---\n')
    expect(await json(get('/api/devlogs/2026-10-29'))).toMatchObject({
      kind: 'day',
      body: '## Done\n\n- One\n',
      version: expect.any(String),
    })
    const broken = await get('/api/devlogs/2026-10-30')
    expect(broken.status).toBe(409)
    expect(await json<{ error: string }>(broken)).toEqual({ error: expect.stringContaining('2026-10-31') })
    expect((await get('/api/devlogs/2026-10-28')).status).toBe(404)
  })

  it('reads the days of a date range with their bodies, and asks for both ends', async () => {
    await writeDevlog('2026-10-28', '---\ndate: 2026-10-28\n---\n\n- A\n')
    await writeDevlog('2026-10-29', '---\ndate: 2026-10-29\n---\n\n- B\n')
    await writeDevlog('2026-11-02', '---\ndate: 2026-11-02\n---\n')
    const days = await json<Devlog[]>(get('/api/devlogs/days?from=2026-10-29&to=2026-11-01'))
    expect(days.map((day) => [day.id, day.body])).toEqual([['2026-10-29', '- B\n']])
    expect((await get('/api/devlogs/days?from=2026-10-29')).status).toBe(400)
  })

  it('saves an edited body from the loaded version, refusing a stale one, and counts it as a content change', async () => {
    await writeDevlog('2026-10-29', '---\ndate: 2026-10-29\n---\n\n- One\n')
    const loaded = await json(get('/api/devlogs/2026-10-29'))
    const saved = await send('PATCH', '/api/devlogs/2026-10-29', { body: '* Two\n' }, loaded.version)
    expect(saved.status).toBe(200)
    expect(await readFile(devlogFile('2026-10-29'), 'utf8')).toBe('---\ndate: 2026-10-29\n---\n\n- Two\n')
    expect(changes).toBe(1)
    expect((await send('PATCH', '/api/devlogs/2026-10-29', { body: 'Three' }, loaded.version)).status).toBe(412)
    expect((await send('PATCH', '/api/devlogs/2026-10-29', { tags: ['x'] })).status).toBe(400)
  })

  it('suggests the Tags used by Dev logs along with those of Todos', async () => {
    await writeDevlog('2026-10-29', '---\ndate: 2026-10-29\ntags: [billing]\n---\n')
    await send('POST', '/api/todos', { title: 'Ship #infra' })
    expect((await json<{ name: string }[]>(get('/api/tags'))).map((tag) => tag.name)).toEqual(['billing', 'infra'])
  })
})
