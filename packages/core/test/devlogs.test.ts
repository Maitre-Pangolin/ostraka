import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listDevlogs, readDevlog, readDevlogsBetween, StaleVersionError, updateDevlog, type DevlogOptions } from '../src/index.ts'

let contentRoot: string
let options: DevlogOptions

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  options = { env: { OSTRAKA_HOME: contentRoot } }
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
})

const devlogFile = (id: string) => join(contentRoot, 'devlogs', `${id}.md`)
const writeDevlog = async (id: string, text: string) => {
  await mkdir(join(contentRoot, 'devlogs'), { recursive: true })
  await writeFile(devlogFile(id), text)
}

const DAY = `---
date: 2026-10-29
tags: [billing, code-review]
sources: [todos, gitlab, jira, slack]
---

## Done

- Shipped acme/billing!42 for BILL-7

## Notes

- Waiting on @jane for the rollout date
`

describe('listDevlogs', () => {
  it('lists no Dev logs before there is a devlogs folder', async () => {
    expect(await listDevlogs(options)).toEqual([])
  })

  it('lists a day with its header fields and no body, newest first, monthly summaries among them', async () => {
    await writeDevlog('2026-10-29', DAY)
    await writeDevlog('2026-10-30', '---\ndate: 2026-10-30\noff: true\nlabel: Holiday\n---\n')
    await writeDevlog('2026-10', '---\nmonth: 2026-10\n---\n\n# October\n')
    expect(await listDevlogs(options)).toEqual([
      {
        kind: 'day',
        id: '2026-10-30',
        date: '2026-10-30',
        tags: [],
        sources: [],
        off: true,
        label: 'Holiday',
        version: expect.any(String),
        modifiedAt: expect.any(String),
      },
      {
        kind: 'day',
        id: '2026-10-29',
        date: '2026-10-29',
        tags: ['billing', 'code-review'],
        sources: ['todos', 'gitlab', 'jira', 'slack'],
        version: expect.any(String),
        modifiedAt: expect.any(String),
      },
      { kind: 'month', id: '2026-10', month: '2026-10', tags: [], version: expect.any(String), modifiedAt: expect.any(String) },
    ])
  })

  it('lists a broken file with its reason: bad YAML, a bad header, a date not matching its name, or a name that is no day or month', async () => {
    await writeDevlog('2026-10-26', '---\ntags: [oops\n---\n')
    await writeDevlog('2026-10-27', '---\ndate: 2026-10-27\ntags: [a, b, c, d]\n---\n')
    await writeDevlog('2026-10-28', '---\ndate: 2026-10-29\n---\n')
    await writeDevlog('2026-10-29', '---\ndate: 2026-10-29\nlabel: Holiday\n---\n')
    await writeDevlog('todo-list', '---\n---\n')
    const listed = await listDevlogs(options)
    const errors = Object.fromEntries(listed.map((log) => [log.id, 'error' in log ? log.error : undefined]))
    expect(errors).toEqual({
      'todo-list': expect.stringContaining('devlogs/<YYYY-MM-DD>.md'),
      '2026-10-29': expect.stringContaining('off: true'),
      '2026-10-28': expect.stringContaining('2026-10-28'),
      '2026-10-27': expect.stringContaining('3'),
      '2026-10-26': expect.stringContaining('Broken YAML header'),
    })
  })
})

describe('readDevlog', () => {
  it('reads a day with its body, and a monthly summary', async () => {
    await writeDevlog('2026-10-29', DAY)
    await writeDevlog('2026-10', '---\nmonth: 2026-10\n---\n\n# October\n')
    expect(await readDevlog('2026-10-29', options)).toMatchObject({ kind: 'day', date: '2026-10-29', body: DAY.split('---\n\n')[1] })
    expect(await readDevlog('2026-10', options)).toMatchObject({ kind: 'month', month: '2026-10', body: '# October\n' })
  })
})

describe('readDevlogsBetween', () => {
  it('reads the days from one date to another with their bodies, newest first, without monthly summaries', async () => {
    await writeDevlog('2026-10-28', '---\ndate: 2026-10-28\n---\n\n## Done\n\n- One\n')
    await writeDevlog('2026-10-29', DAY)
    await writeDevlog('2026-11-02', '---\ndate: 2026-11-02\n---\n')
    await writeDevlog('2026-10', '---\nmonth: 2026-10\n---\n')
    const days = await readDevlogsBetween({ from: '2026-10-28', to: '2026-10-31' }, options)
    expect(days.map((day) => day.id)).toEqual(['2026-10-29', '2026-10-28'])
    expect(days[1]).toMatchObject({ body: '## Done\n\n- One\n' })
  })
})

describe('updateDevlog', () => {
  it('writes a new body in house style, keeping the header byte-for-byte, and refuses a stale copy', async () => {
    await writeDevlog('2026-10-29', DAY)
    const loaded = await readDevlog('2026-10-29', options)
    if ('error' in loaded) throw new Error(loaded.error)
    const saved = await updateDevlog('2026-10-29', { body: '## Done\n\n* Shipped it\n' }, { ...options, ifVersion: loaded.version })
    expect(await readFile(devlogFile('2026-10-29'), 'utf8')).toBe(`${DAY.split('\n\n')[0]}\n\n## Done\n\n- Shipped it\n`)
    expect(saved).toMatchObject({ kind: 'day', body: '## Done\n\n- Shipped it\n' })
    await expect(updateDevlog('2026-10-29', { body: 'Again' }, { ...options, ifVersion: loaded.version })).rejects.toThrow(
      StaleVersionError,
    )
  })
})
