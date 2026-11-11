// The Dev log format: `devlogs/<YYYY-MM-DD>.md`, at most one per day, and the monthly summary
// `devlogs/<YYYY-MM>.md` the Dev log skill writes from a month's days. Each is a YAML header then a Markdown body.
// Imports only zod, so the web app can share these types. Documented for agents in `.claude/skills/devlog/format.md`.
import { z } from 'zod'

/** Flat, lowercase and hyphenated, as on Todos and Notes. */
const tag = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Tags are lowercase and hyphenated')

/** A day's file name and `date:`: `YYYY-MM-DD`. */
export const DAY_ID = /^\d{4}-\d{2}-\d{2}$/
/** A monthly summary's file name and `month:`: `YYYY-MM`. */
export const MONTH_ID = /^\d{4}-\d{2}$/

/** At most this many Tags on one day. */
export const MAX_DEVLOG_TAGS = 3

export { DEVLOG_SECTIONS } from './devlog-days.ts'

/**
 * A day's header. `sources` names the Activity sources the day was gathered from (`todos`, `gitlab`, `jira`,
 * `slack`, `outlook`): one not listed wasn't used. An off day has `off: true` and may say why in `label`.
 * Other keys are kept as they are.
 */
export const DevlogHeaderSchema = z
  .looseObject({
    date: z.string({ error: 'date is the day, as YYYY-MM-DD' }).regex(DAY_ID, 'date is the day, as YYYY-MM-DD'),
    tags: z.array(tag).max(MAX_DEVLOG_TAGS, `At most ${MAX_DEVLOG_TAGS} Tags on a day`).default([]),
    sources: z.array(z.string().regex(/^[a-z0-9-]+$/, 'Sources are lowercase names, such as gitlab')).default([]),
    off: z.literal(true, 'off is true for an off day, or left out').optional(),
    label: z.string().trim().min(1).optional(),
  })
  .refine((header) => header.label === undefined || header.off === true, {
    message: 'label names an off day: add off: true, or remove the label',
    path: ['label'],
  })
export type DevlogHeader = z.infer<typeof DevlogHeaderSchema>

/** A monthly summary's header: its month (optional, the file name says it) and Tags. Other keys are kept. */
export const MonthlySummaryHeaderSchema = z.looseObject({
  month: z.string().regex(MONTH_ID, 'month is YYYY-MM').optional(),
  tags: z.array(tag).default([]),
})
export type MonthlySummaryHeader = z.infer<typeof MonthlySummaryHeaderSchema>

/** A change to a Dev log or monthly summary from the app: a new Markdown body, without the header. */
export const DevlogChangeSchema = z.strictObject({ body: z.string() })
export type DevlogChange = z.infer<typeof DevlogChangeSchema>

type FileMeta = { id: string; version: string; modifiedAt: string }

/** One day's Dev log as read: `version` is a hash of the whole file, `modifiedAt` its last change on disk. */
export type Devlog = FileMeta & {
  kind: 'day'
  date: string
  tags: string[]
  sources: string[]
  off?: true
  label?: string
  body: string
}

/** A monthly summary as read. */
export type MonthlySummary = FileMeta & { kind: 'month'; month: string; tags: string[]; body: string }

/** A file in `devlogs/` that can't be read as either: listed with the reason, never hidden. */
export type BrokenDevlog = FileMeta & { error: string }

export type DevlogSummary = Omit<Devlog, 'body'>
export type MonthlySummaryListing = Omit<MonthlySummary, 'body'>
/** The Dev logs list: every file in `devlogs/`, without bodies. */
export type DevlogListing = DevlogSummary | MonthlySummaryListing | BrokenDevlog

export const isBrokenDevlog = (log: DevlogListing | Devlog | MonthlySummary): log is BrokenDevlog => 'error' in log
