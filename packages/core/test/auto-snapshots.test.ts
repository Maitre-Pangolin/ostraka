import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startAutoSnapshots, type AutoSnapshots } from '../src/index.ts'

let contentRoot: string
let auto: AutoSnapshots | undefined

const SECOND = 1000
const MINUTE = 60 * SECOND

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
})

afterEach(async () => {
  await auto?.stop()
  auto = undefined
  vi.useRealTimers()
  await rm(contentRoot, { recursive: true, force: true })
})

const start = async () => (auto = await startAutoSnapshots({ env: { OSTRAKA_HOME: contentRoot } }))
const git = (...args: string[]) => execFileSync('git', ['-C', contentRoot, ...args], { encoding: 'utf8' }).trim()
const commitCount = () => Number(git('rev-list', '--count', '--all'))

/** Moves the fake clock on, then waits for any Snapshot it triggered to finish. */
async function wait(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
  await auto!.idle()
}

let edits = 0
async function edit() {
  await writeFile(join(contentRoot, 'todos.json'), `{"todos":[],"edit":${++edits}}\n`)
  auto!.changed()
}

// Each git process takes a few hundred ms to spawn under the test runner on macOS.
describe('startAutoSnapshots', { timeout: 60_000 }, () => {
  it('commits once the content has been quiet for 60 s', async () => {
    await start()
    await edit()

    await wait(60 * SECOND - 1)
    expect(commitCount()).toBe(0)

    await wait(1)
    expect(commitCount()).toBe(1)
    expect(git('log', '--format=%s')).toBe('Automatic snapshot')
  })

  it('makes the content folder a git repo when it starts', async () => {
    await start()
    expect(git('rev-parse', '--git-dir')).toBe('.git')
    expect(commitCount()).toBe(0)
  })

  it('commits changes made while it was not running, once the content has been quiet for 60 s', async () => {
    await writeFile(join(contentRoot, 'todos.json'), '{"todos":[]}\n')
    await start()

    await wait(60 * SECOND)
    expect(commitCount()).toBe(1)
  })

  it('commits pending changes right away on stop, then schedules nothing more', async () => {
    await start()
    await edit()

    await auto!.stop()
    expect(commitCount()).toBe(1)

    await wait(10 * MINUTE)
    expect(commitCount()).toBe(1)
  })

  it('makes no commit on stop, or after a quiet period, when the files did not change', async () => {
    await start()
    await edit()
    await wait(60 * SECOND)

    auto!.changed()
    await wait(60 * SECOND)
    await auto!.stop()

    expect(commitCount()).toBe(1)
  })

  it('reports a failed commit and keeps snapshotting afterwards', async () => {
    const errors: unknown[] = []
    auto = await startAutoSnapshots({ env: { OSTRAKA_HOME: contentRoot }, onError: (error) => errors.push(error) })
    const indexLock = join(contentRoot, '.git', 'index.lock')
    await writeFile(indexLock, '')
    await edit()
    await wait(60 * SECOND)
    expect(errors).toEqual([expect.objectContaining({ message: expect.stringContaining('index.lock') })])

    await rm(indexLock)
    await edit()
    await wait(60 * SECOND)
    expect(commitCount()).toBe(1)
  })

  it('waits for a fresh 60 s of quiet after each change', async () => {
    await start()
    await edit()
    await wait(45 * SECOND)
    await edit()

    await wait(45 * SECOND)
    expect(commitCount()).toBe(0)

    await wait(15 * SECOND)
    expect(commitCount()).toBe(1)
  })

  it('commits at most once every 10 minutes while changes keep coming', async () => {
    await start()
    const commitTimes: number[] = []
    let commits = 0
    // A change every 50 s: never 60 s of quiet.
    for (let elapsed = 50 * SECOND; elapsed <= 25 * MINUTE; elapsed += 50 * SECOND) {
      await edit()
      await wait(50 * SECOND)
      const count = commitCount()
      if (count > commits) commitTimes.push(elapsed)
      commits = count
    }

    expect(commitTimes).toEqual([10 * MINUTE, 20 * MINUTE])
  })
})
