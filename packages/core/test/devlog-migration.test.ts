// The migration of the old monthly Dev log files: a script (no AI) splits each month into raw daily files under
// `.migration/raw/`, an agent session per month stages reformatted days under `.migration/staged/`, and an approved
// month moves into `devlogs/` with one Snapshot. The sample months in fixtures/ are invented.
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  approveMigratedMonth,
  listDevlogs,
  migrationStatus,
  retagStagedMonth,
  reviewMigratedMonth,
  splitMonthlyDevlog,
  type ContentRootOptions,
} from '../src/index.ts'

// fileURLToPath, not .pathname, which keeps a space in the path (the installed copy's Application Support) as %20.
const FIXTURES = fileURLToPath(new URL('./fixtures/old-devlogs/', import.meta.url))

let contentRoot: string
let originals: string
let options: ContentRootOptions

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  originals = await mkdtemp(join(tmpdir(), 'old-devlogs-'))
  options = { env: { OSTRAKA_HOME: contentRoot } }
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
  await rm(originals, { recursive: true, force: true })
})

/** A copy of a sample month, as the user's old file would be: outside the content folder. */
async function original(fixture: string, name = fixture): Promise<string> {
  const file = join(originals, name)
  await copyFile(join(FIXTURES, fixture), file)
  return file
}

const raw = (...path: string[]) => join(contentRoot, '.migration', 'raw', ...path)
const sortedLines = (text: string) => text.split(/(?<=\n)/).toSorted()
const staged = (...path: string[]) => join(contentRoot, '.migration', 'staged', ...path)

async function stage(month: string, name: string, text: string): Promise<void> {
  await mkdir(staged(month), { recursive: true })
  await writeFile(staged(month, name), text)
}

async function devlog(date: string, text: string): Promise<void> {
  await mkdir(join(contentRoot, 'devlogs'), { recursive: true })
  await writeFile(join(contentRoot, 'devlogs', `${date}.md`), text)
}

const day = (date: string, tags: string[], body = '## Done\n\n- Something\n') =>
  `---\ndate: ${date}\ntags: [${tags.join(', ')}]\n---\n\n${body}`

/** What `claude -p --output-format json` prints at the end of a session. */
const CLAUDE_RESULT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 812_000,
  num_turns: 41,
  result: 'Staged 5 days.',
  session_id: '3f1c',
  total_cost_usd: 1.87,
  usage: { input_tokens: 5200, cache_creation_input_tokens: 61_000, cache_read_input_tokens: 940_000, output_tokens: 23_400 },
}

