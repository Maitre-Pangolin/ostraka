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
type Change = { kind: string; id?: string }

/**
 * Files no test writes otherwise, at the top of the content folder like `todos.json`, so their changes come through
 * the same watch as the changes they follow. Settles take turns, so a late repeat of the last marker is never taken
 * for the current one.
 */
const MARKERS = [
  { kind: 'tags', file: 'tags.yml' },
  { kind: 'people', file: 'people.json' },
] as const
const isMarker = (change: Change) => MARKERS.some(({ kind }) => kind === change.kind)

/** Opens `/api/events` and reads it frame by frame; resolves once the watcher is ready and has settled. */
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

  const nextAny = async () => JSON.parse((await next()).data) as Change
  let settles = 0

  /** The next change, markers left out. Nothing waits on a clock: a change that never comes fails by the test's timeout. */
  const nextChange = async (): Promise<Change> => {
    for (;;) {
      const change = await nextAny()
      if (!isMarker(change)) return change
    }
  }

  /**
   * The changes not read yet, in order, with nothing done meanwhile. A change of its own (a marker file written now)
   * comes after them, so the changes read until it arrives are those: an empty list means none came, without
   * waiting a set time for one. Markers are left out.
   */
  const settle = async (): Promise<Change[]> => {
    const marker = MARKERS[settles++ % MARKERS.length]!
    await writeFile(join(contentRoot, marker.file), `# settle ${settles}\n`)
    const changes: Change[] = []
    for (;;) {
      const change = await nextAny()
      if (change.kind === marker.kind) return changes
      if (!isMarker(change)) changes.push(change)
    }
  }

  expect((await next()).event).toBe('ready')
  // Whatever happened before the stream opened is behind us before a test acts.
  await settle()
  return { nextChange, settle }
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
    expect(await events.settle()).toEqual([])
  })

  it('names the item for a Markdown file in a kind folder', async () => {
    await mkdir(join(contentRoot, 'notes'))
    const events = await openEvents()
    await writeFile(join(contentRoot, 'notes', '.release-plan.md.tmp'), '# Release plan\n')
    await rename(join(contentRoot, 'notes', '.release-plan.md.tmp'), join(contentRoot, 'notes', 'release-plan.md'))
    expect(await events.nextChange()).toEqual({ kind: 'notes', id: 'release-plan' })
  })

  it("names the Sketch an agent edits in place, so the open Sketch shows the agent's change", async () => {
    await mkdir(join(contentRoot, 'sketches'))
    await writeFile(join(contentRoot, 'sketches', 'login.md'), '---\ntitle: Login\n---\n\n```mermaid\nflowchart TD\n```\n')
    const events = await openEvents()
    await writeFile(join(contentRoot, 'sketches', 'login.md'), '---\ntitle: Login\n---\n\n```mermaid\nflowchart TD\n  a --> b\n```\n')
    expect(await events.nextChange()).toEqual({ kind: 'sketches', id: 'login' })
  })

  it('ignores files that are not content', async () => {
    const events = await openEvents()
    await mkdir(join(contentRoot, '.git'))
    await writeFile(join(contentRoot, '.git', 'index'), 'x')
    await writeFile(join(contentRoot, 'README.md'), 'x')
    await writeFile(join(contentRoot, 'todos.json.lock'), '{}')
    expect(await events.settle()).toEqual([])
  })
})
