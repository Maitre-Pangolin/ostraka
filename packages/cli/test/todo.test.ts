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

  it('joins several words into one title', async () => {
    const { stdout } = await ostraka('todo', 'add', 'Ship', 'it')
    expect(stdout).toMatch(/ Ship it\n$/)
  })

  it('reports an unknown id', async () => {
    const { code, stderr } = await ostraka('todo', 'done', 'zzzzz')
    expect(code).toBe(1)
    expect(stderr).toMatch(/No Todo with id zzzzz/)
  })

  it.each([[['todo']], [['todo', 'add']], [['todo', 'done']], [['todo', 'frobnicate']]])('shows usage for %j', async (argv) => {
    const { code, stderr } = await ostraka(...argv)
    expect(code).toBe(1)
    expect(stderr).toMatch(/ostraka todo add/)
  })
})
