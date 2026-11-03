// Hover details for a Reference that the work overview didn't poll, fetched on demand from GitLab or Jira.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, readCredentials, referenceLookup } from '../src/index.ts'
import { fakeFetch, type FakeResponse } from './fake-clock.ts'
import { fakeKeychain, TOKENS } from './fake-keychain.ts'

const GITLAB = 'https://gitlab.example.test'
const SITE = 'https://acme.atlassian.test'
const CLOUD_ID = '0b6e4f0a-3c1d-4e7b-9a8f-2d5c6b7a8e9f'
const GATEWAY = `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/3`
const CONFIG = `gitlab:
  base_url: ${GITLAB}
jira:
  site: ${SITE}
  cloud_id: ${CLOUD_ID}
  email: me@acme.test
`

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ostraka-home-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

async function writeConfig(text: string) {
  await mkdir(join(home, '.config', 'ostraka'), { recursive: true })
  await writeFile(join(home, '.config', 'ostraka', 'config.yml'), text)
}

const MR = {
  data: {
    project: {
      mergeRequest: {
        title: 'Retry webhooks',
        webUrl: `${GITLAB}/acme/pay/api/-/merge_requests/809`,
        state: 'merged',
        draft: false,
        author: { name: 'Ana Lima' },
        approvedBy: { nodes: [{ username: 'bo' }, { username: 'me' }] },
        headPipeline: { status: 'SUCCESS' },
      },
    },
  },
}

const ISSUE = {
  key: 'PAY-1432',
  fields: { summary: 'Retry failed webhooks', status: { name: 'In review', statusCategory: { key: 'indeterminate' } } },
}

async function setup(respond: (url: URL, init: RequestInit) => FakeResponse | Error, items: Record<string, string> = TOKENS) {
  const remote = fakeFetch(respond)
  const content = { env: { OSTRAKA_HOME: join(home, 'content') }, homeDir: home }
  const credentials = await readCredentials(fakeKeychain(items).keychain)
  const references = referenceLookup({ fetch: remote.fetch, credentials, content })
  const app = createApp({ webDist: '/nonexistent', content, credentials, references })
  const details = async (token: string) => {
    const res = await app.request(`/api/references?token=${encodeURIComponent(token)}`, { headers: { host: '127.0.0.1:4747' } })
    const text = await res.text()
    for (const secret of Object.values(TOKENS)) expect(text).not.toContain(secret)
    return { status: res.status, body: JSON.parse(text) }
  }
  return { details, calls: remote.calls }
}

describe('GET /api/references', () => {
  beforeEach(() => writeConfig(CONFIG))

  it("fetches an MR's title, state, pipeline and approvals from GitLab", async () => {
    const { details, calls } = await setup(() => ({ body: MR }))
    expect(await details('acme/pay/api!809')).toEqual({
      status: 200,
      body: {
        kind: 'mr',
        token: 'acme/pay/api!809',
        title: 'Retry webhooks',
        url: `${GITLAB}/acme/pay/api/-/merge_requests/809`,
        state: 'merged',
        draft: false,
        author: 'Ana Lima',
        approvals: 2,
        pipeline: { status: 'success' },
      },
    })
    const [call] = calls
    expect(call!.url.href).toBe(`${GITLAB}/api/graphql`)
    expect(new Headers(call!.init.headers).get('authorization')).toBe(`Bearer ${TOKENS['ostraka-gitlab']}`)
    expect(JSON.parse(String(call!.init.body)).variables).toEqual({ path: 'acme/pay/api', iid: '809' })
  })

  it("fetches a Jira issue's summary and status through the Atlassian gateway", async () => {
    const { details, calls } = await setup(() => ({ body: ISSUE }))
    expect(await details('PAY-1432')).toEqual({
      status: 200,
      body: {
        kind: 'jira',
        token: 'PAY-1432',
        title: 'Retry failed webhooks',
        status: 'In review',
        category: 'indeterminate',
        url: `${SITE}/browse/PAY-1432`,
      },
    })
    expect(calls[0]!.url.href).toBe(`${GATEWAY}/issue/PAY-1432?fields=summary%2Cstatus`)
  })

  it('answers 404 for a Reference GitLab or Jira does not know', async () => {
    const { details } = await setup((url) => (url.pathname.includes('/issue/') ? { status: 404 } : { body: { data: { project: null } } }))
    expect(await details('PAY-9')).toMatchObject({ status: 404, body: { error: expect.stringMatching(/PAY-9/) } })
    expect(await details('gone/repo!1')).toMatchObject({ status: 404, body: { error: expect.stringMatching(/gone\/repo!1/) } })
  })

  it('answers 400 for anything that is not one Reference token', async () => {
    const { details, calls } = await setup(() => ({ body: MR }))
    expect((await details('!809')).status).toBe(400)
    expect((await details('pay/api!809 PAY-1')).status).toBe(400)
    expect(calls).toEqual([])
  })

  it('answers 503 with what to set up when the source is not set up', async () => {
    const { details, calls } = await setup(() => ({ body: MR }), {})
    expect(await details('pay/api!809')).toMatchObject({ status: 503, body: { error: 'No ostraka-gitlab item in the Keychain.' } })
    expect(await details('PAY-1')).toMatchObject({ status: 503, body: { error: 'No ostraka-jira item in the Keychain.' } })
    expect(calls).toEqual([])
  })

  it('answers 502 with the reason when the source fails', async () => {
    const { details } = await setup(() => ({ status: 401 }))
    expect(await details('PAY-1')).toMatchObject({ status: 502, body: { error: expect.stringMatching(/refused the token \(401\)/) } })
  })
})
