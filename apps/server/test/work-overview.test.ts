import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, readCredentials, workOverview, type ContentEvents } from '../src/index.ts'
import { fakeClock, fakeFetch, type FakeResponse } from './fake-clock.ts'
import { fakeKeychain, TOKENS } from './fake-keychain.ts'

const BASE_URL = 'https://gitlab.example.test'
const SECOND = 1000
const MINUTE = 60 * SECOND

type FakeMr = {
  iid: number
  title: string
  project?: string
  projectId?: number
  pipeline?: { id: number; status: string }
  approvedBy?: string[]
  author?: string
}

/** A GraphQL MergeRequest node as GitLab answers it. */
function mrNode({ iid, title, project = 'pay/api', projectId = 7, pipeline, approvedBy = [], author = 'Ana Lima' }: FakeMr) {
  return {
    iid: String(iid),
    title,
    webUrl: `${BASE_URL}/${project}/-/merge_requests/${iid}`,
    draft: false,
    updatedAt: '2026-11-02T08:00:00Z',
    reference: `${project}!${iid}`,
    projectId,
    author: { name: author, username: author.toLowerCase().replace(' ', '.') },
    approvedBy: { nodes: approvedBy.map((username) => ({ username })) },
    headPipeline: pipeline && {
      id: `gid://gitlab/Ci::Pipeline/${pipeline.id}`,
      status: pipeline.status,
      webUrl: `${BASE_URL}/${project}/-/pipelines/${pipeline.id}`,
    },
  }
}

