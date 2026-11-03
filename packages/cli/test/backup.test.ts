import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, snapshot } from '@ostraka/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeKeychain } from '../../../apps/server/test/fake-keychain.ts'
import { startHttpRemote } from '../../../packages/core/test/http-remote.ts'
import { run, type Io } from '../src/main.ts'

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
  await rm(dir, { recursive: true, force: true })
})

const PUSH_TOKEN = `test-push-token-${'z'.repeat(12)}`

async function ostraka(argv: string[], io: Partial<Io> = {}) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, {
    env: { OSTRAKA_HOME: content },
    homeDir: home,
    keychain: fakeKeychain({ 'ostraka-push': PUSH_TOKEN }).keychain,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    ...io,
  })
  return { code, stdout, stderr }
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
const head = () => git(content, 'rev-parse', 'HEAD')
const remoteHead = () => git(remote, 'for-each-ref', '--format=%(objectname)')

async function contentWithRemote() {
  await mkdir(content, { recursive: true })
  await writeFile(join(content, 'todos.json'), '{"todos":[]}\n')
  await snapshot('first', { env: { OSTRAKA_HOME: content } })
  git(content, 'remote', 'add', 'origin', remote)
}

// Each git process takes a few hundred ms to spawn under the test runner on macOS.
describe('ostraka backup', { timeout: 60_000 }, () => {
  it('pushes now, reading only the push token from the Keychain', async () => {
    await contentWithRemote()
    const { keychain, reads } = fakeKeychain({ 'ostraka-push': PUSH_TOKEN })

    const result = await ostraka(['backup'], { keychain })

    expect(result).toEqual({ code: 0, stdout: `Backed up ${head().slice(0, 7)} to origin.\n`, stderr: '' })
    expect(remoteHead()).toBe(head())
    expect(reads).toEqual(['ostraka-push'])
  })

  it('says when there was nothing new', async () => {
    await contentWithRemote()
    await ostraka(['backup'])
    expect(await ostraka(['backup'])).toEqual({ code: 0, stdout: `Already backed up (${head().slice(0, 7)}).\n`, stderr: '' })
  })

  it('names the files holding a secret and pushes nothing', async () => {
    await contentWithRemote()
    await mkdir(join(content, 'notes'))
    await writeFile(join(content, 'notes', 'setup.md'), `---\ntags: []\n---\n${['xoxb', '1234567890', 'abcdefghij'].join('-')}\n`)
    await snapshot('setup', { env: { OSTRAKA_HOME: content } })

    const result = await ostraka(['backup'])

    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/Backup blocked: nothing was pushed/)
    expect(result.stderr).toContain('notes/setup.md (Slack token)')
    expect(remoteHead()).toBe('')
  })

  it('shows why a push was rejected', async () => {
    await contentWithRemote()
    const other = join(dir, 'other')
    execFileSync('git', ['clone', '--quiet', remote, other])
    await writeFile(join(other, 'x.md'), 'other\n')
    git(other, 'add', 'x.md')
    git(other, '-c', 'user.name=O', '-c', 'user.email=o@localhost', 'commit', '--quiet', '-m', 'other')
    git(other, 'push', '--quiet', 'origin', `HEAD:${git(content, 'symbolic-ref', '--short', 'HEAD')}`)

    const result = await ostraka(['backup'])

    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/^Push rejected/)
    expect(result.stderr).toMatch(/never merges or force-pushes/)
  })

  it('explains how to add the remote when there is none', async () => {
    await mkdir(content)
    await writeFile(join(content, 'todos.json'), '{"todos":[]}\n')
    await snapshot('first', { env: { OSTRAKA_HOME: content } })

    const result = await ostraka(['backup'])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain(`git -C ${content} remote add origin <url>`)
  })

  it('warns about content files over 10 MB', async () => {
    await contentWithRemote()
    await writeFile(join(content, 'big.png'), Buffer.alloc(11 * 1024 * 1024))
    await snapshot('image', { env: { OSTRAKA_HOME: content } })

    const result = await ostraka(['backup'])

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('Warning: big.png is 11.0 MB; keep content files under 10 MB.\n')
  })

  it('prints the result as JSON for agents', async () => {
    await contentWithRemote()
    const result = await ostraka(['backup', '--json'])
    expect(JSON.parse(result.stdout)).toEqual({ status: 'backed-up', commit: head(), pushed: true, largeFiles: [] })
  })

  it('refuses to run without a Keychain to read from', async () => {
    await contentWithRemote()
    const result = await ostraka(['backup'], { keychain: undefined })
    expect(result.code).toBe(1)
    expect(remoteHead()).toBe('')
  })
})

/** The old machine: content backed up to the remote, then gone. */
async function backedUpContent() {
  await contentWithRemote()
  await ostraka(['backup'])
  await rm(content, { recursive: true })
}

describe('ostraka init --from', { timeout: 60_000 }, () => {
  it('walks through the Keychain items, clones the content and writes config.yml', async () => {
    await backedUpContent()
    const items: Record<string, string> = { 'ostraka-gitlab': 'x' }
    const { keychain } = fakeKeychain(items)
    const prompts: string[] = []
    // The user creates each missing item in another tab, then presses Enter.
    const readLine = async (prompt: string) => {
      prompts.push(prompt)
      const missing = ['ostraka-push', 'ostraka-jira'].find((item) => items[item] === undefined)!
      items[missing] = missing === 'ostraka-push' ? PUSH_TOKEN : 'y'
      return ''
    }

    const result = await ostraka(['init', '--from', remote], { keychain, readLine })

    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(prompts).toHaveLength(2)
    for (const item of ['ostraka-push', 'ostraka-jira']) {
      expect(result.stdout).toContain(
        `read -rs TOKEN && security add-generic-password -U -a "$USER" -s ${item} -T "" -w "$TOKEN"; unset TOKEN`,
      )
    }
    expect(result.stdout).toContain('ostraka-gitlab: found')
    expect(git(content, 'remote', 'get-url', 'origin')).toBe(remote)
    expect(await readFile(join(content, 'todos.json'), 'utf8')).toBe('{"todos":[]}\n')
    expect(await loadConfig({ homeDir: home })).toEqual({ contentDir: content })
  })

  it('clones over HTTP with the push token and takes the GitLab URL from the remote', async () => {
    const server = await startHttpRemote(dir, PUSH_TOKEN)
    try {
      await backedUpContent()
      const { keychain } = fakeKeychain({ 'ostraka-push': PUSH_TOKEN, 'ostraka-gitlab': 'x', 'ostraka-jira': 'y' })

      const result = await ostraka(['init', '--from', `${server.url}/remote.git`], { keychain })

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
    const { keychain } = fakeKeychain({ 'ostraka-push': PUSH_TOKEN, 'ostraka-gitlab': 'x', 'ostraka-jira': 'y' })

    const result = await ostraka(['init', '--from', remote], { keychain })

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
    const { keychain } = fakeKeychain({ 'ostraka-push': PUSH_TOKEN, 'ostraka-gitlab': 'x', 'ostraka-jira': 'y' })

    const result = await ostraka(['init', '--from', join(dir, 'missing.git')], { keychain })

    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/Could not clone/)
    expect(await loadConfig({ homeDir: home })).toEqual({})
  })

  it('needs --from', async () => {
    expect((await ostraka(['init'])).code).toBe(1)
  })
})