describe('splitMonthlyDevlog', () => {
  it('splits a month at its day headings into one raw file per day, each exactly as written', async () => {
    const file = await original('2026-02.md')
    const split = await splitMonthlyDevlog(file, options)

    expect(split.month).toBe('2026-02')
    expect(split.days).toEqual(['2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06'])
    expect(split.anomalies).toEqual([])
    expect((await readdir(raw('2026-02'))).filter((name) => name.endsWith('.md')).toSorted()).toEqual([
      '2026-02-02.md',
      '2026-02-03.md',
      '2026-02-04.md',
      '2026-02-05.md',
      '2026-02-06.md',
      'preamble.md',
    ])
    expect(await readFile(raw('2026-02', '2026-02-03.md'), 'utf8')).toBe(
      '## Tuesday 3\n\nWorked on the export job (SHOP-15), got the CSV header right.\n\n',
    )
    expect(await readFile(raw('2026-02', 'preamble.md'), 'utf8')).toBe('# February 2026\n\n')
  })

  it('loses nothing: the raw files in order are the original, which is never modified', async () => {
    const file = await original('2026-02.md')
    const before = { text: await readFile(file, 'utf8'), mtime: (await stat(file)).mtimeMs }
    const split = await splitMonthlyDevlog(file, options)

    const pieces = await Promise.all(['preamble', ...split.days].map((name) => readFile(raw('2026-02', `${name}.md`), 'utf8')))
    expect(pieces.join('')).toBe(before.text)
    expect(await readFile(file, 'utf8')).toBe(before.text)
    expect((await stat(file)).mtimeMs).toBe(before.mtime)
  })

  it('flags what looks wrong in a month, and still keeps every line of it', async () => {
    const file = await original('messy-month.md')
    const split = await splitMonthlyDevlog(file, options)

    expect(split.month).toBe('2026-03') // from its "# March 2026" title
    expect(split.days).toEqual(['2026-03-02', '2026-03-04', '2026-03-05', '2026-03-07', '2026-03-09'])
    expect(split.anomalies.map(({ line, kind, date }) => [line, kind, date])).toEqual([
      [3, 'preamble', undefined],
      [13, 'weekday', '2026-03-04'],
      [17, 'stray-heading', '2026-03-04'],
      [21, 'weekend', '2026-03-07'],
      [25, 'empty', '2026-03-09'],
      [27, 'order', '2026-03-05'],
      [31, 'duplicate', '2026-03-02'],
      [35, 'no-such-day', undefined],
      [undefined, 'missing', '2026-03-03'],
      [undefined, 'missing', '2026-03-06'],
    ])
    expect(split.anomalies.find((anomaly) => anomaly.kind === 'weekday')?.message).toBe(
      '"## Tuesday 4", but 2026-03-04 is a Wednesday: kept as 2026-03-04',
    )

    expect(await readFile(raw('2026-03', '2026-03-02.md'), 'utf8')).toBe(
      '## Monday 2\n\n- Export job: retry on timeout\n\n```text\n## Not a heading, inside a code fence\n```\n\n' +
        '## Monday 2\n\n- Forgot: deployed the export job\n\n',
    )
    expect(await readFile(raw('2026-03', 'unplaced-35.md'), 'utf8')).toBe('## Monday 32\n\n- Typo day: talked to Bo about the invoices\n')
    const names = (await readdir(raw('2026-03'))).filter((name) => name.endsWith('.md'))
    const pieces = await Promise.all(names.map((name) => readFile(raw('2026-03', name), 'utf8')))
    expect(sortedLines(pieces.join(''))).toEqual(sortedLines(await readFile(file, 'utf8')))
  })

  it('takes the month from a name like "April 2026.md", as given, or asks for it', async () => {
    expect((await splitMonthlyDevlog(await original('2026-02.md', 'Feb 2026 log.md'), options)).month).toBe('2026-02')
    const untitled = await original('2026-02.md', 'old.md')
    expect((await splitMonthlyDevlog(untitled, { ...options, month: '2025-12' })).days[0]).toBe('2025-12-02')
    await writeFile(untitled, '## Monday 2\n\n- Something\n')
    await expect(splitMonthlyDevlog(untitled, options)).rejects.toThrow(/give it as YYYY-MM/)
  })

  it('refuses to split a month already split, unless asked to split it again', async () => {
    const file = await original('2026-02.md')
    await splitMonthlyDevlog(file, options)
    await expect(splitMonthlyDevlog(file, options)).rejects.toThrow('2026-02 is already split')
    await writeFile(file, '# February 2026\n\n## Monday 9\n\n- Only this\n')
    expect((await splitMonthlyDevlog(file, { ...options, again: true })).days).toEqual(['2026-02-09'])
    expect((await readdir(raw('2026-02'))).filter((name) => name.endsWith('.md')).toSorted()).toEqual(['2026-02-09.md', 'preamble.md'])
  })
})

