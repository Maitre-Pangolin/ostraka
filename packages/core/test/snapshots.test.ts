import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { snapshot, type ContentRootOptions } from '../src/index.ts'

let contentRoot: string
let options: ContentRootOptions

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  options = { env: { OSTRAKA_HOME: contentRoot } }
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(contentRoot, { recursive: true, force: true })
})

const git = (...args: string[]) => execFileSync('git', ['-C', contentRoot, ...args], { encoding: 'utf8' }).trim()
const log = () => git('log', '--format=%s').split('\n')
const committedFiles = () => git('ls-tree', '-r', '--name-only', 'HEAD').split('\n')

// Each git process takes a few hundred ms to spawn under the test runner on macOS.
describe('snapshot', { timeout: 30_000 }, () => {
  it('initialises the content folder as its own git repo with no remote, then commits every file', async () => {
    await writeFile(join(contentRoot, 'todos.json'), '{"todos":[]}\n')

    const result = await snapshot('devlog: 2026-11-02', options)

    // `.git` relative to the folder itself: the repo's top level is the content folder.
    expect(git('rev-parse', '--git-dir')).toBe('.git')
    expect(git('remote')).toBe('')
    expect(log()).toEqual(['devlog: 2026-11-02'])
    expect(committedFiles()).toContain('todos.json')
    expect(result).toEqual({ commit: git('rev-parse', 'HEAD'), message: 'devlog: 2026-11-02' })
  })

  it('leaves out lock and temp files from a write in progress', async () => {
    await writeFile(join(contentRoot, 'todos.json'), '{"todos":[]}\n')
    await writeFile(join(contentRoot, 'todos.json.lock'), '{"pid":1}')
    await writeFile(join(contentRoot, 'todos.json.123.0a1b2c3d.tmp'), '{"todos":')

    await snapshot('first', options)

    expect(committedFiles()).toEqual(['todos.json'])
  })

  it('gets its own repo even when the content folder sits inside another repo', async () => {
    git('init', '--quiet')
    const nested = join(contentRoot, 'content')
    await mkdir(nested)
    await writeFile(join(nested, 'todos.json'), '{"todos":[]}\n')

    await snapshot('first', { env: { OSTRAKA_HOME: nested } })

    expect(execFileSync('git', ['-C', nested, 'rev-parse', '--git-dir'], { encoding: 'utf8' }).trim()).toBe('.git')
    expect(git('rev-list', '--all')).toBe('')
  })

  it('ignores git location variables inherited from a caller running inside another repo', async () => {
    const other = await mkdtemp(join(tmpdir(), 'ostraka-other-'))
    try {
      execFileSync('git', ['-C', other, 'init', '--quiet'])
      vi.stubEnv('GIT_DIR', join(other, '.git'))
      vi.stubEnv('GIT_WORK_TREE', other)
      await writeFile(join(contentRoot, 'todos.json'), '{"todos":[]}\n')

      await snapshot('first', options)

      vi.unstubAllEnvs()
      expect(log()).toEqual(['first'])
      expect(execFileSync('git', ['-C', other, 'rev-list', '--all'], { encoding: 'utf8' })).toBe('')
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })

  it('commits on a machine with no git identity and commit signing turned on', async () => {
    vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null')
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
    vi.stubEnv('GIT_CONFIG_COUNT', '3')
    vi.stubEnv('GIT_CONFIG_KEY_0', 'user.useConfigOnly')
    vi.stubEnv('GIT_CONFIG_VALUE_0', 'true')
    vi.stubEnv('GIT_CONFIG_KEY_1', 'commit.gpgSign')
    vi.stubEnv('GIT_CONFIG_VALUE_1', 'true')
    vi.stubEnv('GIT_CONFIG_KEY_2', 'gpg.program')
    vi.stubEnv('GIT_CONFIG_VALUE_2', 'false')
    await writeFile(join(contentRoot, 'todos.json'), '{"todos":[]}\n')

    await snapshot('first', options)

    vi.unstubAllEnvs()
    expect(git('log', '--format=%an <%ae> %s')).toBe('Ostraka <ostraka@localhost> first')
  })

  it('makes no commit when nothing changed since the last Snapshot', async () => {
    await writeFile(join(contentRoot, 'todos.json'), '{"todos":[]}\n')
    await snapshot('first', options)

    expect(await snapshot('second', options)).toBeUndefined()
    expect(log()).toEqual(['first'])
  })

  it('serialises Snapshots started at the same time: one commits, the others find nothing left', async () => {
    await writeFile(join(contentRoot, 'todos.json'), '{"todos":[]}\n')

    const results = await Promise.all(['a', 'b', 'c', 'd'].map((message) => snapshot(message, options)))

    expect(results).toEqual([{ commit: git('rev-parse', 'HEAD'), message: 'a' }, undefined, undefined, undefined])
    expect(log()).toEqual(['a'])
  })

  it('keeps the message exactly as given, without running git hooks', async () => {
    git('init', '--quiet')
    const hooks = join(contentRoot, '.git', 'hooks')
    await mkdir(hooks, { recursive: true })
    await writeFile(join(hooks, 'prepare-commit-msg'), '#!/bin/sh\necho "rewritten by a hook" > "$1"\n', { mode: 0o755 })
    git('config', 'core.hooksPath', hooks)
    await writeFile(join(contentRoot, 'todos.json'), '{"todos":[]}\n')

    await snapshot('people: fill 2 stubs', options)

    expect(log()).toEqual(['people: fill 2 stubs'])
  })

  it('makes no commit in an empty content folder', async () => {
    expect(await snapshot('nothing yet', options)).toBeUndefined()
    expect(git('rev-list', '--all')).toBe('')
  })
})
