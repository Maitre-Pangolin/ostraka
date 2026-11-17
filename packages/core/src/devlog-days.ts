// Dev logs laid out over the calendar: the list by year, month and Week, a date range stacked by day, the gaps (a
// weekday with no Dev log), presets for the range and the Tag filter. Pure and free of Node and zod, so the web app
// shares it.
import type { BrokenDevlog, DevlogListing, DevlogSummary, MonthlySummaryListing } from './devlog-schema.ts'
import { mentionsAll, parsePeople, parseSearchText } from './todo-filter.ts'
import { normalizeTag } from './todo-tokens.ts'

/** A day in a list or range: its Dev log (maybe broken), or none when it is a weekday nobody wrote up yet. */
export type DevlogDay<L = DevlogSummary | BrokenDevlog> = { date: string; log?: L }

/**
 * A Week in the list, with its days in that month newest first. A Week that runs over two months shows under both,
 * with the same id.
 */
export type DevlogWeek<L = DevlogSummary | BrokenDevlog> = {
  /** `YYYY-Www`, its ISO 8601 year and number. */
  id: string
  /** Its Monday. */
  start: string
  number: number
  days: DevlogDay<L>[]
}

type Summary = MonthlySummaryListing | BrokenDevlog

/** A month in the list, its summary on top when there is one. */
export type DevlogMonth<L = DevlogSummary | BrokenDevlog> = {
  month: string
  summary?: Summary
  weeks: DevlogWeek<L>[]
}

/** A calendar year in the list, its months newest first. */
export type DevlogYear<L = DevlogSummary | BrokenDevlog> = { year: string; months: DevlogMonth<L>[] }

const DAY = /^\d{4}-\d{2}-\d{2}$/
const MONTH = /^\d{4}-\d{2}$/
const WEEK = /^(\d{4})-W(\d{2})$/

// Days are calendar dates, so they are counted in UTC: no time zone or daylight saving shifts them.
const toDate = (day: string) => new Date(`${day}T00:00:00Z`)
const toDay = (date: Date) => date.toISOString().slice(0, 10)

export function addDays(day: string, days: number): string {
  const date = toDate(day)
  date.setUTCDate(date.getUTCDate() + days)
  return toDay(date)
}

export const weekday = (day: string) => (toDate(day).getUTCDay() + 6) % 7 // Monday 0 … Sunday 6

/** The Monday of a day's week. */
export const weekStart = (day: string) => addDays(day, -weekday(day))

export const isWeekend = (day: string) => weekday(day) >= 5

const daysFrom = (from: string, to: string) => Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000)

/**
 * A day's Week by ISO 8601: its year and number. Week 1 holds the year's first Thursday, so a Week takes the year of
 * its Thursday and late December can be Week 1 of the next year.
 */
export function isoWeek(day: string): { year: number; number: number; id: string } {
  const thursday = addDays(weekStart(day), 3)
  const year = Number(thursday.slice(0, 4))
  const number = Math.floor(daysFrom(`${year}-01-01`, thursday) / 7) + 1
  return { year, number, id: `${year}-W${String(number).padStart(2, '0')}` }
}

/** A Week id (`YYYY-Www`) → its Monday and Sunday; undefined when the year has no such Week. */
export function weekRange(id: string): { from: string; to: string } | undefined {
  const match = WEEK.exec(id)
  if (!match) return undefined
  // 4 January is always in Week 1.
  const from = addDays(weekStart(`${match[1]}-01-04`), (Number(match[2]) - 1) * 7)
  return isoWeek(from).id === id ? { from, to: addDays(from, 6) } : undefined
}

export const isWeekId = (value: string) => weekRange(value) !== undefined