describe('reviewMigratedMonth', () => {
  it('shows the day count, the Tags to settle, the uncertainties and what blocks approval', async () => {
    await splitMonthlyDevlog(await original('2026-02.md'), options)
    await devlog('2026-01-30', day('2026-01-30', ['shop']))
    await devlog('2026-02-03', day('2026-02-03', []))
    await stage('2026-02', '2026-02-02.md', day('2026-02-02', ['shop', 'code-review']))
    await stage('2026-02', '2026-02-03.md', day('2026-02-03', ['shop', 'exports']))
    await stage(
      '2026-02',
      '2026-02-04.md',
      day('2026-02-04', ['shop', 'sprint', 'testing', 'login'], '## Todo\n\n- Fix the flaky login test\n'),
    )
    await stage('2026-02', '2026-02-05.md', '---\ndate: 2026-02-05\noff: true\nlabel: Holiday\n---\n')
    await stage(
      '2026-02',
      'uncertainties.md',
      '# Uncertainties\n\n- 2026-02-05: "Holiday" alone, staged as an off day\n- Ana is not in the People directory: left as a plain name\n',
    )
    await mkdir(join(contentRoot, '.migration', 'usage'), { recursive: true })
    await writeFile(join(contentRoot, '.migration', 'usage', '2026-02.json'), JSON.stringify(CLAUDE_RESULT))

    const review = await reviewMigratedMonth('2026-02', options)

    expect(review).toMatchObject({
      month: '2026-02',
      rawDays: ['2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06'],
      stagedDays: ['2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05'],
      unstaged: ['2026-02-06'],
      unexpected: [],
      conflicts: ['2026-02-03'],
      anomalies: [],
      uncertainties: [
        { date: '2026-02-05', text: '"Holiday" alone, staged as an off day' },
        { text: 'Ana is not in the People directory: left as a plain name' },
      ],
      usage: { costUsd: 1.87, inputTokens: 5200, outputTokens: 23_400, cacheReadTokens: 940_000, cacheWriteTokens: 61_000, turns: 41 },
    })
    expect(review.source).toMatch(/2026-02\.md$/)
    expect(review.tags).toEqual([
      { name: 'shop', days: ['2026-02-02', '2026-02-03'], inUse: true },
      { name: 'code-review', days: ['2026-02-02'], inUse: false },
      { name: 'exports', days: ['2026-02-03'], inUse: false },
    ])
    expect(review.problems).toEqual([
      {
        date: '2026-02-04',
        problems: [
          expect.stringMatching(/At most 3 Tags on a day/),
          'Todo is not a Dev log section: use Done, Meetings & discussions or Notes.',
        ],
      },
    ])
    // The days the session was unsure of first, then the longest.
    expect(review.samples).toEqual(['2026-02-02', '2026-02-03', '2026-02-05'])
    expect(review.blockers).toEqual([
      '2026-02-06 is not staged: the session skipped it',
      expect.stringMatching(/^2026-02-04: Invalid header/),
      '2026-02-04: Todo is not a Dev log section: use Done, Meetings & discussions or Notes.',
      '2026-02-03 already has a Dev log: it is never overwritten',
    ])
  })

  it('says when a month was never split', async () => {
    await expect(reviewMigratedMonth('2026-04', options)).rejects.toThrow('2026-04 is not split yet')
  })
})

