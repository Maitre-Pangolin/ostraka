import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Note } from '@ostraka/core'
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
const json = async <T = Note>(res: Response | Promise<Response>) => (await (await res).json()) as T

const noteFile = (id: string) => join(contentRoot, 'notes', `${id}.md`)
const writeNote = async (id: string, text: string) => {
  await mkdir(join(contentRoot, 'notes'), { recursive: true })
  await writeFile(noteFile(id), text)
}

describe('Note routes', () => {
  it('starts a Note and lists it, without its body', async () => {
    const res = await send('POST', '/api/notes', { title: 'Release plan', tags: ['idea'] })
    expect(res.status).toBe(201)
    const note = await json(res)
    expect(note).toMatchObject({ title: 'Release plan', tags: ['idea'], body: '# Release plan\n', version: expect.any(String) })
    const { body: _body, ...summary } = note
    expect(await json(get('/api/notes'))).toEqual([summary])
  })

  it('lists a Note with a broken header with its error, and answers its error when it is opened', async () => {
    await writeNote('good', '---\ntags: []\n---\n# Good\n')
    await writeNote('bad', '---\ntags: [oops\n---\n')
    const listed = await json<{ id: string; error?: string }[]>(get('/api/notes'))
    expect(listed.map(({ id, error }) => ({ id, broken: error !== undefined }))).toEqual(
      expect.arrayContaining([
        { id: 'good', broken: false },
        { id: 'bad', broken: true },
      ]),
    )
    const res = await get('/api/notes/bad')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: expect.stringMatching(/header/i) })
  })

  it('lists only the Ideas with ?tag=idea', async () => {
    await writeNote('plain', '---\ntags: []\n---\n')
    await writeNote('idea', '---\ntags: [idea]\n---\n')
    expect((await json<Note[]>(get('/api/notes?tag=idea'))).map((note) => note.id)).toEqual(['idea'])
  })

  it('opens a Note with its body and version', async () => {
    await writeNote('plan', '---\ntags: [work]\n---\n\n# Plan\n')
    expect(await json(get('/api/notes/plan'))).toMatchObject({ id: 'plan', title: 'Plan', tags: ['work'], body: '# Plan\n' })
    expect((await get('/api/notes/nope')).status).toBe(404)
  })

  it('saves a body and Tags, keeping the header, and refuses a stale copy with 412', async () => {
    await writeNote('plan', '---\ntags: [work]  # mine\n---\n\nOld\n')
    const loaded = await json(get('/api/notes/plan'))
    const saved = await json(send('PATCH', '/api/notes/plan', { body: '* New', tags: ['work', 'idea'] }, loaded.version))
    expect(await readFile(noteFile('plan'), 'utf8')).toBe('---\ntags: [work, idea]  # mine\n---\n\n- New\n')
    expect(saved).toMatchObject({ body: '- New\n', tags: ['work', 'idea'] })

    const stale = await send('PATCH', '/api/notes/plan', { body: 'From the old copy' }, loaded.version)
    expect(stale.status).toBe(412)
    expect(await readFile(noteFile('plan'), 'utf8')).toBe('---\ntags: [work, idea]  # mine\n---\n\n- New\n')
  })

  it('refuses a change to a broken Note (409) and an invalid change (400)', async () => {
    await writeNote('bad', '---\ntags: [oops\n---\n')
    expect((await send('PATCH', '/api/notes/bad', { body: 'x' })).status).toBe(409)
    await writeNote('n', '---\ntags: []\n---\n')
    expect((await send('PATCH', '/api/notes/n', { tags: ['Bad Tag'] })).status).toBe(400)
    expect((await send('PATCH', '/api/notes/missing', { body: 'x' })).status).toBe(404)
  })

  it('suggests the Tags used by Notes along with those of Todos', async () => {
    await writeNote('n', '---\ntags: [release-plan]\n---\n')
    await send('POST', '/api/todos', { title: 'Ship #infra' })
    expect(await json<string[]>(get('/api/tags'))).toEqual(['infra', 'release-plan'])
  })

  it('counts a Note change as a content change, so a Snapshot follows', async () => {
    await send('POST', '/api/notes', {})
    expect(changes).toBe(1)
  })
})
