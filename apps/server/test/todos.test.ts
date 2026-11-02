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
const patch = (path: string, body: unknown) =>
  app.request(path, { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) })
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

  it('adds a Todo with a description and the properties pulled out in quick entry, plus tokens left in the text', async () => {
    const res = await post('/api/todos', { title: 'Fix login ^today', description: 'Logs #infra', tags: ['auth'], priority: 'high' })
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({
      title: 'Fix login',
      description: 'Logs',
      tags: ['auth', 'infra'],
      priority: 'high',
      due: '2026-11-02',
    })
  })

  it('changes a Todo: title, description, Tags, priority and due date', async () => {
    const todo = await json(post('/api/todos', { title: 'Ship it #infra #api ^fri' }))
    const res = await patch(`/api/todos/${todo.id}`, { title: 'Ship it now *low', description: 'Check first', tags: ['api'], due: null })
    expect(res.status).toBe(200)
    const changed = await json(res)
    expect(changed).toEqual({ ...todo, title: 'Ship it now', description: 'Check first', tags: ['api'], priority: 'low', due: undefined })
    expect(await json<Todo[]>(get('/api/todos'))).toEqual([changed])
  })

  it.each([[{ title: '#only-a-tag' }], [{ priority: 'urgent' }], [{ due: 'friday' }], [{ id: 'zzzzz' }]])(
    'rejects %j as a change',
    async (body) => {
      const todo = await json(post('/api/todos', { title: 'Ship it' }))
      const res = await patch(`/api/todos/${todo.id}`, body)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: expect.any(String) })
    },
  )

  it('answers 404 when changing an unknown Todo', async () => {
    expect((await patch('/api/todos/zzzzz', { priority: 'high' })).status).toBe(404)
  })

  it('lists the Tags in use', async () => {
    await post('/api/todos', { title: 'One #infra #api' })
    await post('/api/todos', { title: 'Two #auth' })
    expect(await json<string[]>(get('/api/tags'))).toEqual(['api', 'auth', 'infra'])
  })

  it.each([[{}], [{ title: '   ' }], [{ title: 42 }], [{ title: '#auth *high' }]])('rejects %j as a new Todo', async (body) => {
    const res = await post('/api/todos', body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: expect.any(String) })
  })

  it('answers 404 for an unknown Todo', async () => {
    const res = await post('/api/todos/zzzzz/done')
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
