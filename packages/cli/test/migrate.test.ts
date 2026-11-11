// `ostraka migrate`: the Dev log migration's mechanical steps, wired to core. The sample month is invented.
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run } from '../src/main.ts'

const SAMPLE = fileURLToPath(new URL('../../core/test/fixtures/old-devlogs/2026-02.md', import.meta.url))

let contentRoot: string
let originals: string
let oldFile: string

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  originals = await mkdtemp(join(tmpdir(), 'old-devlogs-'))
  oldFile = join(originals, 'February 2026.md')
  await copyFile(SAMPLE, oldFile)
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
  await rm(originals, { recursive: true, force: true })
})

async function ostraka(...argv: string[]) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, {
    env: { OSTRAKA_HOME: contentRoot },
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  })
  return { code, stdout, stderr }
}

const staged = (...path: string[]) => join(contentRoot, '.migration', 'staged', '2026-02', ...path)

async function stageAll(): Promise<void> {
  await mkdir(staged(), { recursive: true })
  for (const date of ['2026-02-02', '2026-02-03', '2026-02-04', '2026-02-06']) {
    await writeFile(staged(`${date}.md`), `---\ndate: ${date}\ntags: [shop-web]\n---\n\n## Done\n\n- Something\n`)
  }
  await writeFile(staged('2026-02-05.md'), '---\ndate: 2026-02-05\noff: true\nlabel: Holiday\n---\n')
  await writeFile(staged('uncertainties.md'), '- 2026-02-05: "Holiday" alone, staged as an off day\n')
}

describe('ostraka migrate', { timeout: 30_000 }, () => {
  it('splits a month, reviews it, settles a Tag and approves it, then reports it', async () => {
    const split = await ostraka('migrate', 'split', oldFile)
    expect(split).toMatchObject({ code: 0, stderr: '' })
    expect(split.stdout).toContain(`Split 2026-02 into 5 days in ${join(contentRoot, '.migration', 'raw', '2026-02')}`)
    expect(split.stdout).toContain('No anomalies.')

    expect((await ostraka('migrate', 'split', oldFile)).stderr).toMatch(/2026-02 is already split/)

    await stageAll()
    expect(await ostraka('migrate', 'tag', '2026-02', 'shop-web', 'shop')).toMatchObject({
      code: 0,
      stdout: 'Retagged 4 days: shop-web → shop\n',
    })
    const review = await ostraka('migrate', 'review', '2026-02')
    expect(review).toMatchObject({ code: 0, stderr: '' })
    expect(review.stdout).toContain('Days: 5 split, 5 staged')
    expect(review.stdout).toContain('#shop  4 days  new')
    expect(review.stdout).toContain('2026-02-05: "Holiday" alone, staged as an off day')
    expect(review.stdout).toContain('Samples: 2026-02-02 2026-02-03 2026-02-05')
    expect(review.stdout).toContain('Ready to approve.')
    const json = JSON.parse((await ostraka('migrate', 'review', '2026-02', '--json')).stdout)
    expect(json).toMatchObject({ month: '2026-02', stagedDays: expect.any(Array), blockers: [] })

    const approved = await ostraka('migrate', 'approve', '2026-02')
    expect(approved).toMatchObject({ code: 0, stderr: '' })
    expect(approved.stdout).toMatch(/^Moved 5 days into .*devlogs\nSnapshot [0-9a-f]{7}  migrate: 2026-02\n$/)
    expect((await readdir(join(contentRoot, 'devlogs'))).length).toBe(5)

    expect((await ostraka('migrate', 'status')).stdout).toBe('2026-02  approved  5 days  no usage recorded\n')
  })

  it('refuses to approve a month with what blocks it, and reports usage per month', async () => {
    await ostraka('migrate', 'split', oldFile)
    const refused = await ostraka('migrate', 'approve', '2026-02')
    expect(refused).toMatchObject({ code: 1, stdout: '' })
    expect(refused.stderr).toContain('Nothing staged for 2026-02')

    await mkdir(join(contentRoot, '.migration', 'usage'))
    await writeFile(
      join(contentRoot, '.migration', 'usage', '2026-02.json'),
      JSON.stringify({
        total_cost_usd: 1.874,
        duration_ms: 812_000,
        num_turns: 41,
        usage: { input_tokens: 5200, cache_creation_input_tokens: 61_000, cache_read_input_tokens: 940_000, output_tokens: 23_400 },
      }),
    )
    expect((await ostraka('migrate', 'status')).stdout).toBe(
      '2026-02  split  5 days  $1.87  5.2k in, 23.4k out, 940.0k cache read, 61.0k cache write, 41 turns, 13m 32s\n',
    )
    expect(JSON.parse((await ostraka('migrate', 'status', '--json')).stdout)).toEqual([
      expect.objectContaining({ month: '2026-02', stage: 'split', usage: expect.objectContaining({ costUsd: 1.874 }) }),
    ])
    expect((await readFile(oldFile, 'utf8')).length).toBeGreaterThan(0)
  })

  it('prints its usage for anything else', async () => {
    const wrong = await ostraka('migrate', 'tag', '2026-02', 'shop')
    expect(wrong.code).toBe(1)
    expect(wrong.stderr).toContain('ostraka migrate split <old monthly file>')
  })
})