describe('retagStagedMonth', () => {
  it('renames, merges or removes a Tag on the staged days, leaving the rest of each file as it is', async () => {
    await stage('2026-02', '2026-02-02.md', day('2026-02-02', ['shop', 'code-review'], '## Done\n\n- Reviewed acme/shop/web!88\n'))
    await stage(
      '2026-02',
      '2026-02-03.md',
      '---\ndate: 2026-02-03\ntags: [shop-web, exports] # suggested\nsources: []\n---\n\n## Notes\n\n- CSV\n',
    )
    await stage('2026-02', '2026-02-04.md', day('2026-02-04', ['shop-web', 'shop']))

    expect(await retagStagedMonth('2026-02', 'shop-web', 'shop', options)).toEqual(['2026-02-03', '2026-02-04'])
    expect(await readFile(staged('2026-02', '2026-02-03.md'), 'utf8')).toBe(
      '---\ndate: 2026-02-03\ntags: [shop, exports] # suggested\nsources: []\n---\n\n## Notes\n\n- CSV\n',
    )
    expect(await readFile(staged('2026-02', '2026-02-04.md'), 'utf8')).toBe(day('2026-02-04', ['shop']))

    expect(await retagStagedMonth('2026-02', 'exports', undefined, options)).toEqual(['2026-02-03'])
    expect(await readFile(staged('2026-02', '2026-02-03.md'), 'utf8')).toMatch(/^tags: \[shop\] # suggested$/m)
    expect(await readFile(staged('2026-02', '2026-02-02.md'), 'utf8')).toBe(
      day('2026-02-02', ['shop', 'code-review'], '## Done\n\n- Reviewed acme/shop/web!88\n'),
    )
  })

  it('refuses a name that is not a Tag', async () => {
    await stage('2026-02', '2026-02-02.md', day('2026-02-02', ['shop']))
    await expect(retagStagedMonth('2026-02', 'shop', 'Shop Web!', options)).rejects.toThrow(/isn’t a Tag/)
  })
})

const git = (...args: string[]) => execFileSync('git', ['-C', contentRoot, ...args], { encoding: 'utf8' }).trim()

/** The sample February, split and staged in full as an agent session would leave it. */
async function stageFebruary(): Promise<void> {
  await splitMonthlyDevlog(await original('2026-02.md'), options)
  for (const date of ['2026-02-02', '2026-02-03', '2026-02-04', '2026-02-06']) await stage('2026-02', `${date}.md`, day(date, ['shop']))
  await stage('2026-02', '2026-02-05.md', '---\ndate: 2026-02-05\noff: true\nlabel: Holiday\n---\n')
  await stage('2026-02', 'uncertainties.md', '- 2026-02-05: "Holiday" alone, staged as an off day\n')
}

// Each git process takes a few hundred ms to spawn under the test runner on macOS.
describe('approveMigratedMonth', { timeout: 30_000 }, () => {
  it('moves the month’s staged days into the Dev logs and snapshots them as migrate: <YYYY-MM>', async () => {
    await stageFebruary()
    const before = await readFile(staged('2026-02', '2026-02-03.md'), 'utf8')

    const approved = await approveMigratedMonth('2026-02', options)

    expect(approved.moved).toEqual(['2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06'])
    expect(approved.snapshot).toEqual({ commit: git('rev-parse', 'HEAD'), message: 'migrate: 2026-02' })
    expect(await readFile(join(contentRoot, 'devlogs', '2026-02-03.md'), 'utf8')).toBe(before)
    expect((await listDevlogs(options)).map((log) => [log.id, 'error' in log])).toEqual([
      ['2026-02-06', false],
      ['2026-02-05', false],
      ['2026-02-04', false],
      ['2026-02-03', false],
      ['2026-02-02', false],
    ])
    expect(git('log', '--format=%s')).toBe('migrate: 2026-02')
    expect(git('ls-tree', '-r', '--name-only', 'HEAD').split('\n')).toEqual([
      'devlogs/2026-02-02.md',
      'devlogs/2026-02-03.md',
      'devlogs/2026-02-04.md',
      'devlogs/2026-02-05.md',
      'devlogs/2026-02-06.md',
    ])
    expect(await readdir(staged('2026-02'))).toEqual(['uncertainties.md'])
  })

  it('refuses, moving nothing, while a day is unstaged, broken or already has a Dev log', async () => {
    await stageFebruary()
    await rm(staged('2026-02', '2026-02-06.md'))
    await stage('2026-02', '2026-02-04.md', day('2026-02-04', ['a', 'b', 'c', 'd']))
    await devlog('2026-02-03', day('2026-02-03', []))

    const refusal = approveMigratedMonth('2026-02', options)

    await expect(refusal).rejects.toThrow(/2026-02-06 is not staged/)
    await expect(refusal).rejects.toThrow(/2026-02-04: Invalid header/)
    await expect(refusal).rejects.toThrow(/2026-02-03 already has a Dev log/)
    expect(await readdir(join(contentRoot, 'devlogs'))).toEqual(['2026-02-03.md'])
    expect((await readdir(staged('2026-02'))).length).toBe(5)
  })

  it('refuses a month with nothing staged', async () => {
    await splitMonthlyDevlog(await original('2026-02.md'), options)
    await expect(approveMigratedMonth('2026-02', options)).rejects.toThrow('Nothing staged for 2026-02')
  })
})

describe('migrationStatus', { timeout: 30_000 }, () => {
  it('lists each month split, where it stands and what its session used, oldest first', async () => {
    expect(await migrationStatus(options)).toEqual([])
    await stageFebruary()
    await mkdir(join(contentRoot, '.migration', 'usage'), { recursive: true })
    await writeFile(join(contentRoot, '.migration', 'usage', '2026-02.json'), JSON.stringify(CLAUDE_RESULT))
    await approveMigratedMonth('2026-02', options)
    await splitMonthlyDevlog(await original('messy-month.md'), options)
    await stage('2026-03', '2026-03-02.md', day('2026-03-02', []))
    const april = join(originals, 'april.md')
    await writeFile(april, '# April 2026\n\n## Wednesday 1\n\n- Kick-off for the returns flow\n')
    await splitMonthlyDevlog(april, options)
    await writeFile(join(contentRoot, '.migration', 'usage', '2026-04.json'), 'Error: session stopped')

    expect(await migrationStatus(options)).toEqual([
      { month: '2026-02', stage: 'approved', rawDays: 5, stagedDays: 0, anomalies: 0, usage: expect.objectContaining({ costUsd: 1.87 }) },
      { month: '2026-03', stage: 'staged', rawDays: 5, stagedDays: 1, anomalies: 10 },
      { month: '2026-04', stage: 'split', rawDays: 1, stagedDays: 0, anomalies: 0, usage: { error: expect.any(String) } },
    ])
  })
})
