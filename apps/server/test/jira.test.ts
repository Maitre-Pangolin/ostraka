import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, readCredentials, workOverview, type ContentEvents } from '../src/index.ts'
import { fakeClock, fakeFetch, type FakeResponse } from './fake-clock.ts'
import { fakeKeychain, TOKENS } from './fake-keychain.ts'

const SITE = 'https://acme.atlassian.test'
const CLOUD_ID = '0b6e4f0a-3c1d-4e7b-9a8f-2d5c6b7a8e9f'
const EMAIL = 'me@acme.test'
const GATEWAY = `https://api.atlassian.com/ex/jira/${CLOUD_ID}`
const SECOND = 1000
const MINUTE = 60 * SECOND

const JIRA_CONFIG = `jira:
  site: ${SITE}
  cloud_id: ${CLOUD_ID}
  email: ${EMAIL}
  board_id: 42
  my_tickets_jql: assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC
`

/** Jira's field list: the Sprint field is a custom field whose id differs per site. */
const FIELDS: FakeResponse = {
  body: [
    { id: 'summary', name: 'Summary', custom: false, schema: { type: 'string', system: 'summary' } },
    { id: 'customfield_10007', name: 'Story points', custom: true, schema: { type: 'number' } },
    {
      id: 'customfield_10020',
      name: 'Sprint',
      custom: true,
      schema: { type: 'array', items: 'json', custom: 'com.pyxis.greenhopper.jira:gh-sprint', customId: 10020 },
    },
  ],
}

type FakeTicket = { key: string; summary: string; status: string; category: 'new' | 'indeterminate' | 'done' }

const SPRINT = {
  id: 7,
  name: 'Payments 24',
  state: 'active',
  boardId: 42,
  startDate: '2026-10-26T08:00:00.000Z',
  endDate: '2026-11-06T17:00:00.000Z',
}
const OTHER_BOARD_SPRINT = { id: 9, name: 'Platform 3', state: 'active', boardId: 51, endDate: '2026-11-04T17:00:00.000Z' }

/** A `search/jql` answer, each issue in the sprints given. */
function search(tickets: FakeTicket[], sprints: object[] = [SPRINT]): FakeResponse {
  return {
    body: {
      issues: tickets.map(({ key, summary, status, category }, index) => ({
        id: String(10_000 + index),
        key,
        fields: {
          summary,
          status: { name: status, statusCategory: { key: category, colorName: 'blue-gray', name: category } },
          customfield_10020: sprints,
        },
      })),
      isLast: true,
    },
  }
}

/** One page of a longer search: `next` is the token for the page after it. */
function searchPage(keys: string[], next?: string): FakeResponse {
  const answer = search(keys.map((key) => ({ key, summary: key, status: 'To do', category: 'new' })))
  return { body: { ...(answer.body as object), isLast: !next, ...(next && { nextPageToken: next }) } }
}

const TICKETS: FakeTicket[] = [
  { key: 'PAY-1432', summary: 'Retry failed webhooks', status: 'In review', category: 'indeterminate' },
  { key: 'PAY-1440', summary: 'Split invoices by entity', status: 'To do', category: 'new' },
  { key: 'PAY-1401', summary: 'Drop the legacy export', status: 'Done', category: 'done' },
]

/** Answers like Jira: the field list, and the sprint search. */
function jira(tickets = TICKETS, sprints?: object[]) {
  return (url: URL): FakeResponse => {
    if (url.href === `${GATEWAY}/rest/api/3/field`) return FIELDS
    if (url.href === `${GATEWAY}/rest/api/3/search/jql`) return search(tickets, sprints)
    return { status: 404 }
  }
}

const noEvents: ContentEvents = { subscribe: async () => () => {} }

let home: string
let stops: (() => void)[]

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ostraka-home-'))
  stops = []
})

afterEach(async () => {
  for (const stop of stops) stop()
  await rm(home, { recursive: true, force: true })
})

