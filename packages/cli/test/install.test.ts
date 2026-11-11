import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run, type System } from '../src/main.ts'

const REPO = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '')
const LABEL = 'com.ostraka.server'
const UID = 501

let home: string
let launchctl: string[][]
let runs: { command: string; args: string[]; cwd: string }[]

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ostraka-install-'))
  launchctl = []
  runs = []
})

async function cloneByLinks(dest: string) {
  await mkdir(dest)
  for (const entry of await readdir(REPO)) if (entry !== '.git') await symlink(join(REPO, entry), join(dest, entry))
}

/** The installed copy, under the temp home. */
const appPath = () => join(home, 'Library', 'Application Support', 'ostraka', 'app')

/**
 * git and pnpm are faked: `git clone` makes a folder whose entries link into this repo, so the installed copy runs
 * this repo's real code (the shim test runs it), and the rest succeed unless `fail` names the pnpm script that breaks.
 */
const fakeRun =
  (fail?: string): System['run'] =>
  async (command, args, { cwd }) => {
    runs.push({ command, args, cwd })
    if (command === 'pnpm' && args[0] === fail) return { code: 1, stdout: '', stderr: `${fail} broke` }
    if (command === 'git' && args[0] === 'clone') await cloneByLinks(args.at(-1)!)
    if (command === 'git' && args[0] === 'log') return { code: 0, stdout: 'abc1234 Latest change\n', stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

/** Everything `install` touches outside the temp home is faked: launchctl records calls, nothing is loaded. */
function fakeSystem(overrides: Partial<System> = {}): System {
  return {
    platform: 'darwin',
    nodePath: process.execPath,
    nodeVersion: '24.11.0',
    uid: UID,
    launchctl: async (args) => (launchctl.push(args), { code: args[0] === 'bootout' ? 3 : 0, stderr: '' }),
    run: fakeRun(),
    ...overrides,
  }
}

async function ostraka(argv: string[], { env = {}, system = fakeSystem() }: { env?: Record<string, string>; system?: System } = {}) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, {
    env,
    homeDir: home,
    system,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  })
  return { code, stdout, stderr }
}

