// The migration of the old monthly Dev log files into daily Dev logs, one reviewed month at a time (#6, #41). It
// works in `.migration/` in the content folder, which Snapshots leave out:
//   raw/<YYYY-MM>/       the month split mechanically (no AI) at its `## <Day> <N>` headings, one file per day
//   staged/<YYYY-MM>/    the days reformatted by an agent session, with its uncertainties.md
//   usage/<YYYY-MM>.json that session's usage, as `claude -p --output-format json` prints it
// The old files are only ever read.
import { constants } from 'node:fs'
import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { contentPath } from './content-path.ts'
import { resolveContentRoot, type ContentRootOptions } from './content-root.ts'
import { addDays, devlogSectionProblems, isWeekend, monthEnd, weekday } from './devlog-days.ts'
import { isBrokenDevlog } from './devlog-schema.ts'
import { listDevlogs, readDevlogText } from './devlogs.ts'
import { splitFrontmatter } from './markdown.ts'
import { snapshot, type Snapshot } from './snapshots.ts'
import { normalizeTag } from './todo-tokens.ts'
import { listTags } from './todos.ts'

/** The migration's working folder in the content folder. Hidden, so the watcher skips it; Snapshots exclude it. */
export const MIGRATION_FOLDER = '.migration'

/** What a month's split found: its days, in date order, and what looked wrong. */
export type MonthSplit = {
  month: string
  /** The old monthly file, as given. */
  source: string
  /** The days with a raw file, `YYYY-MM-DD`, oldest first. */
  days: string[]
  anomalies: SplitAnomaly[]
}

/**
 * Something in the old file the review should look at. `line` is where it is in the old file (none for a missing
 * day), `date` the day it concerns.
 */
export type SplitAnomaly = { kind: SplitAnomalyKind; message: string; line?: number; date?: string }

export type SplitAnomalyKind =
  | 'preamble' // text before the first day, beyond a title: kept in preamble.md
  | 'weekday' // the heading's weekday isn't the date's: the date wins
  | 'stray-heading' // a `## ` heading that isn't a day: kept in the day above it
  | 'weekend' // a Saturday or Sunday
  | 'empty' // a day heading with nothing under it
  | 'order' // a day after a later one
  | 'duplicate' // a second heading for the same day: appended to its file
  | 'no-such-day' // a day the month doesn't have: kept in unplaced-<line>.md
  | 'missing' // a weekday between the first and last day with no heading

export type SplitOptions = ContentRootOptions & {
  /** The month, `YYYY-MM`, when neither the file name nor its title says it. */
  month?: string
  /** Split a month already split again, replacing its raw files (never its staged ones). */
  again?: boolean
}

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** `## Monday 5`, `## Mon. 5th`, `## tuesday 6 (late)`: a weekday word and the day of the month. */
const DAY_HEADING = /^##[ \t]+([A-Za-z]+)\.?[ \t]+(\d{1,2})(?:st|nd|rd|th)?\b/
const FENCE = /^\s*(```|~~~)/

/** What the split found, kept beside the raw files for the month's review. */
const SPLIT_REPORT = 'split.json'

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

const pad = (n: number) => String(n).padStart(2, '0')

/** Monday 0 … Sunday 6 for a weekday word or its abbreviation (`Tue`, `Thurs`), or -1. */
function weekdayOf(word: string): number {
  const lower = word.toLowerCase()
  return lower.length < 3 ? -1 : WEEKDAY_NAMES.findIndex((name) => name.toLowerCase().startsWith(lower))
}

/** `YYYY-MM` from words like `March 2026` or `mar-2026`, or undefined. */
function monthFromWords(text: string): string | undefined {
  const match = /([A-Za-z]{3,})[\s_.-]*(\d{4})/.exec(text)
  const index = match ? MONTH_NAMES.findIndex((name) => name.startsWith(match[1]!.toLowerCase())) : -1
  return index < 0 ? undefined : `${match![2]}-${pad(index + 1)}`
}

/** The month a file is about: as given, else from its name (`2026-03…`, `March 2026…`), else from its `# ` title. */
function monthOf(source: string, text: string, given: string | undefined): string {
  if (given !== undefined) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(given)) throw new Error(`${given} is not a month: use YYYY-MM`)
    return given
  }
  const name = basename(source)
  const numeric = /(\d{4})-(0[1-9]|1[0-2])(?!\d)/.exec(name)
  if (numeric) return `${numeric[1]}-${numeric[2]}`
  const title = /^#[ \t]+(.+)$/m.exec(text)?.[1]
  const month = monthFromWords(name) ?? (title === undefined ? undefined : monthFromWords(title))
  if (month === undefined) throw new Error(`Neither the name nor the title of ${name} says its month: give it as YYYY-MM`)
  return month
}

