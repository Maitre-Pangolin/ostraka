import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addTodo, openSearchIndex, searchContent, searchIndexPath, type SearchHit } from '../src/index.ts'

let contentRoot: string
let options: { env: Record<string, string> }

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  options = { env: { OSTRAKA_HOME: contentRoot } }
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
})

const write = async (path: string, text: string) => {
  await mkdir(join(contentRoot, path, '..'), { recursive: true })
  await writeFile(join(contentRoot, path), text)
}
const note = (id: string, body: string, tags: string[] = []) => write(`notes/${id}.md`, `---\ntags: [${tags.join(', ')}]\n---\n\n${body}\n`)

/** Each hit as `kind:id`, in the order found. */
const found = async (text: string, extra: object = {}) =>
  (await searchContent({ text, ...extra }, options)).map((hit: SearchHit) => `${hit.kind}:${hit.id}`)

const todoItem = (id: string, title: string, extra: object = {}) => ({
  id,
  title,
  priority: 'none',
  tags: [],
  status: 'open',
  createdAt: '2026-10-01T09:00:00.000Z',
  ...extra,
})

describe('searchContent', () => {
  it('finds a Note by a word of its body, with its title and Tags', async () => {
    await note('plan1', '# Release plan\n\nShip the payment gateway on Friday.', ['work'])
    await note('other', '# Groceries\n\nMilk and eggs.')
    const hits = await searchContent({ text: 'gateway' }, options)
    expect(hits).toEqual([
      expect.objectContaining({
        kind: 'note',
        id: 'plan1',
        title: 'Release plan',
        tags: ['work'],
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    ])
  })

  it('ignores case and accents, both ways', async () => {
    await note('cafe1', '# Menu\n\nUn Café crème à Noël.')
    expect(await found('CAFE')).toEqual(['note:cafe1'])
    expect(await found('noel creme')).toEqual(['note:cafe1'])
    await note('plain', '# Plain\n\nresume')
    expect(await found('résumé')).toEqual(['note:plain'])
  })

  it('takes each word as a prefix, as you type', async () => {
    await note('n1', '# One\n\nThe payment gateway')
    expect(await found('pay gate')).toEqual(['note:n1'])
    expect(await found('gateways')).toEqual([])
  })

  it('finds a "phrase" exactly, its words in order and whole', async () => {
    await note('a', '# A\n\nthe payment gateway failed')
    await note('b', '# B\n\nthe gateway for payment')
    await note('c', '# C\n\nthe payments gateway')
    expect(await found('"payment gateway"')).toEqual(['note:a'])
  })

  it('does not stem: a word finds itself and longer words, not its other forms', async () => {
    await note('a', '# A\n\nrunning late')
    expect(await found('run')).toEqual(['note:a'])
    expect(await found('runs')).toEqual([])
  })

  it('finds a Reference only as its whole token, in any case', async () => {
    await note('a', '# A\n\nBlocked by PAY-1432 and web/app!809.')
    await note('b', '# B\n\nSee PAY-14320 and web/app!8090 and other/web/app!809.')
    expect(await found('PAY-1432')).toEqual(['note:a'])
    expect(await found('pay-1432')).toEqual(['note:a'])
    expect(await found('web/app!809')).toEqual(['note:a'])
    expect((await found('PAY')).toSorted()).toEqual(['note:a', 'note:b'])
  })

  it('finds a Mention only as its whole token', async () => {
    await note('a', '# A\n\nAsk @alice about it.')
    await note('b', '# B\n\nAsk @alice-b, alice@corp.com or alice.')
    expect(await found('@alice')).toEqual(['note:a'])
    expect((await found('alice')).toSorted()).toEqual(['note:a', 'note:b'])
  })

  it('highlights the match in a snippet of the body', async () => {
    await note('a', '# A\n\nShip the payment gateway on Friday.')
    const [hit] = await searchContent({ text: 'gate' }, options)
    expect(hit!.snippet.filter((piece) => piece.match)).toEqual([{ text: 'gateway', match: true }])
    expect(hit!.snippet.map((piece) => piece.text).join('')).toContain('Ship the payment gateway on Friday.')
  })

  it('reads nothing typed as query syntax', async () => {
    await note('a', '# A\n\nfoo bar')
    expect(await found('foo AND OR NOT ( * : ^ "')).toEqual([])
    expect(await found('foo)')).toEqual(['note:a'])
    expect(await found('   ')).toEqual([])
  })

  it('finds Todos in every state, Sub-todos with their parent, by title or description', async () => {
    await write(
      'todos.json',
      JSON.stringify({
        todos: [
          {
            ...todoItem('open1', 'Fix the invoice export', { description: 'CSV columns are off' }),
            subTodos: [todoItem('sub01', 'Invoice totals', { tags: ['billing'] })],
          },
          { ...todoItem('done1', 'Invoice reminders', { status: 'done', finishedAt: '2026-10-20T10:00:00.000Z' }), subTodos: [] },
          { ...todoItem('drop1', 'Old invoice tool', { status: 'dropped', finishedAt: '2026-10-21T10:00:00.000Z' }), subTodos: [] },
        ],
      }),
    )
    const hits = await searchContent({ text: 'invoice' }, options)
    expect(hits.map((hit) => `${hit.id}:${hit.status}`).toSorted()).toEqual(['done1:done', 'drop1:dropped', 'open1:open', 'sub01:open'])
    expect(hits.find((hit) => hit.id === 'sub01')).toMatchObject({
      kind: 'todo',
      title: 'Invoice totals',
      parentId: 'open1',
      tags: ['billing'],
    })
    expect(hits.find((hit) => hit.id === 'done1')).toMatchObject({ date: '2026-10-20' })
    expect(await found('csv')).toEqual(['todo:open1'])
  })

  it('finds Dev logs and monthly summaries, dated by their day', async () => {
    await write('devlogs/2026-10-14.md', '---\ndate: 2026-10-14\ntags: [infra]\n---\n\n## Done\n\n- Migrated the queue\n')
    await write('devlogs/2026-10.md', '---\nmonth: 2026-10\n---\n\nThe queue migration landed.\n')
    const hits = await searchContent({ text: 'queue' }, options)
    expect(hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'devlog', id: '2026-10-14', title: '2026-10-14', date: '2026-10-14', tags: ['infra'] }),
        expect.objectContaining({ kind: 'devlog', id: '2026-10', title: '2026-10', date: '2026-10-01' }),
      ]),
    )
    expect(hits).toHaveLength(2)
  })

  it('finds Sketches by title and Tags only, not by their diagram', async () => {
    await write('sketches/s1.md', '---\ntitle: Login flow\ntags: [auth]\n---\n\n```mermaid\nflowchart TD\n  token --> session\n```\n')
    expect(await found('login')).toEqual(['sketch:s1'])
    expect(await found('session')).toEqual([])
    expect(await found('', { tags: ['auth'] })).toEqual(['sketch:s1'])
  })

  it('leaves out files it cannot read', async () => {
    await write('notes/broken.md', 'no header gateway')
    await note('ok', '# Ok\n\ngateway')
    expect(await found('gateway')).toEqual(['note:ok'])
  })

  it('ranks by relevance, titles first, and newer first on a tie', async () => {
    await write('devlogs/2026-10-01.md', '---\ndate: 2026-10-01\n---\n\nrollout\n')
    await write('devlogs/2026-10-03.md', '---\ndate: 2026-10-03\n---\n\nrollout\n')
    await write('devlogs/2026-10-02.md', '---\ndate: 2026-10-02\n---\n\nrollout\n')
    expect(await found('rollout')).toEqual(['devlog:2026-10-03', 'devlog:2026-10-02', 'devlog:2026-10-01'])
    await note('body', '# Something\n\nThe rollout went fine, and more words to dilute the rollout a little.')
    await note('title', '---\ntitle: Rollout\n---\n\nnothing')
    expect((await found('rollout', { kinds: ['note'] }))[0]).toBe('note:title')
  })

  it('narrows by kind, by local days and by Tags, all or any', async () => {
    await write('devlogs/2026-10-01.md', '---\ndate: 2026-10-01\ntags: [infra, api]\n---\n\nrelease\n')
    await write('devlogs/2026-10-05.md', '---\ndate: 2026-10-05\ntags: [infra]\n---\n\nrelease\n')
    await write('devlogs/2026-10-09.md', '---\ndate: 2026-10-09\ntags: [web]\n---\n\nrelease\n')
    await note('n', '# Release notes\n\nrelease', ['infra'])
    expect(await found('release', { kinds: ['note'] })).toEqual(['note:n'])
    expect(await found('release', { kinds: ['devlog'], from: '2026-10-02', to: '2026-10-09' })).toEqual([
      'devlog:2026-10-09',
      'devlog:2026-10-05',
    ])
    expect(await found('release', { kinds: ['devlog'], tags: ['infra', 'api'] })).toEqual(['devlog:2026-10-01'])
    expect(await found('release', { kinds: ['devlog'], tags: ['api', 'web'], tagMatch: 'any' })).toEqual([
      'devlog:2026-10-09',
      'devlog:2026-10-01',
    ])
  })

  it('with Tags but no text, lists newest first', async () => {
    await write('devlogs/2026-10-01.md', '---\ndate: 2026-10-01\ntags: [infra]\n---\n\nx\n')
    await write('devlogs/2026-10-05.md', '---\ndate: 2026-10-05\ntags: [infra]\n---\n\ny\n')
    expect(await found('', { tags: ['infra'] })).toEqual(['devlog:2026-10-05', 'devlog:2026-10-01'])
  })

  it('keeps at most `limit` hits of each kind', async () => {
    for (const day of ['01', '02', '03']) await write(`devlogs/2026-10-${day}.md`, `---\ndate: 2026-10-${day}\n---\n\nsame\n`)
    await note('n', '# N\n\nsame')
    expect(await found('same', { limit: 2 })).toEqual(expect.arrayContaining(['devlog:2026-10-03', 'devlog:2026-10-02', 'note:n']))
    expect(await found('same', { limit: 2 })).toHaveLength(3)
  })
})

