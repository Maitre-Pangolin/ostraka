// `ostraka migrate`: the mechanical steps of the old monthly Dev logs' migration (#41), a thin layer over core.
// The reformatting between `split` and `review` is an agent session per month, following migrate-month.md of the
// private `devlog-migrate` skill (gitignored, so only in the owner's checkout); the review and approval are its migrate.md.
import { homedir } from 'node:os'
import { parseArgs } from 'node:util'
import {
  approveMigratedMonth,
  contentPath,
  migrationStatus,
  retagStagedMonth,
  reviewMigratedMonth,
  splitMonthlyDevlog,
  type MigrationUsage,
  type MonthReview,
  type SplitAnomaly,
} from '@ostraka/core'
import type { Io } from './main.ts'

export const MIGRATE_USAGE = `  ostraka migrate split <old monthly file> [--month <YYYY-MM>] [--again] [--json]
                                Split an old monthly Dev log at its "## <Day> <N>" headings into raw days
                                in .migration/raw/<YYYY-MM>/ and flag anomalies; the old file is only read
  ostraka migrate review <YYYY-MM> [--json]
                                A staged month's day count, Tags, uncertainties, anomalies, sample days,
                                usage and what blocks its approval
  ostraka migrate tag <YYYY-MM> <tag> (<new tag>|--remove) [--json]
                                Rename a Tag on the month's staged days, merge it into another, or remove it
  ostraka migrate approve <YYYY-MM> [--json]
                                Move the month's staged days into the Dev logs, snapshot "migrate: <YYYY-MM>"
  ostraka migrate status [--json]
                                Each month split: where it stands and what its agent session used
`

const MONTH = /^\d{4}-\d{2}$/

const plural = (n: number, word: string, words = `${word}s`) => `${n} ${n === 1 ? word : words}`

const anomalyLine = (anomaly: SplitAnomaly) =>
  `  ${anomaly.line === undefined ? '' : `line ${anomaly.line}  `}${anomaly.kind}  ${anomaly.message}`

/** `5.2k`, `1.0M`: token counts at a glance. */
function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/** `$1.87  5.2k in, 23.4k out, 1.0M cache read, 61.0k cache write, 41 turns, 13m 32s`. */
function usageText(usage: MigrationUsage | { error: string } | undefined): string {
  if (usage === undefined) return 'no usage recorded'
  if ('error' in usage) return `usage unreadable: ${usage.error}`
  const parts = [
    `${tokens(usage.inputTokens)} in`,
    `${tokens(usage.outputTokens)} out`,
    `${tokens(usage.cacheReadTokens)} cache read`,
    `${tokens(usage.cacheWriteTokens)} cache write`,
    ...(usage.turns === undefined ? [] : [plural(usage.turns, 'turn')]),
    ...(usage.durationMs === undefined
      ? []
      : [`${Math.floor(usage.durationMs / 60_000)}m ${Math.round((usage.durationMs % 60_000) / 1000)}s`]),
  ]
  return [...(usage.costUsd === undefined ? [] : [`$${usage.costUsd.toFixed(2)}`]), parts.join(', ')].join('  ')
}

function reviewText(review: MonthReview): string {
  const lines = [`${review.month}${review.source ? `  from ${review.source}` : ''}`]
  lines.push(`Days: ${review.rawDays.length} split, ${review.stagedDays.length} staged`)
  if (review.unstaged.length) lines.push(`Not staged: ${review.unstaged.join(' ')}`)
  if (review.unexpected.length) lines.push(`Staged without a raw day: ${review.unexpected.join(' ')}`)
  const section = (title: string, items: string[]) => {
    if (items.length) lines.push(`${title}:`, ...items)
  }
  section(
    'Tags',
    review.tags.map((tag) => `  #${tag.name}  ${plural(tag.days.length, 'day')}  ${tag.inUse ? 'in use' : 'new'}`),
  )
  section(
    'Uncertainties',
    review.uncertainties.map((item) => `  ${item.date ? `${item.date}: ` : ''}${item.text}`),
  )
  section('Split anomalies', review.anomalies.map(anomalyLine))
  lines.push(`Samples: ${review.samples.join(' ')}`)
  lines.push(`Usage: ${usageText(review.usage)}`)
  lines.push(`Raw days: ${review.folders.raw}`, `Staged days: ${review.folders.staged}`)
  if (review.blockers.length)
    section(
      'Not ready to approve',
      review.blockers.map((line) => `  ${line}`),
    )
  else lines.push('Ready to approve.')
  return `${lines.join('\n')}\n`
}

export async function migrateCommand(args: string[], io: Io): Promise<number> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: 'boolean' },
      month: { type: 'string' },
      again: { type: 'boolean' },
      remove: { type: 'boolean' },
    },
  })
  const [action, ...rest] = positionals
  const options = { env: io.env, homeDir: io.homeDir ?? homedir() }
  const print = (value: unknown, text: string) => io.stdout(values.json ? `${JSON.stringify(value, null, 2)}\n` : text)
  const [month] = rest
  const isMonth = month !== undefined && MONTH.test(month)

  if (action === 'split' && rest.length === 1) {
    const split = await splitMonthlyDevlog(rest[0]!, { ...options, month: values.month, again: values.again })
    const review = await reviewMigratedMonth(split.month, options)
    const anomalies = split.anomalies.length
      ? `${plural(split.anomalies.length, 'anomaly', 'anomalies')}:\n${split.anomalies.map(anomalyLine).join('\n')}\n`
      : 'No anomalies.\n'
    print(split, `Split ${split.month} into ${plural(split.days.length, 'day')} in ${review.folders.raw}\n${anomalies}`)
    return 0
  }
  if (action === 'review' && rest.length === 1 && isMonth) {
    const review = await reviewMigratedMonth(month, options)
    print(review, reviewText(review))
    return 0
  }
  if (action === 'tag' && isMonth && (rest.length === 3 ? !values.remove : rest.length === 2 && values.remove)) {
    const [, from, to] = rest
    const changed = await retagStagedMonth(month, from!, to, options)
    print(changed, `Retagged ${plural(changed.length, 'day')}: ${from} → ${to ?? '(removed)'}\n`)
    return 0
  }
  if (action === 'approve' && rest.length === 1 && isMonth) {
    const approved = await approveMigratedMonth(month, options)
    print(
      approved,
      `Moved ${plural(approved.moved.length, 'day')} into ${await contentPath('devlogs', options)}\n` +
        (approved.snapshot ? `Snapshot ${approved.snapshot.commit.slice(0, 7)}  ${approved.snapshot.message}\n` : 'Nothing changed.\n'),
    )
    return 0
  }
  if (action === 'status' && rest.length === 0) {
    const months = await migrationStatus(options)
    const line = (status: (typeof months)[number]) =>
      [
        status.month,
        status.stage,
        plural(status.rawDays, 'day'),
        ...(status.stage === 'staged' ? [`${status.stagedDays} staged`] : []),
        ...(status.anomalies ? [plural(status.anomalies, 'anomaly', 'anomalies')] : []),
        usageText(status.usage),
      ].join('  ')
    print(months, months.length ? `${months.map(line).join('\n')}\n` : 'No month split yet.\n')
    return 0
  }
  io.stderr(`Usage:\n${MIGRATE_USAGE}`)
  return 1
}
