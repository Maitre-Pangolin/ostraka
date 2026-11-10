import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupState, loadConfig, snapshot } from '@ostraka/core'
import { macKeychain } from '@ostraka/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startHttpRemote } from '../../../packages/core/test/http-remote.ts'
import { run, type Io } from '../src/main.ts'

// Nothing in the CLI reads the Keychain: the CLI calling it at all fails the test that catches it.
vi.mock('@ostraka/server', async (original) => ({
  ...(await original<typeof import('@ostraka/server')>()),
  macKeychain: vi.fn<typeof import('@ostraka/server').macKeychain>(() => {
    throw new Error('The CLI read the Keychain')
  }),
}))

let dir: string
let home: string
let content: string
let remote: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ostraka-cli-backup-'))
  home = join(dir, 'home')
  content = join(dir, 'content')
  remote = join(dir, 'remote.git')
  await mkdir(home)
  execFileSync('git', ['init', '--quiet', '--bare', remote])
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(dir, { recursive: true, force: true })
})

const USER_TOKEN = `test-user-token-${'z'.repeat(12)}`

/** No server is running: `ostraka backup` must not need one. Each call is recorded. */
const serverCalls: string[] = []
const serverDown: Io['fetch'] = (url) => {
  serverCalls.push(String(url))
  return Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }))
}

async function ostraka(argv: string[], io: Partial<Io> = {}) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, {
    env: { OSTRAKA_HOME: content },
    homeDir: home,
    fetch: serverDown,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    ...io,
  })
  return { code, stdout, stderr }
}
const backup = (...args: string[]) => ostraka(['backup', ...args])

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
const head = () => git(content, 'rev-parse', 'HEAD')
const branch = () => git(content, 'symbolic-ref', '--short', 'HEAD')
const remoteHead = () => git(remote, 'for-each-ref', '--format=%(objectname)')

async function contentWithRemote() {
  await mkdir(content, { recursive: true })
  await writeFile(join(content, 'todos.json'), '{"todos":[]}\n')
  await snapshot('first', { env: { OSTRAKA_HOME: content } })
  git(content, 'remote', 'add', 'origin', remote)
}

/** The user's own credential helper, as their git config would set it; prompts off so a missing one fails at once. */
function userCredentialHelper(token: string) {
  vi.stubEnv('GIT_TERMINAL_PROMPT', '0')
  vi.stubEnv('GIT_CONFIG_COUNT', '2')
  vi.stubEnv('GIT_CONFIG_KEY_0', 'credential.helper')
  vi.stubEnv('GIT_CONFIG_VALUE_0', '')
  vi.stubEnv('GIT_CONFIG_KEY_1', 'credential.helper')
  vi.stubEnv('GIT_CONFIG_VALUE_1', `!f() { test "$1" = get && printf "username=oauth2\\npassword=${token}\\n"; }; f`)
}

// Each git process takes a few hundred ms to spawn under the test runner on macOS.
describe('ostraka backup', { timeout: 60_000 }, () => {
  it('pushes the branch itself, with no server running and without asking one', async () => {
    await contentWithRemote()
    serverCalls.length = 0

    const result = await backup()

    expect(result).toEqual({ code: 0, stdout: `Backed up ${head().slice(0, 7)} to origin.\n`, stderr: '' })
    expect(remoteHead()).toBe(head())
    expect(serverCalls).toEqual([])
    // The app's warning, read offline, now sees it backed up.
    expect(await backupState({ env: { OSTRAKA_HOME: content } })).toMatchObject({ backedUp: true })
  })

  it('says when there was nothing new', async () => {
    await contentWithRemote()
    await backup()
    expect(await backup()).toEqual({ code: 0, stdout: `Already backed up (${head().slice(0, 7)}).\n`, stderr: '' })
  })

  it("signs in with git's own credentials (the user's credential helper)", async () => {
    const server = await startHttpRemote(dir, USER_TOKEN)
    try {
      await contentWithRemote()
      git(content, 'remote', 'set-url', 'origin', `${server.url}/remote.git`)
      userCredentialHelper(USER_TOKEN)

      expect(await backup()).toMatchObject({ code: 0, stderr: '' })
      expect(remoteHead()).toBe(head())
      expect(server.authorizations).toContain(`Basic ${Buffer.from(`oauth2:${USER_TOKEN}`).toString('base64')}`)
    } finally {
      await server.close()
    }
  })

  it('names the files holding a secret, never the secret, and pushes nothing', async () => {
    await contentWithRemote()
    await mkdir(join(content, 'notes'))
    const token = ['xoxb', '1234567890', 'abcdefghij'].join('-')
    await writeFile(join(content, 'notes', 'setup.md'), `---\ntags: []\n---\n${token}\n`)
    await snapshot('setup', { env: { OSTRAKA_HOME: content } })

    const result = await backup()

    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/Backup blocked: nothing was pushed/)
    expect(result.stderr).toContain('notes/setup.md (Slack token)')
    expect(result.stderr + result.stdout).not.toContain(token)
    expect(remoteHead()).toBe('')
  })

  it("shows git's reason for a rejected push and how to bring the remote's commits in, never forcing or merging", async () => {
    await contentWithRemote()
    const other = join(dir, 'other')
    execFileSync('git', ['clone', '--quiet', remote, other])
    await writeFile(join(other, 'x.md'), 'other\n')
    git(other, 'add', 'x.md')
    git(other, '-c', 'user.name=O', '-c', 'user.email=o@localhost', 'commit', '--quiet', '-m', 'other')
    git(other, 'push', '--quiet', 'origin', `HEAD:${branch()}`)
    const theirs = remoteHead()
    const mine = head()

    const result = await backup()

    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/^Push rejected/)
    expect(result.stderr).toContain(`git -C ${content} pull --rebase`)
    expect(result.stderr).toMatch(/never merges or force-pushes/)
    expect(remoteHead()).toBe(theirs)
    expect(head()).toBe(mine)
  })

  it('explains how to add the remote when there is none', async () => {
    await mkdir(content)
    await writeFile(join(content, 'todos.json'), '{"todos":[]}\n')
    await snapshot('first', { env: { OSTRAKA_HOME: content } })

    const result = await backup()

    expect(result.code).toBe(1)
    expect(result.stderr).toContain(`git -C ${content} remote add origin <url>`)
  })

  it("says why when git can't reach the remote", async () => {
    await contentWithRemote()
    git(content, 'remote', 'set-url', 'origin', join(dir, 'missing.git'))

    const result = await backup()

    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/^Backup failed: .*missing\.git/)
  })

  it('warns about content files over 10 MB', async () => {
    await contentWithRemote()
    await writeFile(join(content, 'big.png'), Buffer.alloc(11 * 1024 * 1024))
    await snapshot('image', { env: { OSTRAKA_HOME: content } })

    const result = await backup()

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('Warning: big.png is 11.0 MB; keep content files under 10 MB.\n')
  })

  it('prints the result as JSON for agents', async () => {
    await contentWithRemote()
    const result = await backup('--json')
    expect(JSON.parse(result.stdout)).toEqual({ status: 'backed-up', commit: head(), pushed: true, largeFiles: [] })
  })
})