const plistPath = () => join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`)
const shimPath = () => join(home, '.local', 'bin', 'ostraka')

describe('ostraka install', () => {
  it('writes a LaunchAgent that serves at login, restarts after a crash and logs to ~/Library/Logs/ostraka', async () => {
    expect((await ostraka(['install'])).code).toBe(0)
    const plist = await readFile(plistPath(), 'utf8')
    expect(plist).toContain(`<key>Label</key>\n  <string>${LABEL}</string>`)
    expect(plist).toMatch(
      new RegExp(
        `<key>ProgramArguments</key>\\s*<array>\\s*<string>${process.execPath}</string>\\s*<string>${appPath()}/packages/cli/bin/ostraka.ts</string>\\s*<string>serve</string>\\s*</array>`,
      ),
    )
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/)
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>\s*<\/dict>/)
    expect(plist).toContain(`<string>${join(home, 'Library', 'Logs', 'ostraka', 'server.log')}</string>`)
    expect((await stat(join(home, 'Library', 'Logs', 'ostraka'))).isDirectory()).toBe(true)
  })

  it('keeps the environment, and so any secret in it, out of the LaunchAgent', async () => {
    await ostraka(['install'], { env: { PATH: '/usr/bin', GITLAB_TOKEN: 'glpat-FAKEenvTOKEN' } })
    expect(await readFile(plistPath(), 'utf8')).not.toContain('glpat-FAKEenvTOKEN')
  })

  it('loads the LaunchAgent in the user session, replacing a running one', async () => {
    await ostraka(['install'])
    expect(launchctl).toEqual([
      ['bootout', `gui/${UID}/${LABEL}`],
      ['bootstrap', `gui/${UID}`, plistPath()],
    ])
  })

  it('writes an executable shim with absolute paths to node and the installed copy', async () => {
    await ostraka(['install'])
    expect((await stat(shimPath())).mode & 0o111).toBe(0o111)
    const shim = await readFile(shimPath(), 'utf8')
    expect(shim).toContain(`'${process.execPath}' '${appPath()}/packages/cli/bin/ostraka.ts' "$@"`)
  })

  it('writes a shim that runs ostraka with no PATH at all', async () => {
    await ostraka(['install'])
    const { stdout } = await promisify(execFile)(shimPath(), ['path', 'todos'], { env: { OSTRAKA_HOME: '/content' } })
    expect(stdout).toBe('/content/todos.json\n')
  })

  it('can run twice', async () => {
    await ostraka(['install'])
    expect((await ostraka(['install'])).code).toBe(0)
  })

  it('says where it wrote things and how to add ~/.local/bin to PATH when it is missing', async () => {
    const { stdout } = await ostraka(['install'], { env: { PATH: '/usr/bin:/bin' } })
    expect(stdout).toContain(plistPath())
    expect(stdout).toContain(shimPath())
    expect(stdout).toMatch(/not on your PATH/)
  })

  it('stays quiet about PATH when ~/.local/bin is on it', async () => {
    const { stdout } = await ostraka(['install'], { env: { PATH: `/usr/bin:${join(home, '.local', 'bin')}` } })
    expect(stdout).not.toMatch(/PATH/)
  })

  it('links each of the installed copy’s skills into ~/.claude/skills, where Claude Code and Cursor both find them', async () => {
    const { stdout } = await ostraka(['install'])
    const skill = join(home, '.claude', 'skills', 'devlog')
    expect((await lstat(skill)).isSymbolicLink()).toBe(true)
    expect(await readlink(skill)).toBe(`${appPath()}/.claude/skills/devlog`)
    expect(stdout).toContain(skill)
  })

  it('replaces a link left by an earlier install', async () => {
    const skill = join(home, '.claude', 'skills', 'devlog')
    await mkdir(dirname(skill), { recursive: true })
    await symlink('/moved/repo/.claude/skills/devlog', skill)
    expect((await ostraka(['install'])).code).toBe(0)
    expect(await readlink(skill)).toBe(`${appPath()}/.claude/skills/devlog`)
  })

  it('leaves a skill of the same name that it did not install alone, and says so', async () => {
    const skill = join(home, '.claude', 'skills', 'devlog')
    await mkdir(skill, { recursive: true })
    await writeFile(join(skill, 'SKILL.md'), 'mine')
    const { code, stdout } = await ostraka(['install'])
    expect(code).toBe(0)
    expect(await readFile(join(skill, 'SKILL.md'), 'utf8')).toBe('mine')
    expect(stdout).toMatch(new RegExp(`${skill} .*not a link`))
  })

  it('points out the old Cursor /devlog command, which the devlog skill replaces', async () => {
    const command = join(home, '.cursor', 'commands', 'devlog.md')
    expect((await ostraka(['install'])).stdout).not.toContain(command)
    await mkdir(dirname(command), { recursive: true })
    await writeFile(command, 'old')
    const { stdout } = await ostraka(['install'])
    expect(stdout).toMatch(new RegExp(`${command}.*replaces`))
    expect(await readFile(command, 'utf8')).toBe('old')
  })

  it('points to the global People instruction for ~/.claude/CLAUDE.md and Cursor User Rules, writing neither', async () => {
    const instruction = `${appPath()}/.claude/skills/people/global-instruction.md`
    const { stdout } = await ostraka(['install'])
    expect(stdout).toMatch(new RegExp(`${instruction}.*~/\\.claude/CLAUDE\\.md.*Cursor.*User Rules`))
    await expect(stat(join(home, '.claude', 'CLAUDE.md'))).rejects.toThrow(/ENOENT/)
    expect(await readFile(instruction, 'utf8')).toContain('ostraka people find')
  })

  it('shows the global People instruction in the README exactly as the file holds it', async () => {
    const instruction = await readFile(`${REPO}/.claude/skills/people/global-instruction.md`, 'utf8')
    expect(await readFile(`${REPO}/README.md`, 'utf8')).toContain(`\`\`\`markdown\n${instruction}\`\`\``)
  })

  it('stays quiet about the global People instruction once ~/.claude/CLAUDE.md has it', async () => {
    await mkdir(join(home, '.claude'), { recursive: true })
    await writeFile(
      join(home, '.claude', 'CLAUDE.md'),
      '# Mine\n\nBefore looking up a colleague, run `ostraka people find <name or email>`.\n',
    )
    expect((await ostraka(['install'])).stdout).not.toContain('global-instruction.md')
  })

  it('reports a LaunchAgent that would not load', async () => {
    const system = fakeSystem({ launchctl: async (args) => ({ code: args[0] === 'bootstrap' ? 5 : 0, stderr: 'Input/output error' }) })
    const { code, stderr } = await ostraka(['install'], { system })
    expect(code).toBe(1)
    expect(stderr).toMatch(/launchctl bootstrap.*Input\/output error/s)
  })

  it('refuses to run outside macOS', async () => {
    const { code, stderr } = await ostraka(['install'], { system: fakeSystem({ platform: 'linux' }) })
    expect(code).toBe(1)
    expect(stderr).toMatch(/macOS/)
    expect(launchctl).toEqual([])
  })

  it('builds and tests the copy beside the installed one, from main, then swaps it in', async () => {
    expect((await ostraka(['install'])).code).toBe(0)
    const next = `${appPath()}.next`
    expect(runs.map(({ command, args }) => [command, ...args])).toEqual([
      ['git', 'clone', '--quiet', '--branch', 'main', REPO, next],
      ['git', 'log', '-1', '--format=%h %s'],
      ['pnpm', 'install', '--frozen-lockfile'],
      ['pnpm', 'build'],
      ['pnpm', 'test'],
    ])
    expect(runs.slice(1).every(({ cwd }) => cwd === next)).toBe(true)
    expect((await lstat(appPath())).isDirectory()).toBe(true)
    await expect(lstat(next)).rejects.toThrow(/ENOENT/)
  })

  it('installs another branch with --ref, and skips the tests with --skip-tests', async () => {
    const { stdout } = await ostraka(['install', '--ref', 'integration/28-ostraka-v1', '--skip-tests'])
    expect(runs[0]?.args).toContain('integration/28-ostraka-v1')
    expect(runs.some(({ args }) => args[0] === 'test')).toBe(false)
    expect(stdout).toContain('integration/28-ostraka-v1 at abc1234 Latest change')
  })

  it('keeps the previous copy as app.prev', async () => {
    await ostraka(['install'])
    await ostraka(['install'])
    expect((await lstat(`${appPath()}.prev`)).isDirectory()).toBe(true)
  })

  it('leaves the installed copy and the running app alone when a step fails', async () => {
    await ostraka(['install'])
    launchctl = []
    const before = await readFile(plistPath(), 'utf8')
    const { code, stderr } = await ostraka(['install'], { system: fakeSystem({ run: fakeRun('build') }) })
    expect(code).toBe(1)
    expect(stderr).toMatch(/pnpm build failed.*unchanged.*build broke/s)
    expect(await readFile(plistPath(), 'utf8')).toBe(before)
    await expect(lstat(`${appPath()}.next`)).rejects.toThrow(/ENOENT/)
    await expect(lstat(`${appPath()}.prev`)).rejects.toThrow(/ENOENT/)
    expect(launchctl).toEqual([])
  })

  it('refuses a Node older than 24, which cannot run the TypeScript sources', async () => {
    const { code, stderr } = await ostraka(['install'], { system: fakeSystem({ nodeVersion: '20.18.0' }) })
    expect(code).toBe(1)
    expect(stderr).toMatch(/Node 20\.18\.0.*24 or newer/s)
    expect(runs).toEqual([])
  })
})

describe('ostraka update', () => {
  it('asks for install first', async () => {
    const { code, stderr } = await ostraka(['update'])
    expect(code).toBe(1)
    expect(stderr).toContain('ostraka install')
    expect(runs).toEqual([])
  })

  it('rebuilds the copy and restarts the app', async () => {
    await ostraka(['install'])
    runs = []
    launchctl = []
    const { code, stdout } = await ostraka(['update'])
    expect(code).toBe(0)
    expect(runs.map(({ args }) => args[0])).toEqual(['clone', 'log', 'install', 'build', 'test'])
    expect(launchctl).toEqual([
      ['bootout', `gui/${UID}/${LABEL}`],
      ['bootstrap', `gui/${UID}`, plistPath()],
    ])
    expect(stdout).toMatch(/Updated .* to main at abc1234/)
  })
})
