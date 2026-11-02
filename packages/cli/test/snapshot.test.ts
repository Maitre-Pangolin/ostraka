import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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

const git = (...args: string[]) => execFileSync('git', ['-C', contentRoot, ...args], { encoding: 'utf8' }).trim()

// Each git process takes a few hundred ms to spawn under the test runner on macOS.
describe('ostraka snapshot', { timeout: 30_000 }, () => {
  it('commits the content folder now with the given message', async () => {
    await writeFile(join(contentRoot, 'todos.json'), '{"todos":[]}\n')

    const result = await ostraka('snapshot', 'devlog: 2026-11-02')

    const commit = git('rev-parse', 'HEAD')
    expect(result).toEqual({ code: 0, stdout: `Snapshot ${commit.slice(0, 7)}  devlog: 2026-11-02\n`, stderr: '' })
    expect(git('log', '--format=%s')).toBe('devlog: 2026-11-02')
  })

  it('says so when nothing changed', async () => {
    expect(await ostraka('snapshot', 'nothing')).toEqual({ code: 0, stdout: 'Nothing changed since the last Snapshot.\n', stderr: '' })
  })

  it('prints JSON with --json', async () => {
    await writeFile(join(contentRoot, 'todos.json'), '{"todos":[]}\n')

    const made = JSON.parse((await ostraka('snapshot', 'people: fill 2 stubs', '--json')).stdout)
    expect(made).toEqual({ commit: git('rev-parse', 'HEAD'), message: 'people: fill 2 stubs' })

    expect(JSON.parse((await ostraka('snapshot', 'again', '--json')).stdout)).toBeNull()
  })

  it.each([[['snapshot']], [['snapshot', '']], [['snapshot', 'a', 'b']]])('shows usage for %j', async (argv) => {
    const { code, stderr } = await ostraka(...argv)
    expect(code).toBe(1)
    expect(stderr).toMatch(/ostraka snapshot "<message>"/)
  })
})