/** The old machine: content backed up to the remote, then gone. */
async function backedUpContent() {
  await contentWithRemote()
  git(content, 'push', '--quiet', 'origin', 'HEAD')
  await rm(content, { recursive: true })
}

const ADD_ITEM = (item: string) => `read -rs TOKEN && security add-generic-password -U -a "$USER" -s ${item} -T "" -w "$TOKEN"; unset TOKEN`

describe('ostraka init --from', { timeout: 60_000 }, () => {
  it('walks through the Keychain items, clones the content and writes config.yml', async () => {
    await backedUpContent()
    const prompts: string[] = []
    // The user creates each item in another tab, then presses Enter; the last one is skipped.
    const readLine = async (prompt: string) => {
      prompts.push(prompt)
      return prompts.length === 2 ? 'skip' : ''
    }

    const result = await ostraka(['init', '--from', remote], { readLine })

    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(prompts).toHaveLength(2)
    for (const item of ['ostraka-gitlab', 'ostraka-jira']) expect(result.stdout).toContain(ADD_ITEM(item))
    expect(result.stdout).not.toContain('ostraka-push')
    expect(result.stdout).toContain('ostraka-jira: skipped')
    expect(git(content, 'remote', 'get-url', 'origin')).toBe(remote)
    expect(await readFile(join(content, 'todos.json'), 'utf8')).toBe('{"todos":[]}\n')
    expect(await loadConfig({ homeDir: home })).toEqual({ contentDir: content })
  })

  it("lets git authenticate the clone with the user's own setup, and takes the GitLab URL from the remote", async () => {
    const server = await startHttpRemote(dir, USER_TOKEN)
    try {
      await backedUpContent()
      userCredentialHelper(USER_TOKEN)

      const result = await ostraka(['init', '--from', `${server.url}/remote.git`])

      expect(result).toMatchObject({ code: 0, stderr: '' })
      expect(await loadConfig({ homeDir: home })).toEqual({ contentDir: content, gitlab: { base_url: server.url } })
    } finally {
      await server.close()
    }
  })

  it('keeps an existing config.yml', async () => {
    await backedUpContent()
    await mkdir(join(home, '.config', 'ostraka'), { recursive: true })
    await writeFile(join(home, '.config', 'ostraka', 'config.yml'), 'jira:\n  board_id: 7\n')

    const result = await ostraka(['init', '--from', remote])

    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/Kept .*config\.yml/)
    expect(await loadConfig({ homeDir: home })).toEqual({ jira: { board_id: 7 } })
  })

  it('refuses a content folder that already has files, writing nothing', async () => {
    await contentWithRemote()

    const result = await ostraka(['init', '--from', remote])

    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/already exists/)
    expect(await loadConfig({ homeDir: home })).toEqual({})
  })

  it('stops when the clone fails, writing no config', async () => {
    const result = await ostraka(['init', '--from', join(dir, 'missing.git')])

    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/Could not clone/)
    expect(await loadConfig({ homeDir: home })).toEqual({})
  })

  it('needs --from', async () => {
    expect((await ostraka(['init'])).code).toBe(1)
  })
})

describe('the Keychain', { timeout: 60_000 }, () => {
  it('is never read by ostraka backup or ostraka init', async () => {
    await contentWithRemote()
    await backup()
    await rm(content, { recursive: true })
    await ostraka(['init', '--from', remote], { readLine: async () => '' })

    expect(macKeychain).not.toHaveBeenCalled()
  })
})
