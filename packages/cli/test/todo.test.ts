import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run } from '../src/main.ts'

let contentRoot: string

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
})

async function ostraka(...argv: string[]) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, {
    env: { OSTRAKA_HOME: contentRoot },
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  })
  return { code, stdout, stderr }
}

const idOf = (stdout: string) => /\b([a-z0-9]{5})\b/.exec(stdout)?.[1] ?? ''

describe('ostraka todo', () => {
  it('adds, lists and marks done', async () => {
    const added = await ostraka('todo', 'add', 'Review the release notes')
    expect(added).toMatchObject({ code: 0, stderr: '' })
    const id = idOf(added.stdout)
    expect(added.stdout).toBe(`Added ${id}  Review the release notes\n`)

    expect(await ostraka('todo', 'list')).toEqual({ code: 0, stdout: `${id}  Review the release notes\n`, stderr: '' })

    expect(await ostraka('todo', 'done', id)).toEqual({ code: 0, stdout: `Done ${id}  Review the release notes\n`, stderr: '' })
    expect(await ostraka('todo', 'list')).toEqual({ code: 0, stdout: 'No open Todos.\n', stderr: '' })
  })

  it('prints JSON with --json', async () => {
    const added = await ostraka('todo', 'add', 'Ship it', '--json')
    const todo = JSON.parse(added.stdout)
    expect(todo).toMatchObject({ id: expect.stringMatching(/^[a-z0-9]{5}$/), title: 'Ship it', status: 'open' })

    expect(JSON.parse((await ostraka('todo', 'list', '--json')).stdout)).toEqual([todo])

    const done = JSON.parse((await ostraka('todo', 'done', todo.id, '--json')).stdout)
    expect(done).toMatchObject({ id: todo.id, status: 'done', finishedAt: expect.any(String) })
    expect(JSON.parse((await ostraka('todo', 'list', '--json')).stdout)).toEqual([])
  })

  it('turns #tag, *prio and ^date into properties, and prints them back as tokens', async () => {
    const added = await ostraka('todo', 'add', 'Fix login #Auth *high ^2026-11-05', '--json')
    expect(JSON.parse(added.stdout)).toMatchObject({ title: 'Fix login', tags: ['auth'], priority: 'high', due: '2026-11-05' })

    const { stdout } = await ostraka('todo', 'list')
    expect(stdout).toMatch(/^[a-z0-9]{5} {2}Fix login {2}#auth \*high \^2026-11-05\n$/)
  })

  it('keeps MR and Jira References as plain tokens in the title, and prints them back', async () => {
    const added = await ostraka('todo', 'add', 'Rebase acme/pay/api!809 for PAY-1432 #review', '--json')
    expect(JSON.parse(added.stdout)).toMatchObject({ title: 'Rebase acme/pay/api!809 for PAY-1432', tags: ['review'] })

    const { stdout } = await ostraka('todo', 'list')
    expect(stdout).toMatch(/^[a-z0-9]{5} {2}Rebase acme\/pay\/api!809 for PAY-1432 {2}#review\n$/)
  })

  it('reads ^fri as the next Friday', async () => {
    const { due } = JSON.parse((await ostraka('todo', 'add', 'Fix login', '^fri', '--json')).stdout) as { due: string }
    expect(new Date(`${due}T00:00:00Z`).getUTCDay()).toBe(5)
  })

  it('refuses a title that is only tokens', async () => {
    const { code, stderr } = await ostraka('todo', 'add', '#auth')
    expect(code).toBe(1)
    expect(stderr).toMatch(/needs a title/)
  })

  it('Drops a Todo with or without a reason', async () => {
    const first = idOf((await ostraka('todo', 'add', 'Migrate the old CI')).stdout)
    const second = idOf((await ostraka('todo', 'add', 'Write the RFC')).stdout)

    expect(await ostraka('todo', 'drop', first, '--reason', 'Superseded')).toEqual({
      code: 0,
      stdout: `Dropped ${first}  Migrate the old CI (Superseded)\n`,
      stderr: '',
    })
    const dropped = JSON.parse((await ostraka('todo', 'drop', second, '--json')).stdout)
    expect(dropped).toMatchObject({ id: second, status: 'dropped', finishedAt: expect.any(String) })
    expect(dropped).not.toHaveProperty('dropReason')
    expect((await ostraka('todo', 'list')).stdout).toBe('No open Todos.\n')
  })

  it('lists the Todos finished on a day, done and Dropped', async () => {
    const done = idOf((await ostraka('todo', 'add', 'Ship it')).stdout)
    const dropped = idOf((await ostraka('todo', 'add', 'Migrate the old CI')).stdout)
    await ostraka('todo', 'add', 'Still open')
    await ostraka('todo', 'done', done)
    await ostraka('todo', 'drop', dropped, '--reason', 'Superseded')

    const today = new Date().toLocaleDateString('sv') // YYYY-MM-DD, local
    const finished = JSON.parse((await ostraka('todo', 'list', '--finished-on', today, '--json')).stdout)
    expect(finished).toEqual([
      expect.objectContaining({ id: dropped, status: 'dropped', dropReason: 'Superseded' }),
      expect.objectContaining({ id: done, status: 'done' }),
    ])
    expect((await ostraka('todo', 'list', '--finished-on', today)).stdout).toBe(
      `${dropped}  Migrate the old CI (Dropped: Superseded)\n${done}  Ship it (done)\n`,
    )
    expect(await ostraka('todo', 'list', '--finished-on', '2020-01-01')).toEqual({
      code: 0,
      stdout: 'No Todos finished on 2020-01-01.\n',
      stderr: '',
    })
  })

  it('rejects a --finished-on that is not a day', async () => {
    expect(await ostraka('todo', 'list', '--finished-on', 'yesterday')).toEqual({
      code: 1,
      stdout: '',
      stderr: 'Expected a day as YYYY-MM-DD\n',
    })
  })

  it('adds a Sub-todo under a parent id, listed indented under it in creation order', async () => {
    const parent = idOf((await ostraka('todo', 'add', 'Release 2.0', '*high')).stdout)
    const added = await ostraka('todo', 'add', 'Write the notes #docs', '--parent', parent)
    expect(added).toMatchObject({ code: 0, stderr: '' })
    const first = idOf(added.stdout)
    expect(added.stdout).toBe(`Added ${first}  Write the notes  #docs (Sub-todo of ${parent})\n`)
    const second = JSON.parse((await ostraka('todo', 'add', 'Tag the release', '--parent', parent, '--json')).stdout)
    expect(second).toMatchObject({ title: 'Tag the release', priority: 'none', tags: [], status: 'open' })
    expect(second).not.toHaveProperty('subTodos')

    await ostraka('todo', 'done', first)
    expect((await ostraka('todo', 'list')).stdout).toBe(
      `${parent}  Release 2.0  *high\n  ${first}  Write the notes  #docs (done)\n  ${second.id}  Tag the release\n`,
    )
  })

  it('refuses a Sub-todo under a Sub-todo', async () => {
    const parent = idOf((await ostraka('todo', 'add', 'Release 2.0')).stdout)
    const sub = idOf((await ostraka('todo', 'add', 'Write the notes', '--parent', parent)).stdout)
    expect(await ostraka('todo', 'add', 'Too deep', '--parent', sub)).toEqual({
      code: 1,
      stdout: '',
      stderr: 'A Sub-todo can’t have Sub-todos of its own\n',
    })
  })

  it('joins several words into one title', async () => {
    const { stdout } = await ostraka('todo', 'add', 'Ship', 'it')
    expect(stdout).toMatch(/ Ship it\n$/)
  })

  it('reports an unknown id', async () => {
    const { code, stderr } = await ostraka('todo', 'done', 'zzzzz')
    expect(code).toBe(1)
    expect(stderr).toMatch(/No Todo with id zzzzz/)
  })

  it.each([[['todo']], [['todo', 'add']], [['todo', 'done']], [['todo', 'drop']], [['todo', 'frobnicate']]])(
    'shows usage for %j',
    async (argv) => {
      const { code, stderr } = await ostraka(...argv)
      expect(code).toBe(1)
      expect(stderr).toMatch(/ostraka todo add/)
    },
  )
})