const monthLabel = (month: string) => {
  const name = MONTH_NAMES[Number(month.slice(5)) - 1]!
  return `${name[0]!.toUpperCase()}${name.slice(1)} ${month.slice(0, 4)}`
}

/** The month's text in pieces, by file name without `.md`, each piece the old lines in their order. */
function splitText(text: string, month: string): { pieces: Map<string, string>; anomalies: SplitAnomaly[] } {
  const pieces = new Map<string, string>([['preamble', '']])
  const anomalies: SplitAnomaly[] = []
  const lastDay = Number(monthEnd(month).slice(8))
  let current = 'preamble'
  let heading: { line: number; date?: string; empty: boolean } | undefined
  let latest = ''
  let fenced = false

  const closeDay = () => {
    if (heading?.empty)
      anomalies.push({ kind: 'empty', line: heading.line, date: heading.date, message: 'A day heading with nothing under it' })
  }

  text.split(/(?<=\n)/).forEach((line, index) => {
    const lineNo = index + 1
    const isHeading = !fenced && /^##[ \t]/.test(line)
    if (FENCE.test(line)) fenced = !fenced
    const day = isHeading ? DAY_HEADING.exec(line) : null
    const named = day ? weekdayOf(day[1]!) : -1
    const shown = `"${line.trim()}"`
    if (day && named >= 0) {
      closeDay()
      const n = Number(day[2])
      if (n < 1 || n > lastDay) {
        current = `unplaced-${lineNo}`
        heading = { line: lineNo, empty: true }
        anomalies.push({
          kind: 'no-such-day',
          line: lineNo,
          message: `${shown}: ${monthLabel(month)} has no day ${n}; kept in ${current}.md`,
        })
      } else {
        const date = `${month}-${pad(n)}`
        heading = { line: lineNo, date, empty: true }
        if (weekday(date) !== named) {
          const message = `${shown}, but ${date} is a ${WEEKDAY_NAMES[weekday(date)]}: kept as ${date}`
          anomalies.push({ kind: 'weekday', line: lineNo, date, message })
        }
        if (pieces.has(date)) {
          anomalies.push({ kind: 'duplicate', line: lineNo, date, message: `A second heading for ${date}: appended to ${date}.md` })
        } else {
          if (date < latest) anomalies.push({ kind: 'order', line: lineNo, date, message: `${shown} comes after ${latest}` })
          if (isWeekend(date))
            anomalies.push({ kind: 'weekend', line: lineNo, date, message: `${date} is a ${WEEKDAY_NAMES[weekday(date)]}` })
        }
        if (date > latest) latest = date
        current = date
      }
      pieces.set(current, (pieces.get(current) ?? '') + line)
      return
    }
    if (isHeading) {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(current) ? current : undefined
      anomalies.push({ kind: 'stray-heading', line: lineNo, date, message: `${shown} is not a day heading: kept in ${current}.md` })
    }
    if (heading && line.trim()) heading.empty = false
    if (current === 'preamble' && line.trim() && !/^#[ \t]/.test(line) && !anomalies.some((a) => a.kind === 'preamble')) {
      anomalies.push({ kind: 'preamble', line: lineNo, message: 'Text before the first day: kept in preamble.md' })
    }
    pieces.set(current, pieces.get(current)! + line)
  })
  closeDay()

  const days = [...pieces.keys()].filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).toSorted()
  anomalies.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity))
  for (let date = days[0]; date !== undefined && date < days.at(-1)!; date = addDays(date, 1)) {
    if (!isWeekend(date) && !pieces.has(date)) {
      anomalies.push({ kind: 'missing', date, message: `No heading for ${WEEKDAY_NAMES[weekday(date)]} ${date}` })
    }
  }
  if (!pieces.get('preamble')) pieces.delete('preamble')
  return { pieces, anomalies }
}

/**
 * Splits one old monthly Dev log file at its day headings into `.migration/raw/<YYYY-MM>/`: `<YYYY-MM-DD>.md` per
 * day, from its heading to the next, exactly as written, and `preamble.md` for anything before the first day. The
 * file is only read; every line of it lands in exactly one raw file.
 */
