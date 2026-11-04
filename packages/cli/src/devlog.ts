// `ostraka devlog`: list Dev logs and the weekdays missing one, a thin layer over core.
import { homedir } from 'node:os'
import { parseArgs } from 'node:util'
import { isBrokenDevlog, listDevlogs, localDay, missingDevlogWeeks, type DevlogListing } from '@ostraka/core'
import type { Io } from './main.ts'

export const DEVLOG_USAGE = `  ostraka devlog list [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>] [--json]
                                List Dev logs and monthly summaries, newest first (a broken one with its error)
  ostraka devlog missing [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>] [--json]
                                List the weekdays with no Dev log, by week, oldest first: from the first
                                Dev log (or --from) to today (or --to)
`

const DAY = /^\d{4}-\d{2}-\d{2}$/
const MONTH = /^\d{4}-\d{2}$/

/** A day from `from` to `to`, a monthly summary of a month they touch, and any misnamed file, which is always shown. */
const inRange = (id: string, from = '0000-00-00', to = '9999-99-99') =>
  DAY.test(id) ? id >= from && id <= to : MONTH.test(id) ? id >= from.slice(0, 7) && id <= to.slice(0, 7) : true

/** `date  #tag  sources: …`, `date  off: label`, `month  monthly summary  #tag` or `id  broken: error`. */
function devlogLine(log: DevlogListing): string {
  if (isBrokenDevlog(log)) return `${log.id}  broken: ${log.error}`
  const tags = log.tags.length ? [log.tags.map((tag) => `#${tag}`).join(' ')] : []
  if (log.kind === 'month') return [`${log.id}  monthly summary`, ...tags].join('  ')
  if (log.off) return `${log.id}  off${log.label ? `: ${log.label}` : ''}`
  return [log.id, ...tags, ...(log.sources.length ? [`sources: ${log.sources.join(', ')}`] : [])].join('  ')
}

export async function devlogCommand(args: string[], io: Io): Promise<number> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: { json: { type: 'boolean' }, from: { type: 'string' }, to: { type: 'string' } },
  })
  const { from, to } = values
  const [subcommand] = positionals
  const dates = [from, to].filter((date) => date !== undefined)
  if (positionals.length !== 1 || (subcommand !== 'list' && subcommand !== 'missing') || !dates.every((date) => DAY.test(date))) {
    io.stderr(`Usage:\n${DEVLOG_USAGE}`)
    return 1
  }
  const all = await listDevlogs({ env: io.env, homeDir: io.homeDir ?? homedir() })
  if (subcommand === 'missing') {
    if (from === undefined && !all.some((log) => DAY.test(log.id))) {
      io.stderr('No Dev log yet, so no first day to start from: pass --from <YYYY-MM-DD>.\n')
      return 1
    }
    const weeks = missingDevlogWeeks(all, localDay((io.now ?? (() => new Date()))()), { from, to })
    const lines = weeks.map((week) => `week of ${week.start}: ${week.days.join(' ')}`)
    io.stdout(values.json ? `${JSON.stringify(weeks, null, 2)}\n` : lines.length ? `${lines.join('\n')}\n` : 'No missing days.\n')
    return 0
  }
  const logs = all.filter((log) => inRange(log.id, from, to))
  io.stdout(values.json ? `${JSON.stringify(logs, null, 2)}\n` : logs.length ? `${logs.map(devlogLine).join('\n')}\n` : 'No Dev logs.\n')
  return 0
}