async function writeConfig(text: string) {
  await mkdir(join(home, '.config', 'ostraka'), { recursive: true })
  await writeFile(join(home, '.config', 'ostraka', 'config.yml'), text)
}

/** The server with Jira (and GitLab) behind a fake fetch and a fake clock, its work overview started. */
async function setup(respond: Parameters<typeof fakeFetch>[0], { items = TOKENS }: { items?: Record<string, string> } = {}) {
  const time = fakeClock()
  const remote = fakeFetch(respond)
  const content = { env: { OSTRAKA_HOME: join(home, 'content') }, homeDir: home }
  const credentials = await readCredentials(fakeKeychain(items).keychain)
  const activity = workOverview({ fetch: remote.fetch, clock: time.clock, credentials, content })
  const app = createApp({ webDist: '/nonexistent', content, credentials, activity, events: noEvents })
  activity.start()
  stops.push(() => activity.stop())
  const get = async () => {
    const res = await app.request('/api/activity', { headers: { host: '127.0.0.1:4747' } })
    expect(res.status).toBe(200)
    return (await res.json()) as { sources: Record<string, any>[] }
  }
  const openWindow = async (client: string) => {
    const stream = await app.request(`/api/events?client=${client}`, { headers: { host: '127.0.0.1:4747' } })
    const reader = stream.body!.getReader()
    stops.push(() => void reader.cancel())
    await reader.read() // `ready`
    const report = async (visible: boolean) => {
      const res = await app.request('/api/activity/visibility', {
        method: 'POST',
        headers: { host: '127.0.0.1:4747', origin: 'http://127.0.0.1:4747', 'content-type': 'application/json' },
        body: JSON.stringify({ client, visible }),
      })
      expect(res.status).toBe(204)
      await time.advance(0)
    }
    return { reader, show: () => report(true), hide: () => report(false) }
  }
  const status = async (source: string) => (await get()).sources.find((s) => s.source === source)!
  return { app, time, calls: remote.calls, get, openWindow, jiraStatus: () => status('jira'), gitlabStatus: () => status('gitlab') }
}

const searchCalls = <Call extends { url: URL }>(calls: Call[]) => calls.filter((call) => call.url.pathname.endsWith('/search/jql'))