export async function splitMonthlyDevlog(source: string, options: SplitOptions = {}): Promise<MonthSplit> {
  const text = await readFile(source, 'utf8')
  const month = monthOf(source, text, options.month)
  const { pieces, anomalies } = splitText(text, month)
  const folder = join(await resolveContentRoot(options), MIGRATION_FOLDER, 'raw', month)
  if (await exists(folder)) {
    if (!options.again) throw new Error(`${month} is already split in ${folder}: split it again to replace its raw files`)
    await rm(folder, { recursive: true })
  }
  await mkdir(folder, { recursive: true })
  for (const [name, piece] of pieces) await writeFile(join(folder, `${name}.md`), piece)
  const days = [...pieces.keys()].filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).toSorted()
  const split = { month, source, days, anomalies }
  await writeFile(join(folder, SPLIT_REPORT), `${JSON.stringify(split, null, 2)}\n`)
  return split
}

/** A month's review: what the agent session staged, against what the split found. */
export type MonthReview = {
  month: string
  /** Where the month's files are: its raw days, its staged days, and its session's usage. */
  folders: MonthFolders
  /** The old monthly file it was split from. */
  source?: string
  rawDays: string[]
  stagedDays: string[]
  /** Raw days with no staged day: the session skipped them. */
  unstaged: string[]
  /** Staged days with no raw day (a misplaced day the session placed, or a mistake). */
  unexpected: string[]
  /** Staged days that wouldn't read as valid Dev logs, or don't follow the day's sections. */
  problems: { date: string; problems: string[] }[]
  /** Staged days that already have a Dev log: approving would overwrite them, so it refuses. */
  conflicts: string[]
  /** Every Tag on the staged days, most used first, and whether it is already in use outside the migration. */
  tags: { name: string; days: string[]; inUse: boolean }[]
  /** What the session wasn't sure of, from its uncertainties.md: one per `- ` line, for a day or the whole month. */
  uncertainties: { date?: string; text: string }[]
  anomalies: SplitAnomaly[]
  /** Two or three days to show before and after: the ones the session was unsure of first, then the longest. */
  samples: string[]
  /** What the month's agent session used, once it has run; an error when its result can't be read. */
  usage?: MigrationUsage | { error: string }
}

export type MonthFolders = { raw: string; staged: string; usage: string }

/** One agent session's usage, from the result `claude -p --output-format json` prints. */
export type MigrationUsage = {
  costUsd?: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  turns?: number
  durationMs?: number
}

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.md$/
const UNCERTAINTIES = 'uncertainties.md'
const SAMPLES = 3

/** The month's places in `.migration/`. */
async function monthFolders(month: string, options: ContentRootOptions): Promise<MonthFolders> {
  const root = join(await resolveContentRoot(options), MIGRATION_FOLDER)
  return { raw: join(root, 'raw', month), staged: join(root, 'staged', month), usage: join(root, 'usage', `${month}.json`) }
}

/** The `YYYY-MM-DD.md` files in a folder, by date, oldest first; none when there is no folder. */
async function dayFiles(folder: string): Promise<string[]> {
  const names = await readdir(folder).catch(() => [])
  return names.flatMap((name) => DAY_FILE.exec(name)?.[1] ?? []).toSorted()
}

const readOptional = (file: string) => readFile(file, 'utf8').catch(() => undefined)

const number = (value: unknown) => (typeof value === 'number' ? value : undefined)

