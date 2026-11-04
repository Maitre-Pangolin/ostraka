// @vitest-environment jsdom
// Saving an open file as it is edited (Notes, Sketches, Dev logs): nothing on opening, after a pause in typing, from
// the version the editor was loaded with; a stale save shows the newer version; leaving saves what is waiting.
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreFile } from '../src/history/api.ts'
import { ApiError } from '../src/lib/api.ts'
import { SAVE_AFTER_MS, useAutosave, type Autosave, type SaveState } from '../src/lib/use-autosave.ts'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

type Item = { body: string; version: string }
type Change = { body?: string; tags?: string[] }
type Saved = { change: Change; version: string }

/** A file served by a fake: its query, its save mutation and what reached it. */
function fakeFile(initial: Item) {
  let item = initial
  const saves: Saved[] = []
  const closing: Saved[] = []
  let refuse = false
  return {
    saves,
    closing,
    get item() {
      return item
    },
    /** A change made elsewhere: the next save from an older version is refused. */
    changeElsewhere(next: Item) {
      item = next
      refuse = true
    },
    /** The query fetched the file again (after a restore): a new copy, at whatever version it is. */
    refetched() {
      item = { ...item }
    },
    query: () => ({ data: item, refetch: async () => ({ data: item }) }) as never,
    update: {
      isPending: false,
      mutate(
        { version, ...change }: Change & { version: string },
        callbacks?: { onSuccess?: (saved: Item) => void; onError?: (error: Error) => void },
      ) {
        saves.push({ change, version })
        if (refuse) return void callbacks?.onError?.(new ApiError(412, 'Changed elsewhere.'))
        item = { body: change.body ?? item.body, version: `${version}+` }
        callbacks?.onSuccess?.(item)
      },
    },
    saveOnClose: (change: Change, version: string) => void closing.push({ change, version }),
  }
}

let root: Root
let container: HTMLElement
let autosave: Autosave<Change>
const states: SaveState[] = []
let error: string | undefined

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  root = createRoot(container)
  states.length = 0
  error = undefined
})

afterEach(() => {
  act(() => root.unmount())
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function Editor({ file }: { file: ReturnType<typeof fakeFile> }) {
  const current = useAutosave({
    path: 'notes/plan.md',
    query: file.query(),
    update: file.update as never,
    textOf: (item: Item) => item.body,
    changeOf: (body) => ({ body }),
    saveOnClose: file.saveOnClose,
    onState: (state) => states.push(state),
    onError: (message) => (error = message),
  })
  useEffect(() => {
    autosave = current
  })
  return null
}

/** Shows the file, or renders it again with what its query has now. */
const open = (file: ReturnType<typeof fakeFile>) => act(() => root.render(<Editor file={file} />))

const type = (text: string) => act(() => autosave.onEdit(text))
const pause = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

describe('useAutosave', () => {
  it('loads the file and saves nothing on opening', () => {
    const file = fakeFile({ body: 'Hello', version: 'v1' })
    open(file)
    expect(autosave.loaded).toEqual({ text: 'Hello', version: 'v1', count: 1 })
    pause(5000)
    expect(file.saves).toEqual([])
  })

  it('saves the latest text once typing pauses, from the version it was loaded with', () => {
    const file = fakeFile({ body: 'Hello', version: 'v1' })
    open(file)
    type('Hello w')
    pause(SAVE_AFTER_MS - 1)
    type('Hello world')
    pause(SAVE_AFTER_MS - 1)
    expect(file.saves).toEqual([])
    pause(1)
    expect(file.saves).toEqual([{ change: { body: 'Hello world' }, version: 'v1' }])
    expect(states).toEqual(['editing', 'editing', 'saving', 'saved'])
  })

  it('does not reload the editor for its own save', () => {
    const file = fakeFile({ body: 'Hello', version: 'v1' })
    open(file)
    type('Hello world')
    pause(SAVE_AFTER_MS)
    open(file)
    expect(autosave.loaded).toEqual({ text: 'Hello', version: 'v1', count: 1 })
  })

  it('shows a change made elsewhere at once when nothing is waiting', () => {
    const file = fakeFile({ body: 'Hello', version: 'v1' })
    open(file)
    file.changeElsewhere({ body: 'From an agent', version: 'v2' })
    open(file)
    expect(autosave.loaded).toEqual({ text: 'From an agent', version: 'v2', count: 2 })
  })

  it('refuses a stale save, says so and shows the newer version', async () => {
    const file = fakeFile({ body: 'Hello', version: 'v1' })
    open(file)
    type('Hello world')
    file.changeElsewhere({ body: 'From an agent', version: 'v2' })
    await act(async () => void vi.advanceTimersByTime(SAVE_AFTER_MS))
    expect(error).toBe('Changed elsewhere. Showing the newer version.')
    expect(autosave.loaded).toEqual({ text: 'From an agent', version: 'v2', count: 2 })
    expect(states.at(-1)).toBe('saved')
  })

  it('saves what is waiting with another change, and on flush', () => {
    const file = fakeFile({ body: 'Hello', version: 'v1' })
    open(file)
    type('Hello world')
    act(() => autosave.change({ tags: ['plan'] }))
    expect(file.saves).toEqual([
      { change: { body: 'Hello world' }, version: 'v1' },
      { change: { tags: ['plan'] }, version: 'v1' },
    ])
    type('Hello again')
    act(() => autosave.flush())
    expect(file.saves.at(-1)).toEqual({ change: { body: 'Hello again' }, version: 'v1' })
  })

  it('saves what is waiting on leaving, and at once as the window closes', () => {
    const file = fakeFile({ body: 'Hello', version: 'v1' })
    open(file)
    type('Hello world')
    act(() => void window.dispatchEvent(new Event('pagehide')))
    expect(file.closing).toEqual([{ change: { body: 'Hello world' }, version: 'v1' }])
    type('Hello again')
    act(() => root.unmount())
    expect(file.saves).toEqual([{ change: { body: 'Hello again' }, version: 'v1' }])
  })

  it('reloads after a restore of its file, even at a version it saved', () => {
    const file = fakeFile({ body: 'Hello', version: 'v1' })
    open(file)
    type('Hello world')
    pause(SAVE_AFTER_MS)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    void restoreFile('notes/plan.md', 'abc1234')
    file.refetched()
    open(file)
    expect(autosave.loaded).toEqual({ text: 'Hello world', version: 'v1+', count: 2 })
  })
})
