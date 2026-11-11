import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/index.ts'

const INDEX = '<!doctype html><title>Ostraka</title><div id="root"></div>'
let webDist: string

beforeAll(async () => {
  webDist = await mkdtemp(join(tmpdir(), 'ostraka-web-'))
  await mkdir(join(webDist, 'assets'))
  await writeFile(join(webDist, 'index.html'), INDEX)
  await writeFile(join(webDist, 'assets', 'app.js'), 'console.log("app")')
  await writeFile(join(webDist, 'manifest.webmanifest'), '{"name":"Ostraka"}')
})

afterAll(async () => {
  await rm(webDist, { recursive: true, force: true })
})

const get = (path: string) => createApp({ webDist }).request(path, { headers: { host: 'localhost:4747' } })

describe('serving the web app', () => {
  it('serves index.html at /', async () => {
    const res = await get('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    expect(await res.text()).toBe(INDEX)
  })

  it('serves built assets', async () => {
    const res = await get('/assets/app.js')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('console.log("app")')
  })

  it('serves the web-app manifest as a manifest, so the browser offers to install the app', async () => {
    const res = await get('/manifest.webmanifest')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^application\/manifest\+json/)
  })

  it.each(['/todos', '/devlogs', '/settings'])('serves index.html for the client route %s', async (path) => {
    const res = await get(path)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(INDEX)
  })

  it('answers an unknown API path with a JSON 404, not the web app', async () => {
    const res = await get('/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
  })

  it('says how to build the web app when it is missing', async () => {
    const res = await createApp({ webDist: join(webDist, 'missing') }).request('/', { headers: { host: 'localhost:4747' } })
    expect(res.status).toBe(503)
    expect(await res.text()).toMatch(/pnpm build/)
  })
})
