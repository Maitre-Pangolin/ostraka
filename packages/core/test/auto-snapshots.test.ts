import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startAutoSnapshots, type AutoSnapshots } from '../src/index.ts'

let contentRoot: string
let auto: AutoSnapshots | undefined

const MINUTE = 60_000
const HOUR = 60 * MINUTE

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
  it('commits an hour after the first change', async () => {
    await start()
    await edit()

    await wait(HOUR - 1)
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

  it('commits changes made while it was not running, an hour after it starts', async () => {
    await writeFile(join(contentRoot, 'todos.json'), '{"todos":[]}\n')
    await start()

    await wait(HOUR - 1)
    expect(commitCount()).toBe(0)
    await wait(1)
    expect(commitCount()).toBe(1)
  })

  it('commits everything changed during the hour as one Snapshot, however often it changed', async () => {
    await start()
    await edit()
    // A change every 5 minutes: later changes never push the hour back.
    for (let elapsed = 5 * MINUTE; elapsed < HOUR; elapsed += 5 * MINUTE) {
      await wait(5 * MINUTE)
      await edit()
    }
    expect(commitCount()).toBe(0)

    await wait(5 * MINUTE)
    expect(commitCount()).toBe(1)
    expect(git('status', '--porcelain')).toBe('')
  })

  it('starts the next hour at the first change after a Snapshot', async () => {
    await start()
    await edit()
    await wait(HOUR)
    expect(commitCount()).toBe(1)

    // Three quiet hours: nothing to commit.
    await wait(3 * HOUR)
    expect(commitCount()).toBe(1)

    await edit()
    await wait(HOUR - 1)
    expect(commitCount()).toBe(1)
    await wait(1)
    expect(commitCount()).toBe(2)
  })

  it('commits pending changes right away on stop, then schedules nothing more', async () => {
    await start()
    await edit()

    await auto!.stop()
    expect(commitCount()).toBe(1)

    await wait(2 * HOUR)
    expect(commitCount()).toBe(1)
  })

  it('makes no commit on stop, or when the hour is up, when the files did not change', async () => {
    await start()
    await edit()
    await wait(HOUR)

    auto!.changed()
    await wait(HOUR)
    await auto!.stop()

    expect(commitCount()).toBe(1)
  })

  it('reports a failed commit and keeps snapshotting afterwards', async () => {
    const errors: unknown[] = []
    auto = await startAutoSnapshots({ env: { OSTRAKA_HOME: contentRoot }, onError: (error) => errors.push(error) })
    const indexLock = join(contentRoot, '.git', 'index.lock')
    await writeFile(indexLock, '')
    await edit()
    await wait(HOUR)
    expect(errors).toEqual([expect.objectContaining({ message: expect.stringContaining('index.lock') })])

    await rm(indexLock)
    await edit()
    await wait(HOUR)
    expect(commitCount()).toBe(1)
  })
})
