import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run, type System } from '../src/main.ts'

const LABEL = 'com.ostraka.server'
const UID = 501
const SERVICE = `gui/${UID}/${LABEL}`

let home: string
let calls: string[][]

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ostraka-service-'))
  calls = []
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

const plistPath = () => join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`)

async function installed(node = process.execPath) {
  await mkdir(join(home, 'Library', 'LaunchAgents'), { recursive: true })
  await writeFile(
    plistPath(),
    `<plist><dict><key>ProgramArguments</key>\n  <array>\n    <string>${node}</string>\n  </array></dict></plist>`,
  )
}

/** What `launchctl print` shows for the service: not loaded, loaded and stopped, or running with a pid. */
type Launchd = 'unloaded' | 'stopped' | { pid: number }

/** A fake launchd: records every call and answers `print` from the state, which `after` may change per call. */
function fakeSystem(state: Launchd, after: (args: string[]) => Launchd | void = () => {}): System {
  let current = state
  return {
    platform: 'darwin',
    nodePath: process.execPath,
    nodeVersion: '24.11.0',
    uid: UID,
    run: async (command, args) =>
      command === 'git' && args[0] === 'log'
        ? { code: 0, stdout: 'abc1234 Latest change\n', stderr: '' }
        : { code: 0, stdout: '', stderr: '' },
    launchctl: async (args) => {
      calls.push(args)
      if (args[0] === 'print') {
        if (current === 'unloaded') return { code: 113, stdout: '', stderr: `Could not find service "${LABEL}"` }
        const pid = current === 'stopped' ? '' : `\tpid = ${current.pid}\n`
        return { code: 0, stdout: `${SERVICE} = {\n\tstate = ${current === 'stopped' ? 'not running' : 'running'}\n${pid}}\n`, stderr: '' }
      }
      current = after(args) ?? current
      return { code: 0, stdout: '', stderr: '' }
    },
  }
}

const down = async () => {
  throw new TypeError('fetch failed')
}
const healthy = async () => new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })

async function ostraka(argv: string[], system: System, fetch: typeof down | typeof healthy = down) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, {
    env: {},
    homeDir: home,
    system,
    fetch,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  })
  return { code, stdout, stderr }
}

const actions = () => calls.filter((args) => args[0] !== 'print')

describe('ostraka start', () => {
  it('loads the LaunchAgent when it is not loaded, which starts it', async () => {
    await installed()
    const { code, stdout } = await ostraka(['start'], fakeSystem('unloaded'))
    expect(code).toBe(0)
    expect(actions()).toEqual([['bootstrap', `gui/${UID}`, plistPath()]])
    expect(stdout).toContain('http://127.0.0.1:4747')
  })

  it('starts a loaded but stopped LaunchAgent', async () => {
    await installed()
    expect((await ostraka(['start'], fakeSystem('stopped'))).code).toBe(0)
    expect(actions()).toEqual([['kickstart', SERVICE]])
  })

  it('leaves a running app alone', async () => {
    await installed()
    const { code, stdout } = await ostraka(['start'], fakeSystem({ pid: 4242 }))
    expect(code).toBe(0)
    expect(actions()).toEqual([])
    expect(stdout).toMatch(/already running.*4242/)
  })

  it('asks for `ostraka install` when there is no LaunchAgent', async () => {
    const { code, stderr } = await ostraka(['start'], fakeSystem('unloaded'))
    expect(code).toBe(1)
    expect(stderr).toContain('ostraka install')
    expect(calls).toEqual([])
  })
})

describe('ostraka stop', () => {
  it('sends SIGTERM, so pending changes become a Snapshot, and waits until it has stopped', async () => {
    await installed()
    const system = fakeSystem({ pid: 4242 }, (args) => (args[0] === 'kill' ? 'stopped' : undefined))
    const { code, stdout } = await ostraka(['stop'], system)
    expect(code).toBe(0)
    expect(actions()).toEqual([['kill', 'SIGTERM', SERVICE]])
    expect(stdout).toMatch(/Stopped/)
  })

  it('does nothing when the app is not running', async () => {
    await installed()
    const { code, stdout } = await ostraka(['stop'], fakeSystem('stopped'))
    expect(code).toBe(0)
    expect(actions()).toEqual([])
    expect(stdout).toMatch(/isn't running/)
  })
})

describe('ostraka restart', () => {
  it('restarts a loaded LaunchAgent (launchd stops it with SIGTERM first)', async () => {
    await installed()
    expect((await ostraka(['restart'], fakeSystem({ pid: 4242 }))).code).toBe(0)
    expect(actions()).toEqual([['kickstart', '-k', SERVICE]])
  })

  it('loads it when it is not loaded', async () => {
    await installed()
    expect((await ostraka(['restart'], fakeSystem('unloaded'))).code).toBe(0)
    expect(actions()).toEqual([['bootstrap', `gui/${UID}`, plistPath()]])
  })
})

describe('ostraka status', () => {
  it('says the app runs in the background, with its pid', async () => {
    await installed()
    const { code, stdout } = await ostraka(['status'], fakeSystem({ pid: 4242 }), healthy)
    expect(code).toBe(0)
    expect(stdout).toMatch(/Running in the background \(pid 4242\)/)
    expect(stdout).toContain('http://127.0.0.1:4747')
  })

  it('says a stopped app starts again at login or with `ostraka start`, and exits 1', async () => {
    await installed()
    const { code, stdout } = await ostraka(['status'], fakeSystem('stopped'))
    expect(code).toBe(1)
    expect(stdout).toMatch(/Stopped/)
    expect(stdout).toContain('ostraka start')
  })

  it('notices an app answering from a terminal when the LaunchAgent is not running', async () => {
    await installed()
    const { code, stdout } = await ostraka(['status'], fakeSystem('stopped'), healthy)
    expect(code).toBe(0)
    expect(stdout).toMatch(/ostraka serve/)
  })

  it('says which copy is installed', async () => {
    await installed()
    const { stdout } = await ostraka(['status'], fakeSystem({ pid: 4242 }), healthy)
    expect(stdout).toContain('at abc1234 Latest change')
    expect(stdout).not.toMatch(/no longer exists/)
  })

  it('warns when the node binary the LaunchAgent runs has gone', async () => {
    await installed('/nowhere/node')
    const { stdout } = await ostraka(['status'], fakeSystem('stopped'))
    expect(stdout).toMatch(/\/nowhere\/node, which no longer exists.*ostraka update/)
  })

  it('says when it is not installed', async () => {
    const { code, stdout } = await ostraka(['status'], fakeSystem('unloaded'))
    expect(code).toBe(1)
    expect(stdout).toContain('ostraka install')
  })
})

it('only runs on macOS', async () => {
  await installed()
  const { code, stderr } = await ostraka(['start'], { ...fakeSystem('unloaded'), platform: 'linux' })
  expect(code).toBe(1)
  expect(stderr).toMatch(/macOS/)
  expect(calls).toEqual([])
})
