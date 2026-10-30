// PROTOTYPE: quick-entry parsing, sorting and filtering for #10. Throw away.
import { TAG_COLORS, TODAY, type Priority, type Todo } from './data'

const DAY = 86_400_000
const toDate = (s: string) => new Date(s + 'T00:00:00')
const iso = (d: Date) => d.toISOString().slice(0, 10)
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export const daysFromToday = (due: string) => Math.round((toDate(due).getTime() - toDate(TODAY).getTime()) / DAY)

export function dueLabel(due: string): { text: string; tone: 'overdue' | 'today' | 'soon' | 'later' } {
  const d = daysFromToday(due)
  if (d < 0) return { text: d === -1 ? 'yesterday' : `${-d}d late`, tone: 'overdue' }
  if (d === 0) return { text: 'today', tone: 'today' }
  if (d === 1) return { text: 'tomorrow', tone: 'soon' }
  const date = toDate(due)
  if (d < 7) return { text: date.toLocaleDateString('en-GB', { weekday: 'short' }), tone: 'soon' }
  return { text: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), tone: 'later' }
}

function parseDue(word: string): string | undefined {
  const w = word.toLowerCase()
  const today = toDate(TODAY)
  if (w === 'today') return TODAY
  if (w === 'tomorrow' || w === 'tmr') return iso(new Date(today.getTime() + DAY))
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w
  const wd = WEEKDAYS.indexOf(w.slice(0, 3))
  if (wd >= 0) {
    const ahead = (wd - today.getDay() + 7) % 7 || 7
    return iso(new Date(today.getTime() + ahead * DAY))
  }
  return undefined
}

const PRIO: Record<string, Priority> = { high: 'high', h: 'high', med: 'med', m: 'med', low: 'low', l: 'low' }

export type Parsed = { title: string; tags: string[]; priority: Priority; due?: string }

// `#tag`, `!high|!med|!low`, `^today|^fri|^2026-11-05` become properties and leave the title.
export function parseQuickEntry(input: string): Parsed {
  const tags: string[] = []
  let priority: Priority = null
  let due: string | undefined
  const rest: string[] = []
  for (const word of input.split(/\s+/).filter(Boolean)) {
    if (/^#[a-z0-9-]+$/i.test(word)) tags.push(word.slice(1).toLowerCase())
    else if (word.startsWith('!') && PRIO[word.slice(1).toLowerCase()]) priority = PRIO[word.slice(1).toLowerCase()]
    else if (word.startsWith('^') && parseDue(word.slice(1))) due = parseDue(word.slice(1))
    else rest.push(word)
  }
  return { title: rest.join(' '), tags: [...new Set(tags)], priority, due }
}

const PRIO_RANK = { high: 0, med: 1, low: 2 } as const

// Overdue, due today, priority, due date, newest.
export function compareTodos(a: Todo, b: Todo): number {
  const bucket = (t: Todo) => (!t.due ? 2 : daysFromToday(t.due) < 0 ? 0 : daysFromToday(t.due) === 0 ? 1 : 2)
  const pr = (t: Todo) => (t.priority ? PRIO_RANK[t.priority] : 3)
  return (
    bucket(a) - bucket(b) ||
    pr(a) - pr(b) ||
    (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
    b.createdAt.localeCompare(a.createdAt)
  )
}

export type TagFilter = { tags: string[]; mode: 'and' | 'or' }

export const matchesFilter = (t: Todo, f: TagFilter) =>
  f.tags.length === 0 || (f.mode === 'and' ? f.tags.every((x) => t.tags.includes(x)) : f.tags.some((x) => t.tags.includes(x)))

export type VisibleTodo = { todo: Todo; dimmed: boolean; subs: Todo[]; forceOpen: boolean }

// A parent that only matches through its Sub-todos is shown dimmed with just those Sub-todos.
export function visibleTodos(todos: Todo[], f: TagFilter, statuses: Todo['status'][]): VisibleTodo[] {
  const out: VisibleTodo[] = []
  for (const todo of todos.filter((t) => statuses.includes(t.status))) {
    if (matchesFilter(todo, f)) {
      out.push({ todo, dimmed: false, subs: todo.subs, forceOpen: false })
      continue
    }
    const subs = todo.subs.filter((s) => matchesFilter(s, f))
    if (subs.length) out.push({ todo, dimmed: true, subs, forceOpen: true })
  }
  return out.sort((a, b) =>
    statuses.includes('open') ? compareTodos(a.todo, b.todo) : (b.todo.finishedAt ?? '').localeCompare(a.todo.finishedAt ?? ''),
  )
}

export const allTags = (todos: Todo[]) => {
  const s = new Set(Object.keys(TAG_COLORS))
  for (const t of todos) for (const x of [...t.tags, ...t.subs.flatMap((s) => s.tags)]) s.add(x)
  return [...s].sort()
}

export const tagSlot = (tag: string) => {
  if (!TAG_COLORS[tag]) TAG_COLORS[tag] = (Object.keys(TAG_COLORS).length % 8) + 1
  return TAG_COLORS[tag]
}
