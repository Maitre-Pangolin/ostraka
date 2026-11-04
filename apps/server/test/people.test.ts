import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Person } from '@ostraka/core'
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
const post = (path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const json = async <T = Person>(res: Response | Promise<Response>) => (await (await res).json()) as T

describe('People routes', () => {
  it('adds a Person through core and lists the directory', async () => {
    const res = await post('/api/people', { name: 'Ilse Vantongeren', email: 'ilse.v@corp.example' })
    expect(res.status).toBe(201)
    const added = await json(res)
    expect(added).toEqual({ id: 'ilse-vantongeren', name: 'Ilse Vantongeren', aliases: [], email: 'ilse.v@corp.example' })
    expect(await json<Person[]>(get('/api/people'))).toEqual([added])
    expect(await json(get('/api/people/ilse-vantongeren'))).toEqual(added)
    expect(JSON.parse(await readFile(join(contentRoot, 'people.json'), 'utf8'))).toEqual({ people: [added] })
    expect(changes).toBe(1)
  })

  it('refuses an invalid Person, a taken id, and answers 404 for an unknown one', async () => {
    expect((await post('/api/people', { name: '' })).status).toBe(400)
    await post('/api/people', { id: 'bram', name: 'Bram Okonkwo' })
    expect((await post('/api/people', { id: 'bram', name: 'Bram O' })).status).toBe(409)
    expect((await get('/api/people/nobody')).status).toBe(404)
  })

  it('answers a broken people.json with its error', async () => {
    await writeFile(join(contentRoot, 'people.json'), '{ nope')
    const res = await get('/api/people')
    expect(res.status).toBe(409)
    expect((await json<{ error: string }>(res)).error).toMatch(/Invalid/)
  })
})