/** A Tag as typed (`#Code review` reads `code-review`); throws for anything else. */
function tagName(typed: string): string {
  const name = normalizeTag(typed.trim().replace(/^#/, ''))
  if (name === undefined) throw new Error(`“${typed}” isn’t a Tag: use lowercase letters, digits and hyphens`)
  return name
}

/** A `tags: [a, b]` header line, the one form the Dev log skill writes. */
const TAGS_LINE = /^tags:[ \t]*\[([^\]\r\n]*)\]/m

/**
 * Renames Tag `from` to `to` on the month's staged days (a merge when a day has both: it keeps one), or removes it
 * when `to` is undefined. Only each header's `tags:` line changes. Says which days changed.
 */
export async function retagStagedMonth(
  month: string,
  from: string,
  to: string | undefined,
  options: ContentRootOptions = {},
): Promise<string[]> {
  const old = tagName(from)
  const next = to === undefined ? undefined : tagName(to)
  const { staged } = await monthFolders(month, options)
  const changed: string[] = []
  for (const date of await dayFiles(staged)) {
    const file = join(staged, `${date}.md`)
    const text = await readFile(file, 'utf8')
    const { header } = splitFrontmatter(text)
    const line = TAGS_LINE.exec(header)
    if (!line) {
      if (/^tags:/m.test(header)) throw new Error(`${file}: write its Tags on one line, tags: [a, b]`)
      continue
    }
    const tags = line[1]!
      .split(',')
      .map((tag) => tag.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
    if (!tags.includes(old)) continue
    const retagged = [...new Set(tags.flatMap((tag) => (tag === old ? (next === undefined ? [] : [next]) : [tag])))]
    const nextHeader = header.slice(0, line.index) + `tags: [${retagged.join(', ')}]` + header.slice(line.index + line[0].length)
    await writeFile(file, nextHeader + text.slice(header.length))
    changed.push(date)
  }
  return changed
}

/** The usage in a `claude -p --output-format json` result, or why it can't be read. */
function readUsage(text: string): MigrationUsage | { error: string } {
  let result: Record<string, unknown>
  try {
    result = JSON.parse(text) as Record<string, unknown>
  } catch {
    return { error: 'Not the JSON result of `claude -p --output-format json`' }
  }
  const usage = result.usage as Record<string, unknown> | null | undefined
  if (typeof usage !== 'object' || usage === null) return { error: 'No usage in the session result' }
  return {
    costUsd: number(result.total_cost_usd),
    inputTokens: number(usage.input_tokens) ?? 0,
    outputTokens: number(usage.output_tokens) ?? 0,
    cacheReadTokens: number(usage.cache_read_input_tokens) ?? 0,
    cacheWriteTokens: number(usage.cache_creation_input_tokens) ?? 0,
    turns: number(result.num_turns),
    durationMs: number(result.duration_ms),
  }
}

/** `- 2026-02-05: text` for a day, `- text` for the whole month. */
function readUncertainties(text: string): { date?: string; text: string }[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const item = /^\s*[-*]\s+(.+)$/.exec(line)?.[1]?.trim()
    if (!item) return []
    const dated = /^\**(\d{4}-\d{2}-\d{2})\**\s*[:—–-]\s*(.+)$/.exec(item)
    return dated ? [{ date: dated[1]!, text: dated[2]! }] : [{ text: item }]
  })
}

/** A staged day read as the app would read it in `devlogs/`: its Tags, or what's wrong with it. */
function checkStagedDay(date: string, text: string): { tags: string[]; problems: string[] } {
  const log = readDevlogText(date, text)
  if (isBrokenDevlog(log)) return { tags: [], problems: [log.error, ...devlogSectionProblems(splitFrontmatter(text).body)] }
  if (log.kind !== 'day') return { tags: [], problems: [`${date}.md is not a day`] }
  return { tags: log.tags, problems: devlogSectionProblems(log.body) }
}

/**
 * A month's review: its day counts, the Tags its staged days suggest, what its agent session was unsure of, what the
 * split flagged, sample days, and what would stop it from being approved. Reads only.
 */
export async function reviewMigratedMonth(month: string, options: ContentRootOptions = {}): Promise<MonthReview> {
  const folders = await monthFolders(month, options)
  const report = await readOptional(join(folders.raw, SPLIT_REPORT))
  if (report === undefined) throw new Error(`${month} is not split yet: split its old monthly file first`)
  const split = JSON.parse(report) as MonthSplit
  const [rawDays, stagedDays, devlogs, tagsInUse] = await Promise.all([
    dayFiles(folders.raw),
    dayFiles(folders.staged),
    listDevlogs(options),
    listTags(options),
  ])
  const written = new Set(devlogs.map((log) => log.id))
  const inUse = new Set(tagsInUse.map((tag) => tag.name))

  const problems: MonthReview['problems'] = []
  const tagDays = new Map<string, string[]>()
  for (const date of stagedDays) {
    const checked = checkStagedDay(date, await readFile(join(folders.staged, `${date}.md`), 'utf8'))
    if (checked.problems.length) problems.push({ date, problems: checked.problems })
    for (const tag of checked.tags) tagDays.set(tag, [...(tagDays.get(tag) ?? []), date])
  }

  const uncertainties = readUncertainties((await readOptional(join(folders.staged, UNCERTAINTIES))) ?? '')
  const rawLength = new Map(
    await Promise.all(rawDays.map(async (date) => [date, (await readFile(join(folders.raw, `${date}.md`), 'utf8')).length] as const)),
  )
  const unsure = uncertainties.flatMap(({ date }) => (date !== undefined && rawLength.has(date) ? [date] : []))
  const longest = rawDays.toSorted((a, b) => rawLength.get(b)! - rawLength.get(a)! || a.localeCompare(b))
  const usage = await readOptional(folders.usage)

  return {
    month,
    folders,
    source: split.source,
    rawDays,
    stagedDays,
    unstaged: rawDays.filter((date) => !stagedDays.includes(date)),
    unexpected: stagedDays.filter((date) => !rawDays.includes(date)),
    problems,
    conflicts: stagedDays.filter((date) => written.has(date)),
    tags: [...tagDays]
      .map(([name, days]) => ({ name, days, inUse: inUse.has(name) }))
      .toSorted((a, b) => b.days.length - a.days.length || a.name.localeCompare(b.name)),
    uncertainties,
    anomalies: split.anomalies,
    samples: [...new Set([...unsure, ...longest])].slice(0, SAMPLES).toSorted(),
    ...(usage !== undefined && { usage: readUsage(usage) }),
  }
}

