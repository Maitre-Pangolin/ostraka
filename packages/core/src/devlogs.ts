// Dev logs: `devlogs/<YYYY-MM-DD>.md` and the monthly summaries `devlogs/<YYYY-MM>.md`, read and written through the
// shared Markdown file type. The folder holds two formats, told apart by the file name, so the shared type reads any
// YAML mapping and each file is then checked against the schema its name calls for.
import { z } from 'zod'
import {
  isBrokenFile,
  markdownFiles,
  MarkdownFileError,
  type BrokenMarkdownFile,
  type MarkdownChangeOptions,
  type MarkdownFile,
  type MarkdownFileOptions,
} from './markdown-files.ts'
import {
  DAY_ID,
  DevlogChangeSchema,
  DevlogHeaderSchema,
  isBrokenDevlog,
  MONTH_ID,
  MonthlySummaryHeaderSchema,
  type BrokenDevlog,
  type Devlog,
  type DevlogChange,
  type DevlogListing,
  type MonthlySummary,
} from './devlog-schema.ts'

export type DevlogOptions = MarkdownFileOptions
/** For a change made from a loaded copy: the `version` of that copy. */
export type DevlogChangeOptions = MarkdownChangeOptions

const files = markdownFiles('devlogs', z.looseObject({}))

const invalid = (error: z.ZodError) => `Invalid header: ${z.prettifyError(error).replaceAll('\n', ' ')}`

function toDevlog(file: MarkdownFile<Record<string, unknown>> | BrokenMarkdownFile): Devlog | MonthlySummary | BrokenDevlog {
  if (isBrokenFile(file)) return file
  const { id, version, modifiedAt, header, body } = file
  const meta = { id, version, modifiedAt }
  if (DAY_ID.test(id)) {
    const parsed = DevlogHeaderSchema.safeParse(header)
    if (!parsed.success) return { ...meta, error: invalid(parsed.error) }
    const { date, tags, sources, off, label } = parsed.data
    if (date !== id) return { ...meta, error: `Invalid header: date is ${date}, but the file is the Dev log of ${id}.` }
    return { kind: 'day', ...meta, date, tags, sources, ...(off && { off }), ...(label !== undefined && { label }), body }
  }
  if (MONTH_ID.test(id)) {
    const parsed = MonthlySummaryHeaderSchema.safeParse(header)
    if (!parsed.success) return { ...meta, error: invalid(parsed.error) }
    const { month = id, tags } = parsed.data
    if (month !== id) return { ...meta, error: `Invalid header: month is ${month}, but the file is the summary of ${id}.` }
    return { kind: 'month', ...meta, month, tags, body }
  }
  return {
    ...meta,
    error: `Not a Dev log: name it devlogs/<YYYY-MM-DD>.md for a day, or devlogs/<YYYY-MM>.md for a monthly summary.`,
  }
}

const withoutBody = (log: Devlog | MonthlySummary | BrokenDevlog): DevlogListing => {
  if (!('body' in log)) return log
  const { body: _body, ...listing } = log
  return listing
}

const newestFirst = (a: { id: string }, b: { id: string }) => b.id.localeCompare(a.id)

/** Every file in `devlogs/`: days and monthly summaries, newest first, and broken ones with their error. No bodies. */
export async function listDevlogs(options: DevlogOptions = {}): Promise<DevlogListing[]> {
  return (await files.list(options)).map(toDevlog).map(withoutBody).toSorted(newestFirst)
}

/** One day or monthly summary with its body, or why it can't be read. */
export async function readDevlog(id: string, options: DevlogOptions = {}): Promise<Devlog | MonthlySummary | BrokenDevlog> {
  return toDevlog(await files.read(id, options))
}

/**
 * The days from `from` to `to` (both included) with their bodies, newest first, broken ones with their error;
 * monthly summaries are left out.
 */
export async function readDevlogsBetween(
  { from, to }: { from: string; to: string },
  options: DevlogOptions = {},
): Promise<(Devlog | BrokenDevlog)[]> {
  return (await files.list(options))
    .filter(({ id }) => DAY_ID.test(id) && id >= from && id <= to)
    .map((file) => toDevlog(file) as Devlog | BrokenDevlog)
    .toSorted(newestFirst)
}

/**
 * Changes a day's or a monthly summary's body. The header stays byte-for-byte, the body is written in house style,
 * and nothing is written when nothing changed.
 */
export async function updateDevlog(id: string, input: DevlogChange, options: DevlogChangeOptions = {}): Promise<Devlog | MonthlySummary> {
  const { body } = DevlogChangeSchema.parse(input)
  // The shared type checks only that the header is YAML; this kind's own check comes first.
  const current = await readDevlog(id, options)
  if (isBrokenDevlog(current)) throw new MarkdownFileError(`devlogs/${id}.md has a broken header; fix it first. ${current.error}`)
  return toDevlog(await files.update(id, { body }, options)) as Devlog | MonthlySummary
}
