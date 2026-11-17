// Which years, months and Weeks of the Dev logs list are open. By default the current year, month and Week are open,
// and the rest closed; elsewhere it is what the viewer chose, kept in browser storage as the groups they set apart from the
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
  return id === isoWeek(today).id
}

export const isGroupOpen = (state: GroupState, id: string, today: string) => state[id] ?? isOpenByDefault(id, today)

/** The state with `id` set open or closed; a group set back to its default is forgotten. */
export function setGroup(state: GroupState, id: string, open: boolean, today: string): GroupState {
  const rest = Object.fromEntries(Object.entries(state).filter(([key]) => key !== id))
  return open === isOpenByDefault(id, today) ? rest : { ...rest, [id]: open }
}

/**
 * The groups to open so a Dev log (a day, monthly summary or Week id) shows in the list, outermost first: its year
 * and month. A collapsed Week still shows its days as a strip, so it stays as it is. A Week runs over two months at
 * most and shows under both, so one already open is enough; with neither open, its Monday's month opens.
 */
export function groupsToReveal(log: string, isOpen: (id: string) => boolean): string[] {
  const week = weekRange(log)
  if (week) {
    const shown = [week.from, week.to].some((day) => isOpen(day.slice(0, 4)) && isOpen(day.slice(0, 7)))
    return shown ? [] : [week.from.slice(0, 4), week.from.slice(0, 7)]
  }
  return [log.slice(0, 4), log.slice(0, 7)]
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
  /** Sets these groups open or closed: saved, or for the scope only. */
  const setAll = (ids: string[], open: boolean) => {
    const changed = ids.filter((id) => isOpen(id) !== open)
    if (!changed.length) return
    if (scope !== undefined) setScoped({ scope, state: { ...temporary, ...Object.fromEntries(changed.map((id) => [id, open])) } })
    else save(changed.reduce((state, id) => setGroup(state, id, open, today), saved))
  }
  return {
    isOpen,
    setAll,
    toggle: (id: string) => setAll([id], !isOpen(id)),
    /** Opens the groups that show this Dev log (opened from a link, or from a range or search that ended). */
    reveal: (log: string) => setAll(groupsToReveal(log, isOpen), true),
  }
}
