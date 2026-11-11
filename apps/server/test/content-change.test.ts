import { mkdtemp, rm } from 'node:fs/promises'
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
const request = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers, ...(body !== undefined && { body: JSON.stringify(body) }) })

describe('content changes (the automatic Snapshot trigger)', () => {
  it('are reported after each successful write', async () => {
    const added = await request('POST', '/api/todos', { title: 'Ship it' })
    expect(changes).toBe(1)

    const { id } = (await added.json()) as { id: string }
    await request('POST', `/api/todos/${id}/done`)
    await request('POST', `/api/todos/${id}/reopen`)
    expect(changes).toBe(3)
  })

  it('are not reported for reads or refused writes', async () => {
    await request('GET', '/api/todos')
    await request('POST', '/api/todos', { title: '' })
    await request('POST', '/api/todos/zzzzz/done')
    expect(changes).toBe(0)
  })
})
