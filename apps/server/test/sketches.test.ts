import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Sketch } from '@ostraka/core'
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
const json = async <T = Sketch>(res: Response | Promise<Response>) => (await (await res).json()) as T

const sketchFile = (id: string) => join(contentRoot, 'sketches', `${id}.md`)
const writeSketch = async (id: string, text: string) => {
  await mkdir(join(contentRoot, 'sketches'), { recursive: true })
  await writeFile(sketchFile(id), text)
}
const FLOW = '```mermaid\nflowchart TD\n  a --> b\n```\n'

describe('Sketch routes', () => {
  it('starts a Sketch and lists it by title and Tags, without its Mermaid text', async () => {
    const res = await send('POST', '/api/sketches', { title: 'Login flow', tags: ['auth'] })
    expect(res.status).toBe(201)
    const sketch = await json(res)
    expect(sketch).toMatchObject({
      title: 'Login flow',
      tags: ['auth'],
      mermaid: expect.stringMatching(/^flowchart/),
      version: expect.any(String),
    })
    const { mermaid: _mermaid, ...summary } = sketch
    expect(await json(get('/api/sketches'))).toEqual([summary])
    expect(changes).toBe(1)
  })

  it('refuses to start a Sketch without a title', async () => {
    expect((await send('POST', '/api/sketches', {})).status).toBe(400)
  })

  it('lists a broken Sketch with its error, and answers its error when it is opened', async () => {
    await writeSketch('good', `---\ntitle: Good\n---\n\n${FLOW}`)
    await writeSketch('bad', '---\ntitle: Bad\n---\n\nNo diagram\n')
    const listed = await json<{ id: string; error?: string }[]>(get('/api/sketches'))
    expect(listed.map(({ id, error }) => ({ id, broken: error !== undefined }))).toEqual(
      expect.arrayContaining([
        { id: 'good', broken: false },
        { id: 'bad', broken: true },
      ]),
    )
    const res = await get('/api/sketches/bad')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: expect.stringMatching(/Mermaid/) })
  })

  it('opens a Sketch with its Mermaid text and version, and finds no unknown one', async () => {
    await writeSketch('flow', `---\ntitle: Flow\ntags: [web]\n---\n\n${FLOW}`)
    expect(await json(get('/api/sketches/flow'))).toMatchObject({
      id: 'flow',
      title: 'Flow',
      tags: ['web'],
      mermaid: 'flowchart TD\n  a --> b',
    })
    expect((await get('/api/sketches/nope')).status).toBe(404)
  })

  it('saves Mermaid text, title and Tags, and refuses a stale copy with 412', async () => {
    await writeSketch('flow', `---\ntitle: Flow\n---\n\n${FLOW}`)
    const loaded = await json(get('/api/sketches/flow'))
    const saved = await json(
      send('PATCH', '/api/sketches/flow', { mermaid: 'flowchart TD\n  a --> c', title: 'Flow 2', tags: ['web'] }, loaded.version),
    )
    expect(saved).toMatchObject({ mermaid: 'flowchart TD\n  a --> c', title: 'Flow 2', tags: ['web'] })
    expect(await readFile(sketchFile('flow'), 'utf8')).toBe(
      '---\ntitle: Flow 2\ntags: [web]\n---\n\n```mermaid\nflowchart TD\n  a --> c\n```\n',
    )
    const stale = await send('PATCH', '/api/sketches/flow', { mermaid: 'flowchart TD' }, loaded.version)
    expect(stale.status).toBe(412)
  })

  it('refuses a change to a Sketch with no Mermaid block (409) and an unknown field (400)', async () => {
    await writeSketch('bad', '---\ntitle: Bad\n---\n\nNo diagram\n')
    expect((await send('PATCH', '/api/sketches/bad', { mermaid: 'flowchart TD' })).status).toBe(409)
    await writeSketch('flow', `---\ntitle: Flow\n---\n\n${FLOW}`)
    expect((await send('PATCH', '/api/sketches/flow', { body: 'x' })).status).toBe(400)
  })

  it('offers the Tags of Sketches among the Tags in use', async () => {
    await writeSketch('flow', `---\ntitle: Flow\ntags: [diagrams]\n---\n\n${FLOW}`)
    expect(await json<{ name: string }[]>(get('/api/tags'))).toEqual([{ name: 'diagrams', color: expect.any(String) }])
  })
})
