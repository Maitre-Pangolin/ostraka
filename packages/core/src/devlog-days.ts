// Dev logs laid out over the calendar: the list by month and week, a date range stacked by day, the gaps (a weekday
// with no Dev log), presets for the range and the Tag filter. Pure and free of Node and zod, so the web app shares it.
import type { BrokenDevlog, DevlogListing, DevlogSummary, MonthlySummaryListing } from './devlog-schema.ts'
import { mentionsAll, parsePeople, parseSearchText } from './todo-filter.ts'
import { normalizeTag } from './todo-tokens.ts'

/** A day in a list or range: its Dev log (maybe broken), or none when it is a weekday nobody wrote up yet. */
export type DevlogDay<L = DevlogSummary | BrokenDevlog> = { date: string; log?: L }

/** A week in the list, Monday first, with its days newest first. */
export type DevlogWeek<L = DevlogSummary | BrokenDevlog> = { start: string; days: DevlogDay<L>[] }

/** A month in the list, its summary on top when there is one. */
export type DevlogMonth<L = DevlogSummary | BrokenDevlog> = {
  month: string
  summary?: MonthlySummaryListing | BrokenDevlog
  weeks: DevlogWeek<L>[]
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const MONTH = /^\d{4}-\d{2}$/

// Days are calendar dates, so they are counted in UTC: no time zone or daylight saving shifts them.
const toDate = (day: string) => new Date(`${day}T00:00:00Z`)
const toDay = (date: Date) => date.toISOString().slice(0, 10)

export function addDays(day: string, days: number): string {
  const date = toDate(day)
  date.setUTCDate(date.getUTCDate() + days)
  return toDay(date)
}

const weekday = (day: string) => (toDate(day).getUTCDay() + 6) % 7 // Monday 0 … Sunday 6

/** The Monday of a day's week. */
export const weekStart = (day: string) => addDays(day, -weekday(day))

export const isWeekend = (day: string) => weekday(day) >= 5

/** The last day of a `YYYY-MM` month. */
const monthEnd = (month: string) => {
  const date = toDate(`${month}-01`)
  date.setUTCMonth(date.getUTCMonth() + 1, 0)
  return toDay(date)
}

/**
 * Every day from `from` to `to` (both included) worth showing, newest first: a day with a Dev log, and a weekday up
 * to `today` without one. Weekends and days after today show only when they have a Dev log.
 */
function daysBetween<L extends { id: string }>(from: string, to: string, logs: L[], today: string): DevlogDay<L>[] {
  const byDate = new Map(logs.filter((log) => DAY.test(log.id)).map((log) => [log.id, log]))
  const days: DevlogDay<L>[] = []
  for (let date = to; date >= from; date = addDays(date, -1)) {
    const log = byDate.get(date)
    if (log) days.push({ date, log })
    else if (date <= today && !isWeekend(date)) days.push({ date })
  }
  return days
}

/** The days from `from` to `to`, stacked newest first, gaps included (see `daysBetween`). */
export function devlogDays<L extends { id: string }>(range: { from: string; to: string }, logs: L[], today: string): DevlogDay<L>[] {
  return daysBetween(range.from, range.to, logs, today)
}

/**
 * The Dev logs list: months newest first, each with its summary on top when there is one, then its weeks newest
 * first. It runs from the first Dev log to today, so every weekday since without one shows as missing.
 */
export function devlogList(logs: DevlogListing[], today: string): DevlogMonth[] {
  const dayLogs = logs.filter((log): log is DevlogSummary | BrokenDevlog => DAY.test(log.id))
  const summaries = new Map(
    logs.filter((log): log is MonthlySummaryListing | BrokenDevlog => MONTH.test(log.id)).map((log) => [log.id, log]),
  )
  const dates = dayLogs.map((log) => log.id).toSorted()
  const days = dates.length ? daysBetween(dates[0]!, [dates.at(-1)!, today].toSorted().at(-1)!, dayLogs, today) : []
  const months = new Map<string, DevlogMonth>()
  const monthOf = (month: string) => {
    if (!months.has(month)) months.set(month, { month, ...(summaries.has(month) && { summary: summaries.get(month) }), weeks: [] })
    return months.get(month)!
  }
  for (const month of summaries.keys()) monthOf(month)
  for (const day of days) {
    const { weeks } = monthOf(day.date.slice(0, 7))
    const start = weekStart(day.date)
    if (weeks.at(-1)?.start !== start) weeks.push({ start, days: [] })
    weeks.at(-1)!.days.push(day)
  }
  return [...months.values()].toSorted((a, b) => b.month.localeCompare(a.month))
}

/** The list narrowed to the Dev logs a search found (`found`, by id), in its order: gaps and empty weeks and months go. */
export function searchDevlogList(months: DevlogMonth[], found: ReadonlySet<string>): DevlogMonth[] {
  return months.flatMap(({ month, summary, weeks }) => {
    const kept = weeks.flatMap(({ start, days }) => {
      const shown = days.filter(({ log }) => log && found.has(log.id))
      return shown.length ? [{ start, days: shown }] : []
    })
    const keptSummary = summary && found.has(summary.id) ? summary : undefined
    return kept.length || keptSummary ? [{ month, ...(keptSummary && { summary: keptSummary }), weeks: kept }] : []
  })
}

/**
 * What the stacked days are narrowed to: all of these Tags, or any of them with `match: 'any'`, and all of these
 * Persons mentioned (by id).
 */
export type DevlogFilter = { tag?: string[]; match?: 'any'; person?: string[] }

/**
 * The days the filter keeps, in order. Choosing a Tag or a Person keeps only Dev logs that have it (a Person is looked
 * for in the body): gaps and broken files go.
 */
export function filterDevlogDays<L extends object>(
  days: DevlogDay<L>[],
  { tag = [], match, person = [] }: DevlogFilter,
  found?: ReadonlySet<string>,
): DevlogDay<L>[] {
  if (!tag.length && !person.length && !found) return days
  return days.filter(({ date, log }) => {
    if (!log || !('tags' in log) || (found && !found.has(date))) return false
    const tags = log.tags as string[]
    const tagged = !tag.length || (match === 'any' ? tag.some((name) => tags.includes(name)) : tag.every((name) => tags.includes(name)))
    const body = 'body' in log && typeof log.body === 'string' ? log.body : ''
    return tagged && (!person.length || mentionsAll(body, person))
  })
}

export type DevlogRange = { label: string; from: string; to: string }

/** The date range presets around today: this and last week (Monday to Sunday), this and last month. */
export function devlogRangePresets(today: string): DevlogRange[] {
  const monday = weekStart(today)
  const month = today.slice(0, 7)
  const lastMonth = addDays(`${month}-01`, -1).slice(0, 7)
  return [
    { label: 'This week', from: monday, to: addDays(monday, 6) },
    { label: 'Last week', from: addDays(monday, -7), to: addDays(monday, -1) },
    { label: 'This month', from: `${month}-01`, to: monthEnd(month) },
    { label: 'Last month', from: `${lastMonth}-01`, to: monthEnd(lastMonth) },
  ]
}

/**
 * The Dev logs view's state in the URL: the open day or monthly summary (`log`), or a date range stacked by day
 * (`from` and `to`) with its Tag filter. With neither, the view shows its list.
 */
/** The Dev logs view's state in the URL: the open Dev log, a date range with its filter, and the search box's text. */
export type DevlogsView = { log?: string; from?: string; to?: string; q?: string } & DevlogFilter

const isDay = (value: unknown): value is string =>
  typeof value === 'string' && DAY.test(value) && toDate(value).toISOString().startsWith(value)

/** Router search params → the Dev logs view's state, leaving out invalid, empty and default values. */
export function parseDevlogsView(search: Record<string, unknown>): DevlogsView {
  const log = typeof search.log === 'string' && (DAY.test(search.log) || MONTH.test(search.log)) ? search.log : undefined
  const range = isDay(search.from) && isDay(search.to) ? [search.from, search.to].toSorted() : undefined
  const raw = Array.isArray(search.tag) ? search.tag : search.tag === undefined ? [] : [search.tag]
  const tag = [
    ...new Set(raw.map((value) => (typeof value === 'string' ? normalizeTag(value) : undefined)).filter((value) => value !== undefined)),
  ]
  const person = parsePeople(search.person)
  const q = parseSearchText(search.q)
  return {
    ...(log && { log }),
    ...(q !== undefined && { q }),
    ...(range && { from: range[0], to: range[1] }),
    ...(tag.length > 0 && { tag }),
    ...(search.match === 'any' && { match: 'any' }),
    ...(person.length > 0 && { person }),
  }
}

/** A day's sections, in this order; an empty one is left out. */
export const DEVLOG_SECTIONS = ['Done', 'Meetings & discussions', 'Notes'] as const
const SECTIONS: readonly string[] = DEVLOG_SECTIONS

/**
 * What doesn't follow the day's structure: its `## ` sections are Done, Meetings & discussions and Notes, in that
 * order, each at most once (an empty one is left out). Nothing for a day that follows it.
 */
export function devlogSectionProblems(body: string): string[] {
  const problems: string[] = []
  const seen: string[] = []
  let fenced = false
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    const heading = fenced ? undefined : /^## +(.+?)(?: +#+)? *$/.exec(line)?.[1]
    if (heading === undefined) continue
    if (!SECTIONS.includes(heading)) {
      problems.push(`${heading} is not a Dev log section: use Done, Meetings & discussions or Notes.`)
      continue
    }
    if (seen.includes(heading)) {
      problems.push(`${heading} appears twice.`)
      continue
    }
    const later = seen.find((other) => SECTIONS.indexOf(other) > SECTIONS.indexOf(heading))
    if (later) problems.push(`${heading} comes before ${later}.`)
    seen.push(heading)
  }
  return problems
}
