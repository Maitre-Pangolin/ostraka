import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startServer } from '../src/index.ts'
import { fakeKeychain } from './fake-keychain.ts'

let contentRoot: string

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
})

const start = () =>
  startServer({ port: 0, webDist: '/nonexistent', keychain: fakeKeychain({}).keychain, env: { OSTRAKA_HOME: contentRoot } })
const git = (...args: string[]) => execFileSync('git', ['-C', contentRoot, ...args], { encoding: 'utf8' }).trim()

// Each git process takes a few hundred ms to spawn under the test runner on macOS.
describe('startServer', { timeout: 30_000 }, () => {
  it('listens on the loopback interface only', async () => {
    const { server, stop } = await start()
    try {
      expect((server.address() as AddressInfo).address).toBe('127.0.0.1')
    } finally {
      await stop()
    }
  })

  it('makes the content folder a git repo and commits pending changes when it stops', async () => {
    const { stop } = await start()
    expect(git('rev-parse', '--git-dir')).toBe('.git')
    await writeFile(join(contentRoot, 'todos.json'), '{"todos":[]}\n')

    await stop()

    expect(git('log', '--format=%s')).toBe('Automatic snapshot')
  })
})
