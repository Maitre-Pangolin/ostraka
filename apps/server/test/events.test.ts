import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addTodo } from '@ostraka/core'
import { createApp } from '../src/index.ts'

let contentRoot: string
let app: ReturnType<typeof createApp>
let streams: ReadableStreamDefaultReader<Uint8Array>[]

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  app = createApp({ webDist: '/nonexistent', content: { env: { OSTRAKA_HOME: contentRoot } } })
  streams = []
})

afterEach(async () => {
  await Promise.all(streams.map((reader) => reader.cancel()))
  await rm(contentRoot, { recursive: true, force: true })
})

type SseEvent = { event: string; data: string }

/** Opens `/api/events` and reads it frame by frame; resolves once the watcher is ready. */
async function openEvents() {
  const res = await app.request('/api/events', { headers: { host: '127.0.0.1:4747' } })
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/)
  const reader = res.body!.getReader()
  streams.push(reader)
  const decoder = new TextDecoder()
  let buffer = ''

  const next = async (): Promise<SseEvent> => {
    for (;;) {
      const end = buffer.indexOf('\n\n')
      if (end >= 0) {
        const frame = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const field = (name: string) =>
          frame
            .split('\n')
            .filter((line) => line.startsWith(`${name}:`))
            .map((line) => line.slice(name.length + 1).trimStart())
            .join('\n')
        return { event: field('event') || 'message', data: field('data') }
      }
      const { value, done } = await reader.read()
      if (done) throw new Error('The event stream ended')
      buffer += decoder.decode(value, { stream: true })
    }
  }

  /** The next change event, or undefined if none arrives within `ms`. */
  const nextChange = (ms = 2000) =>
    Promise.race([
      next().then((event) => JSON.parse(event.data) as unknown),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
    ])

  expect((await next()).event).toBe('ready')
  return { nextChange }
}

describe('/api/events', () => {
  it('sends a todos event when a Todo is added from outside the app (as `ostraka todo add` does)', async () => {
    const events = await openEvents()
    await addTodo({ title: 'Added by an agent' }, { env: { OSTRAKA_HOME: contentRoot } })
    expect(await events.nextChange()).toEqual({ kind: 'todos' })
  })

  it('sends one clean event for a temp-file-then-rename save', async () => {
    await writeFile(join(contentRoot, 'todos.json'), '{ "todos": [] }\n')
    const events = await openEvents()
    await writeFile(join(contentRoot, 'todos.json.lock'), '{}')
    await writeFile(join(contentRoot, 'todos.json.123.tmp'), '{ "todos": [] }\n\n')
    await rename(join(contentRoot, 'todos.json.123.tmp'), join(contentRoot, 'todos.json'))
    await rm(join(contentRoot, 'todos.json.lock'))
    expect(await events.nextChange()).toEqual({ kind: 'todos' })
    expect(await events.nextChange(300)).toBeUndefined()
  })

  it('names the item for a Markdown file in a kind folder', async () => {
    await mkdir(join(contentRoot, 'notes'))
    const events = await openEvents()
    await writeFile(join(contentRoot, 'notes', '.release-plan.md.tmp'), '# Release plan\n')
    await rename(join(contentRoot, 'notes', '.release-plan.md.tmp'), join(contentRoot, 'notes', 'release-plan.md'))
    expect(await events.nextChange()).toEqual({ kind: 'notes', id: 'release-plan' })
  })

  it('ignores files that are not content', async () => {
    const events = await openEvents()
    await mkdir(join(contentRoot, '.git'))
    await writeFile(join(contentRoot, '.git', 'index'), 'x')
    await writeFile(join(contentRoot, 'README.md'), 'x')
    await writeFile(join(contentRoot, 'todos.json.lock'), '{}')
    expect(await events.nextChange(300)).toBeUndefined()
  })
})