function currentUser({ authored = [], reviewing = [] }: { authored?: FakeMr[]; reviewing?: FakeMr[] }): FakeResponse {
  return {
    body: {
      data: {
        currentUser: {
          username: 'me',
          authoredMergeRequests: { nodes: authored.map(mrNode) },
          reviewRequestedMergeRequests: { nodes: reviewing.map(mrNode) },
        },
      },
    },
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

/** The server with GitLab behind a fake fetch and a fake clock, its work overview started. */
async function setup(respond: Parameters<typeof fakeFetch>[0], { items = TOKENS }: { items?: Record<string, string> } = {}) {
  const time = fakeClock()
  const gitlab = fakeFetch(respond)
  const content = { env: { OSTRAKA_HOME: join(home, 'content') }, homeDir: home }
  const credentials = await readCredentials(fakeKeychain(items).keychain)
  const activity = workOverview({ fetch: gitlab.fetch, clock: time.clock, credentials, content })
  const contentChanges: string[] = []
  const onContentChange = () => void contentChanges.push('changed')
  const app = createApp({ webDist: '/nonexistent', content, credentials, activity, events: noEvents, onContentChange })
  activity.start()
  stops.push(() => activity.stop())
  const get = async () => {
    const res = await app.request('/api/activity', { headers: { host: '127.0.0.1:4747' } })
    expect(res.status).toBe(200)
    return (await res.json()) as { sources: Record<string, any>[] }
  }
  /** A browser window with the app open: its live-updates stream, and the visibility it reports. */
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
    return { reader, show: () => report(true), hide: () => report(false), close: () => reader.cancel() }
  }
  return {
    app,
    time,
    calls: gitlab.calls,
    get,
    openWindow,
    contentChanges,
    gitlabStatus: async () => (await get()).sources.find((s) => s.source === 'gitlab')!,
  }
}

/** One authored MR, no pipeline. */
const answer = (url: URL) => (url.pathname === '/api/graphql' ? currentUser({ authored: [{ iid: 1, title: 'A' }] }) : { status: 404 })

const graphqlCalls = (calls: { url: URL }[]) => calls.filter((call) => call.url.pathname === '/api/graphql').length

describe('work overview: GitLab', () => {
  beforeEach(() => writeConfig(`gitlab:\n  base_url: ${BASE_URL}\n`))

  it('asks GitLab GraphQL for my MRs and review requests, and counts what needs me', async () => {
    const { time, calls, gitlabStatus } = await setup((url) =>
      url.pathname === '/api/graphql'
        ? currentUser({
            authored: [
              { iid: 809, title: 'Retry webhooks', pipeline: { id: 501, status: 'FAILED' } },
              { iid: 812, title: 'Split invoices', pipeline: { id: 502, status: 'SUCCESS' } },
            ],
            reviewing: [
              { iid: 77, title: 'Bump Node', project: 'web/app', author: 'Bo Chen' },
              { iid: 78, title: 'Already approved', project: 'web/app', approvedBy: ['me'] },
            ],
          })
        : { status: 404 },
    )
    await time.advance(0)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url.href).toBe(`${BASE_URL}/api/graphql`)
    expect(calls[0]!.init.method).toBe('POST')
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe(`Bearer ${TOKENS['ostraka-gitlab']}`)
    expect(JSON.parse(String(calls[0]!.init.body)).query).toMatch(/currentUser[\s\S]*reviewRequestedMergeRequests[\s\S]*headPipeline/)

    const gitlab = await gitlabStatus()
    expect(gitlab).toMatchObject({ state: 'ok', stale: false, updatedAt: '2026-11-02T09:00:00.000Z' })
    expect(gitlab.data.counts).toEqual({ toReview: 1, opened: 2, failedPipelines: 1 })
    expect(gitlab.data.reviewing).toEqual([
      expect.objectContaining({ reference: 'web/app!77', title: 'Bump Node', author: 'Bo Chen', approvedByMe: false }),
      expect.objectContaining({ reference: 'web/app!78', approvedByMe: true }),
    ])
    expect(gitlab.data.authored[0]).toMatchObject({
      reference: 'pay/api!809',
      title: 'Retry webhooks',
      url: `${BASE_URL}/pay/api/-/merge_requests/809`,
      pipeline: { status: 'failed', url: `${BASE_URL}/pay/api/-/pipelines/501` },
    })
  })

  describe('refresh rates', () => {

    it('polls MRs every 10 min while no window shows the app', async () => {
      const { time, calls } = await setup(answer)
      await time.advance(10 * MINUTE - SECOND)
      expect(graphqlCalls(calls)).toBe(1)
      await time.advance(SECOND)
      expect(graphqlCalls(calls)).toBe(2)
    })

    it('polls every 60 s while a window is visible, and every 10 min again once it is hidden', async () => {
      const { time, calls, openWindow } = await setup(answer)
      await time.advance(0)
      const window = await openWindow('tab-1')
      await window.show()
      await time.advance(MINUTE)
      expect(graphqlCalls(calls)).toBe(2)
      await time.advance(MINUTE)
      expect(graphqlCalls(calls)).toBe(3)

      await window.hide()
      await time.advance(10 * MINUTE - SECOND)
      expect(graphqlCalls(calls)).toBe(3)
      await time.advance(SECOND)
      expect(graphqlCalls(calls)).toBe(4)
    })

    it('refreshes at once when a window shows the app and the data is older than a minute', async () => {
      const { time, calls, openWindow } = await setup(answer)
      await time.advance(5 * MINUTE)
      expect(graphqlCalls(calls)).toBe(1)
      await (await openWindow('tab-1')).show()
      expect(graphqlCalls(calls)).toBe(2)
    })

    it('does not take a visibility report for a change to content (no Snapshot)', async () => {
      const { openWindow, contentChanges } = await setup(answer)
      await (await openWindow('tab-1')).show()
      expect(contentChanges).toEqual([])
    })

    it('counts as visible while any window is, and hidden once the visible one closes', async () => {
      const { time, calls, openWindow } = await setup(answer)
      await time.advance(0)
      const hidden = await openWindow('tab-1')
      await hidden.hide()
      const shown = await openWindow('tab-2')
      await shown.show()
      await time.advance(MINUTE)
      expect(graphqlCalls(calls)).toBe(2)

      await shown.close()
      await time.advance(9 * MINUTE)
      expect(graphqlCalls(calls)).toBe(2)
      await time.advance(MINUTE)
      expect(graphqlCalls(calls)).toBe(3)
    })
  })

  describe('running pipelines', () => {
    /** One authored MR whose pipeline runs until `pipelineStatus` says otherwise. */
    function runningPipeline() {
      const pipeline = { status: 'running' }
      const respond = (url: URL): FakeResponse => {
        if (url.pathname === '/api/graphql') {
          return currentUser({ authored: [{ iid: 809, title: 'Retry webhooks', projectId: 7, pipeline: { id: 501, status: 'RUNNING' } }] })
        }
        if (url.pathname === '/api/v4/projects/7/pipelines/501') return { body: { id: 501, status: pipeline.status, web_url: 'x' } }
        return { status: 404 }
      }
      return { pipeline, respond }
    }
    const pipelineCalls = (calls: { url: URL }[]) => calls.filter((call) => call.url.pathname.includes('/pipelines/')).length

    it('follows a running pipeline over REST every 15 s while visible, until it finishes', async () => {
      const { pipeline, respond } = runningPipeline()
      const { time, calls, openWindow, gitlabStatus } = await setup(respond)
      await time.advance(0)
      await (await openWindow('tab-1')).show()
      expect(pipelineCalls(calls)).toBe(0)

      await time.advance(15 * SECOND)
      expect(pipelineCalls(calls)).toBe(1)
      const call = calls.at(-1)!
      expect(call.url.href).toBe(`${BASE_URL}/api/v4/projects/7/pipelines/501`)
      expect(new Headers(call.init.headers).get('authorization')).toBe(`Bearer ${TOKENS['ostraka-gitlab']}`)
      expect((await gitlabStatus()).data.authored[0].pipeline.status).toBe('running')

      pipeline.status = 'failed'
      await time.advance(15 * SECOND)
      expect(pipelineCalls(calls)).toBe(2)
      const gitlab = await gitlabStatus()
      expect(gitlab.data.authored[0].pipeline.status).toBe('failed')
      expect(gitlab.data.counts.failedPipelines).toBe(1)

      // Finished: no more pipeline polls, though the MR poll (still saying running here) restarts them.
      await time.advance(15 * SECOND)
      expect(pipelineCalls(calls)).toBe(2)
    })

    it('follows it every 2 min while hidden', async () => {
      const { respond } = runningPipeline()
      const { time, calls } = await setup(respond)
      await time.advance(2 * MINUTE - SECOND)
      expect(pipelineCalls(calls)).toBe(0)
      await time.advance(SECOND)
      expect(pipelineCalls(calls)).toBe(1)
      await time.advance(2 * MINUTE)
      expect(pipelineCalls(calls)).toBe(2)
    })

    it('makes no pipeline calls while none is running', async () => {
      const { time, calls } = await setup(answer)
      await time.advance(30 * MINUTE)
      expect(pipelineCalls(calls)).toBe(0)
    })
  })
})
