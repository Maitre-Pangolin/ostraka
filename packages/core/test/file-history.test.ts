import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ContentPathError,
  fileAtSnapshot,
  fileHistory,
  restoreFile,
  snapshot,
  SnapshotNotFoundError,
  type ContentRootOptions,
} from '../src/index.ts'

let contentRoot: string
let options: ContentRootOptions

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  options = { env: { OSTRAKA_HOME: contentRoot } }
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
})

const git = (...args: string[]) => execFileSync('git', ['-C', contentRoot, ...args], { encoding: 'utf8' }).trim()

const write = async (path: string, text: string) => {
  await mkdir(join(contentRoot, path, '..'), { recursive: true })
  await writeFile(join(contentRoot, path), text)
}

// Each git process takes a few hundred ms to spawn under the test runner on macOS.
describe('fileHistory', { timeout: 30_000 }, () => {
  it("lists the Snapshots that changed one file, newest first, with each one's date and message", async () => {
    await write('notes/plan.md', '---\ntags: []\n---\n# Plan\n')
    await snapshot('first draft', options)
    await write('todos.json', '{"todos":[]}\n')
    await snapshot('todos only', options)
    await write('notes/plan.md', '---\ntags: []\n---\n# Plan\n\nMore.\n')
    await snapshot('Automatic snapshot', options)

    const history = await fileHistory('notes/plan.md', options)

    const commits = git('log', '--format=%H').split('\n')
    expect(history).toEqual([
      { commit: commits[0], message: 'Automatic snapshot', date: expect.any(String) },
      { commit: commits[2], message: 'first draft', date: expect.any(String) },
    ])
    expect(history[0]!.date).toBe(git('log', '-1', '--format=%aI', commits[0]!))
  })

  it('is empty before the first Snapshot, even when the content folder sits inside another repo', async () => {
    git('init', '--quiet')
    const nested = join(contentRoot, 'content')
    await mkdir(join(nested, 'notes'), { recursive: true })
    await writeFile(join(nested, 'notes', 'plan.md'), '---\ntags: []\n---\n')
    git('add', '--all')
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--message', 'outer repo')

    expect(await fileHistory('notes/plan.md', { env: { OSTRAKA_HOME: nested } })).toEqual([])
  })

  it('refuses a path that is not a content file', async () => {
    await write('todos.json', '{"todos":[]}\n')
    await snapshot('first', options)

    for (const path of ['.git/config', '../todos.json', 'notes/../todos.json', '/etc/passwd', 'notes', 'notes/plan.txt', '--all']) {
      await expect(fileHistory(path, options)).rejects.toThrow(ContentPathError)
    }
  })
})

describe('fileAtSnapshot', { timeout: 30_000 }, () => {
  it('reads a file exactly as one Snapshot held it', async () => {
    await write('notes/plan.md', '---\ntags: []\n---\n# Plan\r\n')
    const first = await snapshot('first', options)
    await write('notes/plan.md', '---\ntags: []\n---\n# Changed\n')
    await snapshot('second', options)

    expect(await fileAtSnapshot('notes/plan.md', first!.commit, options)).toBe('---\ntags: []\n---\n# Plan\r\n')
  })

  it('answers SnapshotNotFoundError for a Snapshot that does not hold the file, or no Snapshot at all', async () => {
    await write('todos.json', '{"todos":[]}\n')
    const first = await snapshot('first', options)

    for (const commit of [first!.commit, 'f'.repeat(40), 'HEAD', '--output=/tmp/x', `${first!.commit}:todos.json`]) {
      await expect(fileAtSnapshot('notes/plan.md', commit, options)).rejects.toThrow(SnapshotNotFoundError)
    }
  })
})

describe('restoreFile', { timeout: 30_000 }, () => {
  const V1 = '---\ntags: []\n---\n# Plan\n'
  const V2 = '---\ntags: []\n---\n# Plan\n\nSecond.\n'

  it('writes an old version as the current file and commits it as a new Snapshot, keeping every earlier one', async () => {
    await write('notes/plan.md', V1)
    const first = await snapshot('first', options)
    await write('notes/plan.md', V2)
    await write('todos.json', '{"todos":[]}\n')
    const second = await snapshot('second', options)
    const [, firstDate] = git('log', '-1', '--format=%H %aI', first!.commit).split(' ')

    const result = await restoreFile('notes/plan.md', first!.commit, options)

    expect(await readFile(join(contentRoot, 'notes/plan.md'), 'utf8')).toBe(V1)
    expect(await readFile(join(contentRoot, 'todos.json'), 'utf8')).toBe('{"todos":[]}\n')
    expect(git('log', '--format=%H %s').split('\n')).toEqual([
      `${git('rev-parse', 'HEAD')} restore: notes/plan.md as of ${firstDate!.slice(0, 10)} ${firstDate!.slice(11, 16)}`,
      `${second!.commit} second`,
      `${first!.commit} first`,
    ])
    expect(git('status', '--porcelain')).toBe('')
    expect(result).toEqual({
      restored: { commit: git('rev-parse', 'HEAD'), message: expect.stringMatching(/^restore: /), date: expect.any(String) },
      before: { commit: second!.commit, message: 'second', date: expect.any(String) },
    })
  })

  it('snapshots changes not yet in a Snapshot first, so restoring that Snapshot again undoes the restore', async () => {
    await write('notes/plan.md', V1)
    const first = await snapshot('first', options)
    await write('notes/plan.md', V2)

    const { before } = await restoreFile('notes/plan.md', first!.commit, options)
    expect(before?.message).toBe('Automatic snapshot')
    expect(await readFile(join(contentRoot, 'notes/plan.md'), 'utf8')).toBe(V1)

    const undone = await restoreFile('notes/plan.md', before!.commit, options)

    expect(await readFile(join(contentRoot, 'notes/plan.md'), 'utf8')).toBe(V2)
    expect(undone.before?.message).toMatch(/^restore: /)
    expect(git('log', '--format=%s').split('\n')).toEqual([
      expect.stringMatching(/^restore: /),
      expect.stringMatching(/^restore: /),
      'Automatic snapshot',
      'first',
    ])
  })

  it('makes no commit when the file is already as that Snapshot held it', async () => {
    await write('notes/plan.md', V1)
    const first = await snapshot('first', options)

    expect(await restoreFile('notes/plan.md', first!.commit, options)).toEqual({
      restored: undefined,
      before: { commit: first!.commit, message: 'first', date: expect.any(String) },
    })
    expect(git('log', '--format=%s')).toBe('first')
  })

  it('brings back a file deleted since', async () => {
    await write('notes/plan.md', V1)
    const first = await snapshot('first', options)
    await rm(join(contentRoot, 'notes/plan.md'))

    await restoreFile('notes/plan.md', first!.commit, options)

    expect(await readFile(join(contentRoot, 'notes/plan.md'), 'utf8')).toBe(V1)
  })

  it('refuses a Snapshot that does not hold the file, and changes nothing', async () => {
    await write('todos.json', '{"todos":[]}\n')
    const first = await snapshot('first', options)
    await write('todos.json', '{"todos":[1]}\n')

    await expect(restoreFile('notes/plan.md', first!.commit, options)).rejects.toThrow(SnapshotNotFoundError)
    expect(git('log', '--format=%s')).toBe('first')
  })
})
