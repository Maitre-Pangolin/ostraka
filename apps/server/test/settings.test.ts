import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, readCredentials } from '../src/index.ts'
import { fakeKeychain, TOKENS } from './fake-keychain.ts'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ostraka-home-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

async function writeConfig(yaml: string) {
  await mkdir(join(home, '.config', 'ostraka'), { recursive: true })
  await writeFile(join(home, '.config', 'ostraka', 'config.yml'), yaml)
}

async function getSettings(env: Record<string, string> = {}, items: Record<string, string> = {}) {
  const credentials = await readCredentials(fakeKeychain(items).keychain)
  const app = createApp({ webDist: '/nonexistent', content: { env, homeDir: home }, credentials })
  return app.request('/api/settings', { headers: { host: '127.0.0.1:4747' } })
}

describe('GET /api/settings', () => {
  it('shows the config values', async () => {
    await writeConfig(`contentDir: ~/my-content
gitlab:
  base_url: https://gitlab.com
jira:
  site: https://acme.atlassian.net
  cloud_id: 0b6e4f0a-3c1d-4e7b-9a8f-2d5c6b7a8e9f
  board_id: 42
  my_tickets_jql: assignee = currentUser()
`)
    const res = await getSettings()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      configFile: join(home, '.config', 'ostraka', 'config.yml'),
      content: { path: join(home, 'my-content'), source: 'config' },
      gitlab: { base_url: 'https://gitlab.com' },
      jira: {
        site: 'https://acme.atlassian.net',
        cloud_id: '0b6e4f0a-3c1d-4e7b-9a8f-2d5c6b7a8e9f',
        board_id: 42,
        my_tickets_jql: 'assignee = currentUser()',
      },
    })
  })

  it('shows defaults when there is no config file', async () => {
    expect(await (await getSettings()).json()).toMatchObject({
      content: { path: join(home, 'ostraka-content'), source: 'default' },
      gitlab: {},
      jira: {},
    })
  })

  it('says when OSTRAKA_HOME overrides the content folder', async () => {
    expect(await (await getSettings({ OSTRAKA_HOME: '/tmp/elsewhere' })).json()).toMatchObject({
      content: { path: '/tmp/elsewhere', source: 'env' },
    })
  })

  it('says which Keychain items were found, never their values', async () => {
    const res = await getSettings({}, { 'ostraka-gitlab': TOKENS['ostraka-gitlab'] })
    const body = await res.text()
    expect(JSON.parse(body).keychain).toEqual([
      { name: 'gitlab', item: 'ostraka-gitlab', found: true },
      { name: 'jira', item: 'ostraka-jira', found: false },
    ])
    expect(body).not.toContain(TOKENS['ostraka-gitlab'])
  })

  it('reports an invalid config file as an error', async () => {
    await writeConfig('gitlab:\n  base_url: not a url\n')
    const res = await getSettings()
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: string }).error).toMatch(/config\.yml[\s\S]*base_url/)
  })
})
