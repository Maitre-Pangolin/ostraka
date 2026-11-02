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

  it.each([[{}], [{ title: '   ' }], [{ title: 42 }]])('rejects %j as a new Todo', async (body) => {
    const res = await post('/api/todos', body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: expect.any(String) })
  })

  it('answers 404 for an unknown Todo', async () => {
    const res = await post('/api/todos/zzzzz/done')
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

    const stale = await post(`/api/todos/${loaded.id}/done`, undefined, `"${loaded.version}"`)
    expect(stale.status).toBe(412)
    expect(await stale.json()).toEqual({ error: 'The Todo “Call Bob about the contract” changed since it was loaded.' })
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