/**
 * Where a month split for migration stands: `split` (no day staged yet), `staged` (days waiting for review) or
 * `approved` (moved into `devlogs/`), with what its agent session used once it has run.
 */
export type MonthStatus = {
  month: string
  stage: 'split' | 'staged' | 'approved'
  rawDays: number
  stagedDays: number
  anomalies: number
  usage?: MigrationUsage | { error: string }
}

/** Every month split for migration, oldest first: where it stands and its session's usage, to judge the next. */
export async function migrationStatus(options: ContentRootOptions = {}): Promise<MonthStatus[]> {
  const root = join(await resolveContentRoot(options), MIGRATION_FOLDER)
  const months = (await readdir(join(root, 'raw')).catch(() => [])).filter((name) => /^\d{4}-\d{2}$/.test(name)).toSorted()
  const written = new Set((await listDevlogs(options)).map((log) => log.id))
  return Promise.all(
    months.map(async (month): Promise<MonthStatus> => {
      const folders = await monthFolders(month, options)
      const [raw, staged, report, usage] = await Promise.all([
        dayFiles(folders.raw),
        dayFiles(folders.staged),
        readOptional(join(folders.raw, SPLIT_REPORT)),
        readOptional(folders.usage),
      ])
      const approved = !staged.length && raw.length > 0 && raw.every((date) => written.has(date))
      return {
        month,
        stage: staged.length ? 'staged' : approved ? 'approved' : 'split',
        rawDays: raw.length,
        stagedDays: staged.length,
        anomalies: report === undefined ? 0 : (JSON.parse(report) as MonthSplit).anomalies.length,
        ...(usage !== undefined && { usage: readUsage(usage) }),
      }
    }),
  )
}

/** An approved month: the days moved into `devlogs/`, and its Snapshot (none when nothing changed). */
export type ApprovedMonth = { month: string; moved: string[]; snapshot?: Snapshot }

/** What stops a month from moving in: every reason, one per line. */
function approvalBlockers(review: MonthReview): string[] {
  const { month } = review
  if (!review.stagedDays.length) return [`Nothing staged for ${month}: run its agent session first`]
  return [
    ...review.unstaged.map((date) => `${date} is not staged: the session skipped it`),
    ...review.unexpected.filter((date) => !date.startsWith(`${month}-`)).map((date) => `${date} is not in ${month}`),
    ...review.problems.flatMap(({ date, problems }) => problems.map((problem) => `${date}: ${problem}`)),
    ...review.conflicts.map((date) => `${date} already has a Dev log: it is never overwritten`),
  ]
}

/**
 * Moves an approved month's staged days into `devlogs/` and makes one Snapshot, `migrate: <YYYY-MM>`. Refuses,
 * moving nothing, while a raw day is unstaged, a staged day wouldn't read as a valid Dev log, or a day already has
 * one. The rest of the month's migration files stay in `.migration/`.
 */
export async function approveMigratedMonth(month: string, options: ContentRootOptions = {}): Promise<ApprovedMonth> {
  const review = await reviewMigratedMonth(month, options)
  const blockers = approvalBlockers(review)
  if (blockers.length) throw new Error(`${month} can’t be approved yet:\n${blockers.map((line) => `- ${line}`).join('\n')}`)
  const devlogs = await contentPath('devlogs', options)
  await mkdir(devlogs, { recursive: true })
  for (const date of review.stagedDays) {
    const from = join(review.folders.staged, `${date}.md`)
    // Copied only when no Dev log has appeared there meanwhile, then removed from the staging folder.
    await copyFile(from, join(devlogs, `${date}.md`), constants.COPYFILE_EXCL)
    await rm(from)
  }
  const made = await snapshot(`migrate: ${month}`, options)
  return { month, moved: review.stagedDays, ...(made && { snapshot: made }) }
}
