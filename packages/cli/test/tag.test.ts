import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run } from '../src/main.ts'

let contentRoot: string

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
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

describe('ostraka tag list', () => {
  it('lists every Tag in use on Todos, Notes and Dev logs, once each, sorted', async () => {
    await ostraka('todo', 'add', 'Renew the certificate #ops #billing')
    await mkdir(join(contentRoot, 'notes'))
    await writeFile(join(contentRoot, 'notes', 'plan.md'), '---\ntags: [idea, billing]\n---\n# Plan\n')
    await mkdir(join(contentRoot, 'devlogs'))
    await writeFile(join(contentRoot, 'devlogs', '2026-10-29.md'), '---\ndate: 2026-10-29\ntags: [code-review]\n---\n')

    expect(await ostraka('tag', 'list')).toEqual({ code: 0, stdout: '#billing\n#code-review\n#idea\n#ops\n', stderr: '' })
  })

  it('says when there are none', async () => {
    expect(await ostraka('tag', 'list')).toEqual({ code: 0, stdout: 'No Tags.\n', stderr: '' })
  })

  it('gives agents JSON with each Tag’s colour', async () => {
    await ostraka('todo', 'add', 'Renew the certificate #ops')
    const { stdout } = await ostraka('tag', 'list', '--json')
    expect(JSON.parse(stdout)).toEqual([{ name: 'ops', color: expect.any(String) }])
  })
})
