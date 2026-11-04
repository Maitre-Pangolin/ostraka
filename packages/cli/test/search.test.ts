import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SearchHit } from '@ostraka/core'
import { createApp } from '@ostraka/server'
import { run, type Io } from '../src/main.ts'

let contentRoot: string

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  await mkdir(join(contentRoot, 'notes'))
  await mkdir(join(contentRoot, 'devlogs'))
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
})

/** No server listening: every request is refused, as when `ostraka serve` isn't running. */
const serverDown: Io['fetch'] = () => Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }))

async function ostraka(argv: string[], fetch: Io['fetch'] = serverDown) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, {
    env: { OSTRAKA_HOME: contentRoot },
    fetch,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  })
  return { code, stdout, stderr }
}

const writeNote = (id: string, text: string) => writeFile(join(contentRoot, 'notes', `${id}.md`), text)
const writeDevlog = (day: string, tags: string[], body: string) =>
  writeFile(join(contentRoot, 'devlogs', `${day}.md`), `---\ndate: ${day}\ntags: [${tags.join(', ')}]\n---\n\n${body}\n`)

describe('ostraka search', () => {
  it('without a server, searches a throwaway index of the files: kind, id, title, date, Tags, path and snippet', async () => {
    await writeNote('plan1', '---\ntags: [work]\n---\n\n# Release plan\n\nShip the payment gateway on Friday.\n')
    const { code, stdout } = await ostraka(['search', 'gateway'])
    expect(code).toBe(0)
    const [first, second, third] = stdout.split('\n')
    expect(first).toMatch(/^note {2}plan1 {2}Release plan {2}\d{4}-\d{2}-\d{2} {2}#work$/)
    expect(second).toBe(`  ${join(contentRoot, 'notes', 'plan1.md')}`)
    expect(third).toBe('  Ship the payment **gateway** on Friday.')
  })

  it('says when nothing matches', async () => {
    expect(await ostraka(['search', 'nothing'])).toEqual({ code: 0, stdout: 'Nothing found.\n', stderr: '' })
  })

  it('narrows by --tag, --kind, --from and --to, and prints JSON with --json', async () => {
    await writeDevlog('2026-10-01', ['infra'], 'release day')
    await writeDevlog('2026-10-05', ['infra'], 'release again')
    await writeDevlog('2026-10-09', [], 'release')
    await writeNote('n', '---\ntags: [infra]\n---\n\n# Release\n\nrelease\n')
    const { code, stdout } = await ostraka([
      'search',
      'release',
      '--tag',
      'infra',
      '--kind',
      'devlog',
      '--from',
      '2026-10-02',
      '--to',
      '2026-10-31',
      '--json',
    ])
    expect(code).toBe(0)
    const hits = JSON.parse(stdout) as (SearchHit & { path?: string })[]
    expect(hits.map((hit) => hit.id)).toEqual(['2026-10-05'])
    expect(hits[0]).toMatchObject({ kind: 'devlog', path: join(contentRoot, 'devlogs', '2026-10-05.md'), tags: ['infra'] })
  })

  it('lists by Tag alone, newest first', async () => {
    await writeDevlog('2026-10-01', ['infra'], 'a')
    await writeDevlog('2026-10-05', ['infra'], 'b')
    const { stdout } = await ostraka(['search', '--tag', 'infra'])
    expect(stdout.split('\n').filter((line) => !line.startsWith(' ') && line)).toEqual([
      'devlog  2026-10-05  2026-10-05  2026-10-05  #infra',
      'devlog  2026-10-01  2026-10-01  2026-10-01  #infra',
    ])
  })

  it('goes through the running server when it serves the same content folder', async () => {
    await writeNote('n1', '---\ntags: []\n---\n\n# On disk\n\nwombat\n')
    const served: string[] = []
    const app = createApp({
      webDist: '/nonexistent',
      content: { env: { OSTRAKA_HOME: contentRoot } },
      search: {
        search: async (query) => {
          served.push(query.text ?? '')
          return [{ kind: 'note', id: 'n1', title: 'From the server', date: '2026-11-01', tags: [], snippet: [] }]
        },
      },
    })
    const viaServer: Io['fetch'] = (url, init) =>
      Promise.resolve(app.request(String(url), { ...init, headers: { host: '127.0.0.1:4747' } }))
    const { stdout } = await ostraka(['search', 'wombat'], viaServer)
    expect(served).toEqual(['wombat'])
    expect(stdout).toMatch(/^note {2}n1 {2}From the server {2}2026-11-01\n/)
  })

  it('searches the files itself when the server serves another content folder, or is still indexing', async () => {
    await writeNote('n1', '---\ntags: []\n---\n\n# On disk\n\nwombat\n')
    const other = createApp({ webDist: '/nonexistent', content: { env: { OSTRAKA_HOME: join(contentRoot, 'elsewhere') } } })
    const toOther: Io['fetch'] = (url, init) =>
      Promise.resolve(other.request(String(url), { ...init, headers: { host: '127.0.0.1:4747' } }))
    expect((await ostraka(['search', 'wombat'], toOther)).stdout).toMatch(/^note {2}n1 {2}On disk/)

    const indexing = createApp({
      webDist: '/nonexistent',
      content: { env: { OSTRAKA_HOME: contentRoot } },
      search: { search: async () => undefined },
    })
    const toIndexing: Io['fetch'] = (url, init) =>
      Promise.resolve(indexing.request(String(url), { ...init, headers: { host: '127.0.0.1:4747' } }))
    expect((await ostraka(['search', 'wombat'], toIndexing)).stdout).toMatch(/^note {2}n1 {2}On disk/)
  })

  it('refuses a bad kind or day, and no query at all', async () => {
    expect(await ostraka(['search', 'x', '--kind', 'bogus'])).toMatchObject({ code: 1, stderr: expect.stringMatching(/Kinds are/) })
    expect(await ostraka(['search', 'x', '--from', 'yesterday'])).toMatchObject({ code: 1, stderr: expect.stringMatching(/YYYY-MM-DD/) })
    expect(await ostraka(['search'])).toMatchObject({ code: 1, stderr: expect.stringMatching(/Usage/) })
  })
})
