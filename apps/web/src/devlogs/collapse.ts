// Which years, months and Weeks of the Dev logs list are open. By default the current year and month are open, and
// every Week; elsewhere it is what the viewer chose, kept in browser storage as the groups they set apart from the
// default (by id: `2026`, `2026-11`, `2026-W47`), so the default moves on with the calendar. A date range or a search
// opens every group it shows instead, its toggles lasting while it does (`useDevlogGroups`).
import { isoWeek, weekRange } from '@ostraka/core/devlog-days'
import { useState } from 'react'

/** Group id → open, for the groups set apart from their default. */
export type GroupState = Record<string, boolean>

const KEY = 'ostraka.devlogs.groups'
const YEAR = /^\d{4}$/
const MONTH = /^\d{4}-\d{2}$/

export function isOpenByDefault(id: string, today: string): boolean {
  if (YEAR.test(id)) return id === today.slice(0, 4)
  if (MONTH.test(id)) return id === today.slice(0, 7)
  return true
}

export const isGroupOpen = (state: GroupState, id: string, today: string) => state[id] ?? isOpenByDefault(id, today)

/** The state with `id` set open or closed; a group set back to its default is forgotten. */
export function setGroup(state: GroupState, id: string, open: boolean, today: string): GroupState {
  const rest = Object.fromEntries(Object.entries(state).filter(([key]) => key !== id))
  return open === isOpenByDefault(id, today) ? rest : { ...rest, [id]: open }
}

/** The groups holding a Dev log (a day, monthly summary or Week id), outermost first: its year, month and Week. */
export function groupsOf(log: string): string[] {
  const week = weekRange(log)
  if (week) return [...new Set([week.from, week.to].flatMap((day) => [day.slice(0, 4), day.slice(0, 7)])), log]
  if (MONTH.test(log)) return [log.slice(0, 4), log]
  return [log.slice(0, 4), log.slice(0, 7), isoWeek(log).id]
}

export function loadGroups(): GroupState {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (!stored || typeof stored !== 'object') return {}
    return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
  } catch {
    return {}
  }
}

function saveGroups(state: GroupState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Storage unavailable (private window): the choice lasts for this session only.
  }
}

/**
 * The list's open groups. `scope` names a date range or search the list is narrowed to: while it is set, every group
 * starts open and toggles last until the scope changes, leaving the saved state alone.
 */
export function useDevlogGroups(today: string, scope: string | undefined) {
  const [saved, setSaved] = useState(loadGroups)
  const [scoped, setScoped] = useState<{ scope?: string; state: GroupState }>({ state: {} })
  const temporary = scoped.scope === scope ? scoped.state : {}
  const isOpen = (id: string) => (scope === undefined ? isGroupOpen(saved, id, today) : (temporary[id] ?? true))
  const save = (next: GroupState) => {
    setSaved(next)
    saveGroups(next)
  }
  return {
    isOpen,
    toggle(id: string) {
      if (scope !== undefined) setScoped({ scope, state: { ...temporary, [id]: !isOpen(id) } })
      else save(setGroup(saved, id, !isOpen(id), today))
    },
    /** Opens these groups, saved when the list isn't narrowed (a Dev log opened from a link). */
    reveal(ids: string[]) {
      const closed = ids.filter((id) => !isOpen(id))
      if (!closed.length) return
      if (scope !== undefined) setScoped({ scope, state: { ...temporary, ...Object.fromEntries(closed.map((id) => [id, true])) } })
      else save(closed.reduce((state, id) => setGroup(state, id, true, today), saved))
    },
  }
}
