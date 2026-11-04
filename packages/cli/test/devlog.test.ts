import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run } from '../src/main.ts'

let contentRoot: string

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  await mkdir(join(contentRoot, 'devlogs'))
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
})

// Wednesday 4 November 2026, mid-morning local time.
const NOW = new Date(2026, 10, 4, 9, 30)

async function ostraka(...argv: string[]) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, {
    env: { OSTRAKA_HOME: contentRoot },
    now: () => NOW,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  })
  return { code, stdout, stderr }
}

const devlog = (id: string, text: string) => writeFile(join(contentRoot, 'devlogs', `${id}.md`), text)

describe('ostraka devlog list', () => {
  it('lists days and monthly summaries newest first, an off day with its label and a broken file with its error', async () => {
    await devlog(
      '2026-10-29',
      '---\ndate: 2026-10-29\ntags: [billing, code-review]\nsources: [todos, gitlab]\n---\n\n## Done\n\n- Shipped\n',
    )
    await devlog('2026-10-30', '---\ndate: 2026-10-30\noff: true\nlabel: Holiday\n---\n')
    await devlog('2026-10', '---\nmonth: 2026-10\ntags: [billing]\n---\n\n# October 2026\n')
    await devlog('2026-10-31', '---\ndate: 2026-10-31\ntags: [a, b, c, d]\n---\n')

    const listed = await ostraka('devlog', 'list')
    expect(listed).toMatchObject({ code: 0, stderr: '' })
    const [broken, ...rest] = listed.stdout.split('\n')
    expect(broken).toMatch(/^2026-10-31  broken: Invalid header: .*At most 3 Tags on a day/)
    expect(rest).toEqual([
      '2026-10-30  off: Holiday',
      '2026-10-29  #billing #code-review  sources: todos, gitlab',
      '2026-10  monthly summary  #billing',
      '',
    ])
  })

  it('says when there are none', async () => {
    expect(await ostraka('devlog', 'list')).toEqual({ code: 0, stdout: 'No Dev logs.\n', stderr: '' })
  })

  it('narrows to a date range, keeping the summaries of the months it touches', async () => {
    await devlog('2026-09-30', '---\ndate: 2026-09-30\n---\n')
    await devlog('2026-10-01', '---\ndate: 2026-10-01\n---\n')
    await devlog('2026-10-02', '---\ndate: 2026-10-02\n---\n')
    await devlog('2026-09', '---\nmonth: 2026-09\n---\n')
    await devlog('2026-10', '---\nmonth: 2026-10\n---\n')

    const { stdout } = await ostraka('devlog', 'list', '--from', '2026-10-01', '--to', '2026-10-01')
    expect(stdout).toBe('2026-10-01\n2026-10  monthly summary\n')
  })

  it('gives agents JSON: the header fields of each day, or its error', async () => {
    await devlog('2026-11-03', '---\ndate: 2026-11-03\ntags: [billing]\nsources: [todos, slack]\n---\n\n## Done\n\n- Shipped\n')
    await devlog('2026-11-02', '---\ndate: 2026-11-01\n---\n')

    const { code, stdout } = await ostraka('devlog', 'list', '--json')
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toEqual([
      expect.objectContaining({ kind: 'day', id: '2026-11-03', date: '2026-11-03', tags: ['billing'], sources: ['todos', 'slack'] }),
      expect.objectContaining({
        id: '2026-11-02',
        error: 'Invalid header: date is 2026-11-01, but the file is the Dev log of 2026-11-02.',
      }),
    ])
    expect(stdout).not.toContain('Shipped')
  })

  it('refuses a date that is not YYYY-MM-DD', async () => {
    const { code, stderr } = await ostraka('devlog', 'list', '--from', 'yesterday')
    expect(code).toBe(1)
    expect(stderr).toMatch(/ostraka devlog list/)
  })
})

describe('ostraka devlog gaps', () => {
  it('lists the weekdays without a Dev log among the 7 before today, newest first', async () => {
    await devlog('2026-11-03', '---\ndate: 2026-11-03\n---\n')
    await devlog('2026-10-30', '---\ndate: 2026-10-30\noff: true\n---\n')
    await devlog('2026-10-28', '---\ndate: 2026-10-28\n---\n')

    expect(await ostraka('devlog', 'gaps')).toEqual({ code: 0, stdout: '2026-11-02\n2026-10-29\n2026-10-27\n2026-10-26\n', stderr: '' })
    expect(JSON.parse((await ostraka('devlog', 'gaps', '--json')).stdout)).toEqual(['2026-11-02', '2026-10-29', '2026-10-27', '2026-10-26'])
  })

  it('says when there are none', async () => {
    for (const date of ['2026-11-03', '2026-11-02', '2026-10-30', '2026-10-29', '2026-10-28', '2026-10-27', '2026-10-26']) {
      await devlog(date, `---\ndate: ${date}\n---\n`)
    }
    expect(await ostraka('devlog', 'gaps')).toEqual({ code: 0, stdout: 'No Dev log gaps in the 7 weekdays before today.\n', stderr: '' })
  })
})
