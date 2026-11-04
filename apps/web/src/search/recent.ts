// The items opened last, for an empty ⌘K: kept in this browser's storage, per viewer. Storage may be missing (a
// private window), full or hold anything, so reading falls back to nothing and writing never throws.
import { SEARCH_KINDS, type SearchKind } from '@ostraka/core/search-types'
import type { TodoStatus } from '@ostraka/core/todo-schema'
import { useEffect } from 'react'

/** An item as it was when opened: enough to show it and open it again. */
export type RecentItem = { kind: SearchKind; id: string; title: string; status?: TodoStatus; parentId?: string }

const KEY = 'ostraka.recent'
/** How many items ⌘K shows. */
export const RECENT_LIMIT = 8

type GetStorage = () => Storage
const browserStorage: GetStorage = () => localStorage

const isRecentItem = (value: unknown): value is RecentItem => {
  const item = value as Partial<RecentItem> | null
  return (
    typeof item === 'object' &&
    item !== null &&
    SEARCH_KINDS.includes(item.kind as SearchKind) &&
    typeof item.id === 'string' &&
    typeof item.title === 'string'
  )
}

/** The items opened last, the last one first. */
export function recentItems(storage: GetStorage = browserStorage): RecentItem[] {
  try {
    const stored: unknown = JSON.parse(storage().getItem(KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter(isRecentItem).slice(0, RECENT_LIMIT) : []
  } catch {
    return []
  }
}

/** Puts an item opened first in the list, once. Without storage, nothing is remembered. */
export function rememberOpened(item: RecentItem, storage: GetStorage = browserStorage) {
  const same = (other: RecentItem) => other.kind === item.kind && other.id === item.id
  const next = [item, ...recentItems(storage).filter((other) => !same(other))].slice(0, RECENT_LIMIT)
  try {
    storage().setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable or full: the list stays as it was.
  }
}

/** Remembers the item a view shows as opened, once it has loaded, and again when its title changes. */
export function useRememberOpened(kind: SearchKind, id: string, title: string | undefined) {
  useEffect(() => {
    if (title !== undefined) rememberOpened({ kind, id, title })
  }, [kind, id, title])
}
