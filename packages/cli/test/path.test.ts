import { mkdtemp, rm } from 'node:fs/promises'
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

describe('ostraka path', () => {
  it.each([
    ['todos', 'todos.json'],
    ['notes', 'notes'],
    ['devlogs', 'devlogs'],
    ['sketches', 'sketches'],
    ['people', 'people.json'],
  ])('prints where %s live', async (kind, location) => {
    expect(await ostraka('path', kind)).toEqual({ code: 0, stdout: `${join(contentRoot, location)}\n`, stderr: '' })
  })

  it('prints JSON with --json', async () => {
    const { code, stdout } = await ostraka('path', 'notes', '--json')
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ kind: 'notes', path: join(contentRoot, 'notes') })
  })

  it('rejects an unknown kind and lists the valid ones', async () => {
    const { code, stdout, stderr } = await ostraka('path', 'ideas')
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toMatch(/todos\|notes\|devlogs\|sketches\|people/)
  })

  it('rejects a missing kind', async () => {
    expect((await ostraka('path')).code).toBe(1)
  })
})

describe('ostraka', () => {
  it('rejects an unknown command', async () => {
    const { code, stderr } = await ostraka('frobnicate')
    expect(code).toBe(1)
    expect(stderr).toMatch(/Usage/)
  })
})