describe('openSearchIndex', () => {
  it('keeps current from changes: a Note written, changed or removed, and todos.json as a whole', async () => {
    const index = await openSearchIndex({ content: options })
    try {
      await index.rebuild()
      const ids = (text: string) => index.search({ text }).map((hit) => `${hit.kind}:${hit.id}`)
      expect(ids('gateway')).toEqual([])

      await note('n1', '# N\n\ngateway')
      await index.refresh({ kind: 'notes', id: 'n1' })
      expect(ids('gateway')).toEqual(['note:n1'])

      await note('n1', '# N\n\nbridge')
      await index.refresh({ kind: 'notes', id: 'n1' })
      expect(ids('gateway')).toEqual([])
      expect(ids('bridge')).toEqual(['note:n1'])

      await unlink(join(contentRoot, 'notes', 'n1.md'))
      await index.refresh({ kind: 'notes', id: 'n1' })
      expect(ids('bridge')).toEqual([])

      const todo = await addTodo({ title: 'Renew the bridge pass' }, options)
      void index.refresh({ kind: 'todos' })
      await index.idle()
      expect(ids('bridge')).toEqual([`todo:${todo.id}`])
    } finally {
      index.close()
    }
  })

  it('starts from scratch in its file, which lives in the cache folder, outside the content folder', async () => {
    expect(searchIndexPath('/Users/me')).toBe('/Users/me/Library/Caches/ostraka/search.db')
    const file = join(contentRoot, '..', `${contentRoot.split('/').pop()}-cache`, 'search.db')
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, 'not a database')
    await note('n1', '# N\n\ngateway')
    const index = await openSearchIndex({ file, content: options })
    try {
      await index.rebuild()
      expect(index.search({ text: 'gateway' })).toHaveLength(1)
      expect((await readFile(file)).subarray(0, 15).toString()).toBe('SQLite format 3')
    } finally {
      index.close()
      await rm(join(file, '..'), { recursive: true, force: true })
    }
  })
})
