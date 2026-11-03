import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run } from '../src/main.ts'

let contentRoot: string

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  await mkdir(join(contentRoot, 'notes'))
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

const noteFile = (id: string) => join(contentRoot, 'notes', `${id}.md`)

describe('ostraka note', () => {
  it('lists Notes, a broken one with its error', async () => {
    await writeFile(noteFile('plan'), '---\ntags: [work, idea]\n---\n# Release plan\n')
    await writeFile(noteFile('bad'), '# No header\n')
    const listed = await ostraka('note', 'list')
    expect(listed.code).toBe(0)
    expect(listed.stdout).toContain('plan  Release plan  #work #idea\n')
    expect(listed.stdout).toMatch(/bad  broken: No YAML header/)
  })

  it('writes Notes an agent wrote in the house style, header untouched, and says which changed', async () => {
    await writeFile(noteFile('agent'), '---\ntags:   [work]\n---\n\n* one\n* two\n')
    await writeFile(noteFile('clean'), '---\ntags: []\n---\n\n- one\n')
    expect(await ostraka('note', 'format')).toEqual({ code: 0, stdout: 'Formatted agent\n', stderr: '' })
    expect(await readFile(noteFile('agent'), 'utf8')).toBe('---\ntags:   [work]\n---\n\n- one\n- two\n')
    expect(await ostraka('note', 'format', 'agent')).toEqual({ code: 0, stdout: 'All in house style.\n', stderr: '' })
  })

  it('fails when a Note to format has a broken header, naming it', async () => {
    await writeFile(noteFile('bad'), '# No header\n')
    const result = await ostraka('note', 'format')
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/bad: No YAML header/)
  })
})