describe('work overview: Jira', () => {
  beforeEach(() => writeConfig(JIRA_CONFIG))

  it('searches my open-sprint tickets through the Atlassian gateway, with the scoped token', async () => {
    const { time, calls } = await setup(jira())
    await time.advance(0)

    const [call] = searchCalls(calls)
    expect(call!.url.href).toBe(`${GATEWAY}/rest/api/3/search/jql`)
    expect(call!.init.method).toBe('POST')
    const headers = new Headers(call!.init.headers)
    expect(headers.get('authorization')).toBe(`Basic ${Buffer.from(`${EMAIL}:${TOKENS['ostraka-jira']}`).toString('base64')}`)
    expect(headers.get('content-type')).toBe('application/json')
    const body = JSON.parse(String(call!.init.body))
    expect(body.jql).toBe('sprint in openSprints() AND (assignee = currentUser() AND statusCategory != Done) ORDER BY priority DESC')
    expect(body.fields).toEqual(expect.arrayContaining(['summary', 'status', 'customfield_10020']))
    // Every call goes through the gateway, never to the site itself.
    for (const { url } of calls) expect(url.origin).toBe('https://api.atlassian.com')
  })

  it('gives the open count, the sprint with its days left, and each ticket with its real Jira status', async () => {
    const { time, jiraStatus } = await setup(jira())
    await time.advance(0)

    const status = await jiraStatus()
    expect(status).toMatchObject({ state: 'ok', stale: false, updatedAt: '2026-11-02T09:00:00.000Z' })
    // 2026-11-02 09:00 to 2026-11-06 17:00: 4 days and 8 hours, so today and 4 more.
    expect(status.data.sprint).toEqual({ name: 'Payments 24', endDate: '2026-11-06T17:00:00.000Z', daysLeft: 5 })
    expect(status.data.counts).toEqual({ open: 2 })
    expect(status.data.tickets).toEqual([
      { key: 'PAY-1432', summary: 'Retry failed webhooks', status: 'In review', category: 'indeterminate', url: `${SITE}/browse/PAY-1432` },
      { key: 'PAY-1440', summary: 'Split invoices by entity', status: 'To do', category: 'new', url: `${SITE}/browse/PAY-1440` },
      { key: 'PAY-1401', summary: 'Drop the legacy export', status: 'Done', category: 'done', url: `${SITE}/browse/PAY-1401` },
    ])
  })

  it("shows the configured board's sprint when my tickets are in several open sprints", async () => {
    const { time, jiraStatus } = await setup(
      jira(TICKETS, [OTHER_BOARD_SPRINT, { id: 3, name: 'Payments 23', state: 'closed', boardId: 42 }, SPRINT]),
    )
    await time.advance(0)
    expect((await jiraStatus()).data.sprint).toMatchObject({ name: 'Payments 24', daysLeft: 5 })
  })

  it('follows the next pages of a long search', async () => {
    const { time, calls, jiraStatus } = await setup((url, init) => {
      if (url.pathname.endsWith('/field')) return FIELDS
      return JSON.parse(String(init.body)).nextPageToken === 'p2' ? searchPage(['PAY-2']) : searchPage(['PAY-1'], 'p2')
    })
    await time.advance(0)
    expect(searchCalls(calls)).toHaveLength(2)
    expect((await jiraStatus()).data.tickets.map((ticket: { key: string }) => ticket.key)).toEqual(['PAY-1', 'PAY-2'])
  })

  it('looks up the Sprint field once, not on every poll', async () => {
    const { time, calls } = await setup(jira())
    await time.advance(30 * MINUTE)
    expect(searchCalls(calls)).toHaveLength(3)
    expect(calls.filter((call) => call.url.pathname.endsWith('/field'))).toHaveLength(1)
  })

  describe('refresh rates', () => {
    it('polls the sprint every 15 min while no window shows the app', async () => {
      const { time, calls } = await setup(jira())
      await time.advance(15 * MINUTE - SECOND)
      expect(searchCalls(calls)).toHaveLength(1)
      await time.advance(SECOND)
      expect(searchCalls(calls)).toHaveLength(2)
    })

    it('polls every 3 min while a window is visible, and every 15 min again once it is hidden', async () => {
      const { time, calls, openWindow } = await setup(jira())
      await time.advance(0)
      const window = await openWindow('tab-1')
      await window.show()
      await time.advance(3 * MINUTE - SECOND)
      expect(searchCalls(calls)).toHaveLength(1)
      await time.advance(SECOND)
      expect(searchCalls(calls)).toHaveLength(2)
      await time.advance(3 * MINUTE)
      expect(searchCalls(calls)).toHaveLength(3)

      await window.hide()
      await time.advance(15 * MINUTE - SECOND)
      expect(searchCalls(calls)).toHaveLength(3)
      await time.advance(SECOND)
      expect(searchCalls(calls)).toHaveLength(4)
    })

    it('refreshes once when the machine wakes from sleep', async () => {
      const { time, calls } = await setup(jira())
      await time.advance(MINUTE)
      time.sleep(3 * 60 * MINUTE)
      await time.advance(MINUTE)
      expect(searchCalls(calls)).toHaveLength(2)
    })
  })

  describe('Retry-After', () => {
    it('waits as long as Jira asks before calling again, even while visible', async () => {
      let limited = false
      const ok = jira()
      const { time, calls, openWindow, jiraStatus } = await setup((url) =>
        limited && url.pathname.endsWith('/search/jql') ? { status: 429, headers: { 'retry-after': '600' } } : ok(url),
      )
      await (await openWindow('tab-1')).show()
      await time.advance(0)
      limited = true
      await time.advance(3 * MINUTE)
      expect(searchCalls(calls)).toHaveLength(2)
      expect(await jiraStatus()).toMatchObject({ state: 'failing', stale: true, reason: expect.stringMatching(/Jira is rate limiting/) })

      limited = false
      await time.advance(10 * MINUTE - SECOND)
      expect(searchCalls(calls)).toHaveLength(2)
      await time.advance(SECOND)
      expect(searchCalls(calls)).toHaveLength(3)
      expect(await jiraStatus()).toMatchObject({ state: 'ok', stale: false })
    })
  })

  describe('a failing source', () => {
    it('fails on its own: GitLab keeps polling and stays ok, and no response shows a token', async () => {
      await writeConfig(`gitlab:\n  base_url: https://gitlab.example.test\n${JIRA_CONFIG}`)
      const { time, app, jiraStatus, gitlabStatus } = await setup((url) => {
        if (url.hostname === 'gitlab.example.test') {
          return {
            body: {
              data: { currentUser: { username: 'me', authoredMergeRequests: { nodes: [] }, reviewRequestedMergeRequests: { nodes: [] } } },
            },
          }
        }
        return { status: 401, body: { errorMessages: ['Unauthorized'] } }
      })
      await time.advance(0)
      expect(await jiraStatus()).toMatchObject({
        state: 'failing',
        stale: false,
        reason: expect.stringMatching(/^Jira refused the token \(401\)/),
      })
      expect(await gitlabStatus()).toMatchObject({ state: 'ok', stale: false })

      const text = await (await app.request('/api/activity', { headers: { host: '127.0.0.1:4747' } })).text()
      for (const token of Object.values(TOKENS)) {
        expect(text).not.toContain(token)
        expect(text).not.toContain(Buffer.from(`${EMAIL}:${token}`).toString('base64'))
      }
    })

    it('keeps the last tickets, marked stale, while Jira cannot be reached', async () => {
      let down = false
      const ok = jira()
      const { time, jiraStatus } = await setup((url) =>
        down ? new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND api.atlassian.com') }) : ok(url),
      )
      await time.advance(0)
      down = true
      await time.advance(15 * MINUTE)
      const status = await jiraStatus()
      expect(status).toMatchObject({ state: 'failing', stale: true, updatedAt: '2026-11-02T09:00:00.000Z' })
      expect(status.reason).toMatch(/Could not reach api\.atlassian\.com: getaddrinfo ENOTFOUND/)
      expect(status.data.counts.open).toBe(2)
    })
  })

  describe('not set up', () => {
    it('is off, and calls nothing, without a token in the Keychain', async () => {
      const { time, calls, jiraStatus } = await setup(jira(), { items: {} })
      await time.advance(30 * MINUTE)
      expect(calls).toEqual([])
      expect(await jiraStatus()).toMatchObject({ state: 'off', reason: expect.stringMatching(/ostraka-jira/) })
    })
  })
})

describe('work overview: Jira configuration', () => {
  it.each([
    ['jira.cloud_id', `jira:\n  email: ${EMAIL}\n`],
    ['jira.email', `jira:\n  cloud_id: ${CLOUD_ID}\n`],
  ])('is off without %s, and calls nothing', async (key, config) => {
    await writeConfig(config)
    const { time, calls, jiraStatus } = await setup(jira())
    await time.advance(0)
    expect(calls).toEqual([])
    expect(await jiraStatus()).toMatchObject({ state: 'off', reason: expect.stringContaining(key) })
  })

  it('searches my assigned tickets in board order without jira.my_tickets_jql, and links nowhere without jira.site', async () => {
    await writeConfig(`jira:\n  cloud_id: ${CLOUD_ID}\n  email: ${EMAIL}\n`)
    const { time, calls, jiraStatus } = await setup(jira())
    await time.advance(0)
    expect(JSON.parse(String(searchCalls(calls)[0]!.init.body)).jql).toBe(
      'sprint in openSprints() AND (assignee = currentUser()) ORDER BY Rank ASC',
    )
    expect((await jiraStatus()).data.tickets[0]).not.toHaveProperty('url')
  })
})
