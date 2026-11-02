import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Todo } from '@ostraka/core'
import { createApp } from '../src/index.ts'

let contentRoot: string
let app: ReturnType<typeof createApp>

const NOW = new Date(2026, 10, 2, 9, 30)

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  app = createApp({ webDist: '/nonexistent', content: { env: { OSTRAKA_HOME: contentRoot }, now: () => NOW } })
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
})

const headers = { host: '127.0.0.1:4747', origin: 'http://127.0.0.1:4747' }
const get = (path: string) => app.request(path, { headers })
const post = (path: string, body?: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { ...headers, ...(body !== undefined && { 'content-type': 'application/json' }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })
const del = (path: string) => app.request(path, { method: 'DELETE', headers })
const json = async <T = Todo>(res: Response | Promise<Response>) => (await (await res).json()) as T

const fixture = (id: string, extra: object) => ({
  id,
  title: id,
  priority: 'none',
  tags: [],
  status: 'open',
  createdAt: '2026-10-01T10:00:00.000Z',
  subTodos: [],
  ...extra,
})

describe('Todo routes', () => {
  it('lists no Todos before any is added', async () => {
    const res = await get('/api/todos')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('adds a Todo and lists it', async () => {
    const res = await post('/api/todos', { title: 'Review the release notes' })
    expect(res.status).toBe(201)
    const todo = await res.json()
    expect(todo).toMatchObject({ title: 'Review the release notes', status: 'open', createdAt: NOW.toISOString() })
    expect(await (await get('/api/todos')).json()).toEqual([todo])
  })

  it('lists open Todos in the automatic order', async () => {
    await writeFile(
      join(contentRoot, 'todos.json'),
      JSON.stringify({ todos: [fixture('nodue', {}), fixture('highp', { priority: 'high' }), fixture('overd', { due: '2026-10-30' })] }),
    )
    expect((await json<Todo[]>(get('/api/todos'))).map((todo) => todo.id)).toEqual(['overd', 'highp', 'nodue'])
  })

  it('marks a Todo done, and reopens it (Undo)', async () => {
    const todo = await json(post('/api/todos', { title: 'Ship it' }))

    const done = await post(`/api/todos/${todo.id}/done`)
    expect(done.status).toBe(200)
    expect(await done.json()).toMatchObject({ id: todo.id, status: 'done', finishedAt: NOW.toISOString() })
    expect(await (await get('/api/todos')).json()).toEqual([])

    const reopened = await post(`/api/todos/${todo.id}/reopen`)
    expect(reopened.status).toBe(200)
    expect(await reopened.json()).toEqual(todo)
    expect(await (await get('/api/todos')).json()).toEqual([todo])
  })

  it('Drops a Todo with an optional reason, lists it as finished, and reopens it (Undo)', async () => {
    const todo = await json(post('/api/todos', { title: 'Migrate the old CI' }))

    const dropped = await post(`/api/todos/${todo.id}/drop`, { reason: 'Superseded' })
    expect(dropped.status).toBe(200)
    expect(await dropped.json()).toEqual({ ...todo, status: 'dropped', dropReason: 'Superseded', finishedAt: NOW.toISOString() })
    expect(await json(get('/api/todos'))).toEqual([])
    expect(await json(get('/api/todos/finished'))).toEqual([
      { ...todo, status: 'dropped', dropReason: 'Superseded', finishedAt: NOW.toISOString() },
    ])

    await post(`/api/todos/${todo.id}/reopen`)
    expect(await json(get('/api/todos/finished'))).toEqual([])
    expect(await json(get('/api/todos'))).toEqual([todo])
  })

  it('Drops without a reason when no body is sent', async () => {
    const todo = await json(post('/api/todos', { title: 'Migrate the old CI' }))
    expect(await json(post(`/api/todos/${todo.id}/drop`))).toEqual({ ...todo, status: 'dropped', finishedAt: NOW.toISOString() })
  })

  it('rejects a reason that is not text', async () => {
    const todo = await json(post('/api/todos', { title: 'Migrate the old CI' }))
    expect((await post(`/api/todos/${todo.id}/drop`, { reason: 42 })).status).toBe(400)
  })

  it('lists done and Dropped Todos newest-finished first', async () => {
    await writeFile(
      join(contentRoot, 'todos.json'),
      JSON.stringify({
        todos: [
          fixture('older', { status: 'done', finishedAt: '2026-10-30T10:00:00.000Z' }),
          fixture('stays', {}),
          fixture('newer', { status: 'dropped', finishedAt: '2026-11-01T10:00:00.000Z' }),
        ],
      }),
    )
    expect((await json<Todo[]>(get('/api/todos/finished'))).map((todo) => todo.id)).toEqual(['newer', 'older'])
  })

  it('deletes a Todo, and restores it (Undo)', async () => {
    const todo = await json(post('/api/todos', { title: 'Typo' }))

    const deleted = await del(`/api/todos/${todo.id}`)
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toEqual(todo)
    expect(await json(get('/api/todos'))).toEqual([])

    const restored = await post('/api/todos/restore', todo)
    expect(restored.status).toBe(201)
    expect(await restored.json()).toEqual(todo)
    expect(await json(get('/api/todos'))).toEqual([todo])

    const again = await post('/api/todos/restore', todo)
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: `A Todo with id ${todo.id} already exists` })
  })

  it('rejects restoring something that is not a Todo', async () => {
    const res = await post('/api/todos/restore', { id: 'aaaaa', title: 'No fields' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: expect.any(String) })
  })

  it.each([[{}], [{ title: '   ' }], [{ title: 42 }]])('rejects %j as a new Todo', async (body) => {
    const res = await post('/api/todos', body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: expect.any(String) })
  })

  it.each([['done'], ['drop'], ['delete']])('answers 404 for an unknown Todo (%s)', async (action) => {
    const res = action === 'delete' ? await del('/api/todos/zzzzz') : await post(`/api/todos/zzzzz/${action}`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'No Todo with id zzzzz' })
  })

  it('reports an invalid todos.json instead of overwriting it', async () => {
    await writeFile(join(contentRoot, 'todos.json'), '{ "todos": [')
    for (const res of [await get('/api/todos'), await post('/api/todos', { title: 'Ship it' })]) {
      expect(res.status).toBe(409)
      expect((await json<{ error: string }>(res)).error).toMatch(/todos\.json/)
    }
  })
})
