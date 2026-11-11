import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SearchHit } from '@ostraka/core'
import { createApp } from '../src/index.ts'
import { startSearch, type Search } from '../src/search.ts'

let contentRoot: string
let search: Search | undefined
let app: ReturnType<typeof createApp>

const content = () => ({ env: { OSTRAKA_HOME: contentRoot } })

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
})

afterEach(async () => {
  await search?.stop()
  search = undefined
  await rm(contentRoot, { recursive: true, force: true })
})

const writeNote = async (id: string, body: string) => {
  await mkdir(join(contentRoot, 'notes'), { recursive: true })
  await writeFile(join(contentRoot, 'notes', `${id}.md`), `---\ntags: []\n---\n\n${body}\n`)
}

type Answer = { indexing: boolean; hits: SearchHit[] }
const get = async (query: string) => {
  const res = await app.request(`/api/search?${query}`, { headers: { host: '127.0.0.1:4747' } })
  return { status: res.status, body: (await res.json()) as Answer & { error?: string } }
}

/** Asks until `check` passes on the answer, for up to 3 s. */
async function eventually(query: string, check: (answer: Answer) => boolean): Promise<Answer> {
  const until = Date.now() + 3000
  for (;;) {
    const { body } = await get(query)
    if (check(body) || Date.now() > until) return body
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

const ids = (answer: Answer) => answer.hits.map((hit) => `${hit.kind}:${hit.id}`)

describe('/api/search', () => {
  it('says it is indexing until the index is built from the files, then answers hits', async () => {
    await writeNote('n1', '# Plan\n\nThe payment gateway')
    const held = Promise.withResolvers<void>()
    search = await startSearch({ content: content(), beforeRebuild: () => held.promise })
    app = createApp({ webDist: '/nonexistent', content: content(), search })
    expect((await get('q=gateway')).body).toEqual({ indexing: true, hits: [] })
    held.resolve()
    const answer = await eventually('q=gateway', (body) => !body.indexing)
    expect(ids(answer)).toEqual(['note:n1'])
    expect(answer.hits[0]).toMatchObject({ title: 'Plan', snippet: expect.arrayContaining([{ text: 'gateway', match: true }]) })
  })

  it('keeps current as files change on disk, whoever changes them', async () => {
    search = await startSearch({ content: content() })
    app = createApp({ webDist: '/nonexistent', content: content(), search })
    await eventually('q=x', (body) => !body.indexing)
    await writeNote('n2', '# Later\n\nA bridge appears')
    expect(ids(await eventually('q=bridge', (body) => body.hits.length > 0))).toEqual(['note:n2'])
    await rm(join(contentRoot, 'notes', 'n2.md'))
    expect(ids(await eventually('q=bridge', (body) => body.hits.length === 0))).toEqual([])
  })

  it('narrows by Tag, kind and days from the query string', async () => {
    await mkdir(join(contentRoot, 'devlogs'), { recursive: true })
    await writeFile(join(contentRoot, 'devlogs', '2026-10-01.md'), '---\ndate: 2026-10-01\ntags: [infra]\n---\n\nrelease\n')
    await writeFile(join(contentRoot, 'devlogs', '2026-10-05.md'), '---\ndate: 2026-10-05\n---\n\nrelease\n')
    await writeNote('n3', '# Release\n\nrelease')
    search = await startSearch({ content: content() })
    app = createApp({ webDist: '/nonexistent', content: content(), search })
    await eventually('q=x', (body) => !body.indexing)
    expect(ids((await get('q=release&kind=devlog')).body)).toEqual(['devlog:2026-10-05', 'devlog:2026-10-01'])
    expect(ids((await get('q=release&tag=infra')).body)).toEqual(['devlog:2026-10-01'])
    expect(ids((await get('q=release&kind=devlog&from=2026-10-02')).body)).toEqual(['devlog:2026-10-05'])
  })

  it('refuses a query it cannot read', async () => {
    search = await startSearch({ content: content() })
    app = createApp({ webDist: '/nonexistent', content: content(), search })
    const { status, body } = await get('q=x&kind=bogus')
    expect(status).toBe(400)
    expect(body.error).toMatch(/Kinds are todo, note, devlog, sketch/)
  })

  it('without a running index, searches a throwaway one built for the request', async () => {
    await writeNote('n4', '# Lazy\n\nwombat')
    app = createApp({ webDist: '/nonexistent', content: content() })
    expect((await get('q=wombat')).body).toEqual({ indexing: false, hits: [expect.objectContaining({ kind: 'note', id: 'n4' })] })
  })
})
