import { request } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, macKeychain, readCredentials, startServer, type RunSecurity } from '../src/index.ts'
import { fakeKeychain, TOKENS } from './fake-keychain.ts'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ostraka-home-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

/** A plain HTTP GET with the app's own Host, as the browser sends it. */
function httpGet(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host: '127.0.0.1:4747' } }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode ?? 0))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('startServer', () => {
  it('reads each Keychain item once, at startup', async () => {
    const { keychain, reads } = fakeKeychain(TOKENS)
    const { server, stop } = await startServer({ port: 0, webDist: '/nonexistent', keychain, env: {}, homeDir: home })
    try {
      expect(reads).toEqual(['ostraka-gitlab', 'ostraka-jira', 'ostraka-push'])
      const { port } = server.address() as AddressInfo
      for (let i = 0; i < 3; i++) expect(await httpGet(port, '/api/settings')).toBe(200)
      expect(reads).toHaveLength(3)
    } finally {
      await stop()
    }
  }, 30_000)

  it('starts without the items it cannot read', async () => {
    const warnings: string[] = []
    const credentials = await readCredentials(
      {
        async read(service) {
          if (service === 'ostraka-jira') throw new Error('denied')
          return service === 'ostraka-gitlab' ? TOKENS['ostraka-gitlab'] : undefined
        },
      },
      (message) => warnings.push(message),
    )
    expect(Object.keys(credentials)).toEqual(['gitlab'])
    expect(warnings).toEqual([expect.stringMatching(/ostraka-jira/)])
  })
})

describe('no route returns a token', () => {
  it('leaves every token out of every response', async () => {
    await mkdir(join(home, '.config', 'ostraka'), { recursive: true })
    await writeFile(join(home, '.config', 'ostraka', 'config.yml'), 'gitlab:\n  base_url: https://gitlab.com\n')
    const credentials = await readCredentials(fakeKeychain(TOKENS).keychain)
    const app = createApp({ webDist: '/nonexistent', content: { env: {}, homeDir: home }, credentials })

    const paths = new Set(['/', '/settings', '/api/nope', ...app.routes.map((route) => route.path.replace(/\*$/, 'anything'))])
    for (const path of paths) {
      for (const method of ['GET', 'POST']) {
        const res = await app.request(path, { method, headers: { host: '127.0.0.1:4747' } })
        const text = `${[...res.headers].join('\n')}\n${await res.text()}`
        for (const token of Object.values(TOKENS)) expect(text, `${method} ${path}`).not.toContain(token)
      }
    }
  })

  it('redacts a credential that reaches JSON, a string or a log line', async () => {
    const credentials = await readCredentials(fakeKeychain(TOKENS).keychain)
    const leaked = [JSON.stringify(credentials), `${credentials.gitlab}`, inspect(credentials)].join('\n')
    for (const token of Object.values(TOKENS)) expect(leaked).not.toContain(token)
    expect(credentials.jira?.reveal()).toBe(TOKENS['ostraka-jira'])
  })
})

/** A fake `security` binary that answers every call with one exit code and output. */
function security(code: number, stdout = ''): { run: RunSecurity; calls: string[][] } {
  const calls: string[][] = []
  return { calls, run: async (args) => (calls.push(args), { code, stdout }) }
}

describe('macKeychain', () => {
  it('reads a generic password by service name', async () => {
    const { run, calls } = security(0, `${TOKENS['ostraka-jira']}\n`)
    expect(await macKeychain(run).read('ostraka-jira')).toBe(TOKENS['ostraka-jira'])
    expect(calls).toEqual([['find-generic-password', '-s', 'ostraka-jira', '-w']])
  })

  it('treats a missing item as no credential', async () => {
    expect(await macKeychain(security(44).run).read('ostraka-push')).toBeUndefined()
  })

  it('fails on a denied read without echoing the output', async () => {
    const read = macKeychain(security(128, 'partial-output').run).read('ostraka-gitlab')
    await expect(read).rejects.toThrow(/security exited with 128/)
    await expect(read).rejects.not.toThrow(/partial-output/)
  })
})