/** The last day of a `YYYY-MM` month. */
export const monthEnd = (month: string) => {
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

const summariesOf = (logs: DevlogListing[]) => logs.filter((log): log is Summary => MONTH.test(log.id))

/**
 * Days (newest first) and monthly summaries laid out by month, newest first: each month with its summary on top when
 * there is one, then its Weeks newest first. A month shows when it has a day or a summary.
 */
export function groupDevlogDays<L>(days: DevlogDay<L>[], summaries: Summary[] = []): DevlogMonth<L>[] {
  const bySummary = new Map(summaries.map((summary) => [summary.id, summary]))
  const months = new Map<string, DevlogMonth<L>>()
  const monthOf = (month: string) => {
    if (!months.has(month)) months.set(month, { month, ...(bySummary.has(month) && { summary: bySummary.get(month) }), weeks: [] })
    return months.get(month)!
  }
  for (const month of bySummary.keys()) monthOf(month)
  for (const day of days) {
    const { weeks } = monthOf(day.date.slice(0, 7))
    const { id, number } = isoWeek(day.date)
    if (weeks.at(-1)?.id !== id) weeks.push({ id, start: weekStart(day.date), number, days: [] })
    weeks.at(-1)!.days.push(day)
  }
  return [...months.values()].toSorted((a, b) => b.month.localeCompare(a.month))
}

/** Months (newest first) under their calendar year, newest first. */
export function devlogYears<L>(months: DevlogMonth<L>[]): DevlogYear<L>[] {
  const years: DevlogYear<L>[] = []
  for (const month of months) {
    const year = month.month.slice(0, 4)
    if (years.at(-1)?.year !== year) years.push({ year, months: [] })
    years.at(-1)!.months.push(month)
  }
  return years
}

/**
 * The Dev logs list: months newest first, each with its summary on top when there is one, then its Weeks newest
 * first. It runs from the first Dev log to today, so every weekday since without one shows as missing.
 */
export function devlogList(logs: DevlogListing[], today: string): DevlogMonth[] {
  const dayLogs = logs.filter((log): log is DevlogSummary | BrokenDevlog => DAY.test(log.id))
  const dates = dayLogs.map((log) => log.id).toSorted()
  const days = dates.length ? daysBetween(dates[0]!, [dates.at(-1)!, today].toSorted().at(-1)!, dayLogs, today) : []
  return groupDevlogDays(days, summariesOf(logs))
}

/**
 * The list narrowed to a date range, agreeing with the range stacked by day: its days (`devlogDays`, then the
 * filter's and a search's), and the summary of each month the range touches. A Tag or Person chosen keeps Dev logs
 * only, so the summaries go too; a search keeps the summaries it found.
 */
export function devlogRangeList<L extends { id: string }>(
  range: { from: string; to: string },
  days: L[],
  listing: DevlogListing[],
  filter: DevlogFilter,
  today: string,
  found?: ReadonlySet<string>,
): DevlogMonth<L>[] {
  const shown = filterDevlogDays(devlogDays(range, days, today), filter, found)
  const filtered = Boolean(filter.tag?.length || filter.person?.length)
  const summaries = filtered
    ? []
    : summariesOf(listing).filter(({ id }) => `${id}-01` <= range.to && monthEnd(id) >= range.from && (!found || found.has(id)))
  return groupDevlogDays(shown, summaries)
}

/** The list narrowed to the Dev logs a search found (`found`, by id), in its order: gaps and empty Weeks and months go. */
export function searchDevlogList(months: DevlogMonth[], found: ReadonlySet<string>): DevlogMonth[] {
  return months.flatMap(({ month, summary, weeks }) => {
    const kept = weeks.flatMap((week) => {
      const shown = week.days.filter(({ log }) => log && found.has(log.id))
      return shown.length ? [{ ...week, days: shown }] : []
    })
    const keptSummary = summary && found.has(summary.id) ? summary : undefined
    return kept.length || keptSummary ? [{ month, ...(keptSummary && { summary: keptSummary }), weeks: kept }] : []
  })
}

/** How many of these days have a Dev log (an off day or a broken file too), and how many are missing one. */
export function devlogCounts(days: DevlogDay<unknown>[]): { written: number; missing: number } {
  const written = days.filter(({ log }) => log !== undefined).length
  return { written, missing: days.length - written }
}

/** A week (its Monday) with the weekdays in it that have no Dev log, oldest first. */
export type MissingDevlogWeek = { start: string; days: string[] }

/**
 * The weekdays with no Dev log, grouped by week, oldest first: what a Backfill catches up on. The range runs from
 * `from` (the first Dev log by default) to `to` (today by default), never past today. A day with any file counts as
 * written, an off day or a broken one too. Nothing is missing before there is a Dev log or a `from`.
 */
export function missingDevlogWeeks(logs: DevlogListing[], today: string, range: { from?: string; to?: string } = {}): MissingDevlogWeek[] {
  const dayLogs = logs.filter((log) => DAY.test(log.id))
  const from = range.from ?? dayLogs.map((log) => log.id).toSorted()[0]
  if (from === undefined) return []
  const to = [range.to ?? today, today].toSorted()[0]!
  const weeks: MissingDevlogWeek[] = []
  for (const { date, log } of daysBetween(from, to, dayLogs, today).toReversed()) {
    if (log) continue
    const start = weekStart(date)
    if (weeks.at(-1)?.start !== start) weeks.push({ start, days: [] })
    weeks.at(-1)!.days.push(date)
  }
  return weeks
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

/** A calendar year as a date range. */
export const yearRange = (year: string) => ({ from: `${year}-01-01`, to: `${year}-12-31` })

/** A `YYYY-MM` month as a date range. */
export const monthRange = (month: string) => ({ from: `${month}-01`, to: monthEnd(month) })

/** The date range presets around today: this and last week (Monday to Sunday), month and year. */
export function devlogRangePresets(today: string): DevlogRange[] {
  const monday = weekStart(today)
  const month = today.slice(0, 7)
  const lastMonth = addDays(`${month}-01`, -1).slice(0, 7)
  const year = today.slice(0, 4)
  return [
    { label: 'This week', from: monday, to: addDays(monday, 6) },
    { label: 'Last week', from: addDays(monday, -7), to: addDays(monday, -1) },
    { label: 'This month', ...monthRange(month) },
    { label: 'Last month', ...monthRange(lastMonth) },
    { label: 'This year', ...yearRange(year) },
    { label: 'Last year', ...yearRange(String(Number(year) - 1)) },
  ]
}

/**
 * The Dev logs view's state in the URL: the open day, monthly summary or Week (`log`), the date range (`from` and
 * `to`) that narrows the list and is stacked by day when nothing is open, with its Tag and Person filter, and the
 * search box's text.
 */
export type DevlogsView = { log?: string; from?: string; to?: string; q?: string } & DevlogFilter

const isDay = (value: unknown): value is string =>
  typeof value === 'string' && DAY.test(value) && toDate(value).toISOString().startsWith(value)

/** Router search params → the Dev logs view's state, leaving out invalid, empty and default values. */
export function parseDevlogsView(search: Record<string, unknown>): DevlogsView {
  const log =
    typeof search.log === 'string' && (DAY.test(search.log) || MONTH.test(search.log) || isWeekId(search.log)) ? search.log : undefined
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
