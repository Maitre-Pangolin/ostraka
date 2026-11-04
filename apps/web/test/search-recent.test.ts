// ⌘K's recently opened items live in browser storage, which may be missing, full or hold anything.
import { describe, expect, it } from 'vitest'
import { recentItems, rememberOpened, type RecentItem } from '../src/search/recent'

/** A Storage kept in a Map, as a browser's. */
function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  }
}

const item = (id: string, kind: RecentItem['kind'] = 'note'): RecentItem => ({ kind, id, title: `Title ${id}` })

describe('recently opened items', () => {
  it('lists the items opened, the last one first, each once', () => {
    const storage = memoryStorage()
    for (const id of ['a', 'b', 'c', 'a']) rememberOpened(item(id), () => storage)
    expect(recentItems(() => storage).map((recent) => recent.id)).toEqual(['a', 'c', 'b'])
  })

  it('tells items apart by kind', () => {
    const storage = memoryStorage()
    rememberOpened(item('2026-10', 'devlog'), () => storage)
    rememberOpened(item('2026-10', 'note'), () => storage)
    expect(recentItems(() => storage).map((recent) => recent.kind)).toEqual(['note', 'devlog'])
  })

  it('keeps the 8 most recent', () => {
    const storage = memoryStorage()
    for (let n = 1; n <= 10; n++) rememberOpened(item(String(n)), () => storage)
    expect(recentItems(() => storage).map((recent) => recent.id)).toEqual(['10', '9', '8', '7', '6', '5', '4', '3'])
  })

  it('works without storage: nothing is listed and nothing throws', () => {
    const missing = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
    expect(() => rememberOpened(item('a'), missing)).not.toThrow()
    expect(recentItems(missing)).toEqual([])
    const full = { ...memoryStorage(), setItem: missing }
    expect(() => rememberOpened(item('a'), () => full)).not.toThrow()
  })

  it('ignores what it cannot read back', () => {
    const storage = memoryStorage()
    storage.setItem('ostraka.recent', '{not json')
    expect(recentItems(() => storage)).toEqual([])
    storage.setItem('ostraka.recent', JSON.stringify([item('a'), { kind: 'nope', id: 1 }, 'x']))
    expect(recentItems(() => storage)).toEqual([item('a')])
  })
})
