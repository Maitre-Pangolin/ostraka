import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
const post = (path: string, body?: unknown, ifMatch?: string) =>
  app.request(path, {
    method: 'POST',
    headers: {
      ...headers,
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(ifMatch !== undefined && { 'if-match': ifMatch }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })
type VersionedTodo = Todo & { version: string }
const patch = (path: string, body: unknown) =>
  app.request(path, { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const del = (path: string, ifMatch?: string) =>
  app.request(path, { method: 'DELETE', headers: { ...headers, ...(ifMatch !== undefined && { 'if-match': ifMatch }) } })
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
    expect(changed).toEqual({
      ...todo,
      title: 'Ship it now',
      description: 'Check first',
      tags: ['api'],
      priority: 'low',
      due: undefined,
      version: expect.any(String),
    })
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

  it('lists the Tags in use with their colours from tags.yml', async () => {
    await post('/api/todos', { title: 'One #infra #api' })
    await post('/api/todos', { title: 'Two #auth' })
    await writeFile(join(contentRoot, 'tags.yml'), 'infra:\n  color: teal\n')
    expect(await json(get('/api/tags'))).toEqual([
      { name: 'api', color: 'green' },
      { name: 'auth', color: 'green' },
      { name: 'infra', color: 'teal' },
    ])
  })

  it('answers a broken tags.yml with its error, so the app shows it', async () => {
    await post('/api/todos', { title: 'One #api' })
    await writeFile(join(contentRoot, 'tags.yml'), 'api: [not, settings]\n')
    const res = await get('/api/tags')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: expect.stringContaining('tags.yml') })
  })

  it('Drops a Todo with an optional reason, lists it as finished, and reopens it (Undo)', async () => {
    const todo = await json(post('/api/todos', { title: 'Migrate the old CI' }))

    const dropped = await post(`/api/todos/${todo.id}/drop`, { reason: 'Superseded' })
    expect(dropped.status).toBe(200)
    expect(await dropped.json()).toEqual({
      ...todo,
      status: 'dropped',
      dropReason: 'Superseded',
      finishedAt: NOW.toISOString(),
      version: expect.any(String),
    })
    expect(await json(get('/api/todos'))).toEqual([])
    expect(await json(get('/api/todos/finished'))).toEqual([
      { ...todo, status: 'dropped', dropReason: 'Superseded', finishedAt: NOW.toISOString(), version: expect.any(String) },
    ])

    await post(`/api/todos/${todo.id}/reopen`)
    expect(await json(get('/api/todos/finished'))).toEqual([])
    expect(await json(get('/api/todos'))).toEqual([todo])
  })

  it('Drops without a reason when no body is sent', async () => {
    const todo = await json(post('/api/todos', { title: 'Migrate the old CI' }))
    expect(await json(post(`/api/todos/${todo.id}/drop`))).toEqual({
      ...todo,
      status: 'dropped',
      finishedAt: NOW.toISOString(),
      version: expect.any(String),
    })
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

  // The deleted Todo is posted back as the API answered it, version included.
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

  it.each([[{}], [{ title: '   ' }], [{ title: 42 }], [{ title: '#auth *high' }]])('rejects %j as a new Todo', async (body) => {
    const res = await post('/api/todos', body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: expect.any(String) })
  })

  it.each([['done'], ['drop'], ['delete']])('answers 404 for an unknown Todo (%s)', async (action) => {
    const res = action === 'delete' ? await del('/api/todos/zzzzz') : await post(`/api/todos/zzzzz/${action}`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'No Todo with id zzzzz' })
  })

  it('refuses a change made from a stale copy of a Todo, and takes one made from the current copy', async () => {
    const loaded = await json<VersionedTodo>(post('/api/todos', { title: 'Call Bob' }))
    const [listed] = await json<VersionedTodo[]>(get('/api/todos'))
    expect(listed).toEqual(loaded)

    const file = join(contentRoot, 'todos.json')
    const agentEdit = (await readFile(file, 'utf8')).replace('"Call Bob"', '"Call Bob about the contract"')
    await writeFile(file, agentEdit)

    const staleIfMatch = `"${loaded.version}"`
    for (const stale of [
      await post(`/api/todos/${loaded.id}/done`, undefined, staleIfMatch),
      await post(`/api/todos/${loaded.id}/drop`, {}, staleIfMatch),
      await del(`/api/todos/${loaded.id}`, staleIfMatch),
      await app.request(`/api/todos/${loaded.id}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/json', 'if-match': staleIfMatch },
        body: JSON.stringify({ title: 'Call Bobby' }),
      }),
    ]) {
      expect(stale.status).toBe(412)
      expect(await stale.json()).toEqual({ error: 'The Todo “Call Bob about the contract” changed since it was loaded.' })
    }
    expect(await readFile(file, 'utf8')).toBe(agentEdit)

    const [current] = await json<VersionedTodo[]>(get('/api/todos'))
    expect(current!.version).not.toBe(loaded.version)
    const done = await post(`/api/todos/${loaded.id}/done`, undefined, `"${current!.version}"`)
    expect(done.status).toBe(200)
    const doneTodo = await json<VersionedTodo>(done)
    expect(doneTodo.status).toBe('done')

    // Undo sends the version the done answer carried.
    const reopened = await post(`/api/todos/${loaded.id}/reopen`, undefined, `"${doneTodo.version}"`)
    expect(reopened.status).toBe(200)
  })

  it('reports an invalid todos.json instead of overwriting it', async () => {
    await writeFile(join(contentRoot, 'todos.json'), '{ "todos": [')
    for (const res of [await get('/api/todos'), await post('/api/todos', { title: 'Ship it' })]) {
      expect(res.status).toBe(409)
      expect((await json<{ error: string }>(res)).error).toMatch(/todos\.json/)
    }
  })
})
