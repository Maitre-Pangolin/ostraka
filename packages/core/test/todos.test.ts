import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addTodo,
  completeTodo,
  deleteTodo,
  dropTodo,
  listFinishedTodos,
  listTags,
  listTodos,
  type NewTodo,
  reopenTodo,
  restoreTodo,
  TodoExistsError,
  TodoInputError,
  TodoNotFoundError,
  TodosFileError,
  updateTodo,
  type TodoOptions,
} from '../src/index.ts'

let contentRoot: string
let options: TodoOptions

// Monday 2 November 2026, 09:30 local time.
const NOW = new Date(2026, 10, 2, 9, 30)

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  options = { env: { OSTRAKA_HOME: contentRoot }, now: () => NOW }
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
})

const todosFile = () => join(contentRoot, 'todos.json')
const lockFile = () => `${todosFile()}.lock`
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid
const writeLock = (pid: number, createdAt: Date) => writeFile(lockFile(), JSON.stringify({ pid, createdAt: createdAt.toISOString() }))

describe('addTodo', () => {
  it('adds an open Todo with a short random id and a created timestamp', async () => {
    const todo = await addTodo({ title: '  Review the release notes ' }, options)
    expect(todo).toEqual({
      id: expect.stringMatching(/^[a-z0-9]{5}$/),
      title: 'Review the release notes',
      priority: 'none',
      tags: [],
      status: 'open',
      createdAt: NOW.toISOString(),
      subTodos: [],
    })
    expect(await listTodos(options)).toEqual([todo])
  })

  it('writes todos.json formatted, keys in a stable order', async () => {
    const { id } = await addTodo({ title: 'Ship it' }, options)
    expect(await readFile(todosFile(), 'utf8')).toBe(`{
  "todos": [
    {
      "id": "${id}",
      "title": "Ship it",
      "priority": "none",
      "tags": [],
      "status": "open",
      "createdAt": "${NOW.toISOString()}",
      "subTodos": []
    }
  ]
}
`)
  })

  it('rewrites a hand-edited file in the stable key order', async () => {
    await writeFile(
      todosFile(),
      JSON.stringify({
        todos: [
          {
            subTodos: [],
            status: 'open',
            due: '2026-11-05',
            tags: ['infra'],
            createdAt: '2026-11-01T10:00:00.000Z',
            priority: 'high',
            title: 'Old',
            id: 'aaaaa',
          },
        ],
      }),
    )
    await addTodo({ title: 'New' }, options)
    const { todos } = JSON.parse(await readFile(todosFile(), 'utf8')) as { todos: { id: string }[] }
    const old = todos.find((todo) => todo.id === 'aaaaa')
    expect(Object.keys(old ?? {})).toEqual(['id', 'title', 'priority', 'due', 'tags', 'status', 'createdAt', 'subTodos'])
  })

  it('rejects an empty title', async () => {
    await expect(addTodo({ title: '   ' }, options)).rejects.toThrow(/title/i)
  })

  it('turns #tag, *prio and ^date in the title into properties', async () => {
    const todo = await addTodo({ title: 'Fix login #Auth *high ^fri' }, options)
    expect(todo).toMatchObject({ title: 'Fix login', tags: ['auth'], priority: 'high', due: '2026-11-06' })
  })

  it('adds a description, pulling its tokens out too', async () => {
    const todo = await addTodo({ title: 'Fix login #auth', description: 'Users get logged out.\nSee the logs #infra ^today\n' }, options)
    expect(todo).toMatchObject({
      title: 'Fix login',
      description: 'Users get logged out.\nSee the logs',
      tags: ['auth', 'infra'],
      due: '2026-11-02',
    })
  })

  it('leaves out a blank description', async () => {
    expect(await addTodo({ title: 'Ship it', description: ' #infra\n' }, options)).not.toHaveProperty('description')
  })

  it('applies properties already pulled out in quick entry, then the tokens still in the text', async () => {
    const todo = await addTodo({ title: 'Ship it *low #api', tags: ['infra', 'api'], priority: 'high', due: '2026-11-10' }, options)
    expect(todo).toMatchObject({ title: 'Ship it', tags: ['infra', 'api'], priority: 'low', due: '2026-11-10' })
  })

  it('rejects a title that is only tokens', async () => {
    await expect(addTodo({ title: '#auth *high' }, options)).rejects.toThrow(TodoInputError)
  })

  it.each([[{ tags: ['Not A Tag'] }], [{ priority: 'urgent' }], [{ due: '2026-02-30' }]])('rejects %j', async (extra) => {
    await expect(addTodo({ title: 'Ship it', ...extra } as NewTodo, options)).rejects.toThrow(/Tags|Invalid option|real day/)
    await expect(readFile(todosFile())).rejects.toThrow(/ENOENT/)
  })

  it('gives every Todo its own id', async () => {
    const ids = new Set<string>()
    for (let i = 0; i < 20; i++) ids.add((await addTodo({ title: `Todo ${i}` }, options)).id)
    expect(ids.size).toBe(20)
  })
})

type Fixture = { id: string; priority?: string; due?: string; createdAt?: string; status?: string; finishedAt?: string }

async function writeTodos(fixtures: Fixture[]) {
  const todos = fixtures.map(({ id, priority = 'none', due, createdAt = '2026-10-01T10:00:00.000Z', status = 'open', finishedAt }) => ({
    id,
    title: `Todo ${id}`,
    priority,
    ...(due && { due }),
    tags: [],
    status,
    createdAt,
    ...(finishedAt && { finishedAt }),
    subTodos: [],
  }))
  await writeFile(todosFile(), JSON.stringify({ todos }, null, 2))
}

describe('listTodos', () => {
  it('is empty when there is no todos.json yet', async () => {
    expect(await listTodos(options)).toEqual([])
  })

  it('sorts open Todos overdue, due today, priority (none last), due date, newest', async () => {
    await writeTodos([
      { id: 'nopri', createdAt: '2026-10-20T10:00:00.000Z' },
      { id: 'older', createdAt: '2026-10-01T10:00:00.000Z' },
      { id: 'lowpr', priority: 'low' },
      { id: 'medpr', priority: 'medium' },
      { id: 'hilat', priority: 'high', due: '2026-12-01' },
      { id: 'hisoo', priority: 'high', due: '2026-11-04' },
      { id: 'hinod', priority: 'high' },
      { id: 'today', priority: 'low', due: '2026-11-02' },
      { id: 'tdhig', priority: 'high', due: '2026-11-02' },
      { id: 'late1', due: '2026-11-01' },
      { id: 'late2', priority: 'high', due: '2026-10-15' },
      { id: 'donee', status: 'done', finishedAt: '2026-11-01T10:00:00.000Z' },
    ])
    expect((await listTodos(options)).map((todo) => todo.id)).toEqual([
      'late2', // overdue, high
      'late1', // overdue, no priority
      'tdhig', // due today, high
      'today', // due today, low
      'hisoo', // high, due sooner
      'hilat', // high, due later
      'hinod', // high, no due date
      'medpr',
      'lowpr',
      'nopri', // no priority, newer
      'older', // no priority, older
    ])
  })

  it('counts a Todo due yesterday as overdue by the local calendar day', async () => {
    await writeTodos([
      { id: 'hipri', priority: 'high' },
      { id: 'yestr', due: '2026-11-01' },
    ])
    // Five past midnight local: in UTC (behind or ahead) the date may differ, the local day does not.
    expect((await listTodos({ ...options, now: () => new Date(2026, 10, 2, 0, 5) })).map((todo) => todo.id)).toEqual(['yestr', 'hipri'])
  })
})

describe('completeTodo', () => {
  it('marks a Todo done with a finished timestamp and takes it off the open list', async () => {
    const todo = await addTodo({ title: 'Ship it' }, options)
    const later = new Date(2026, 10, 2, 11, 0)
    const done = await completeTodo(todo.id, { ...options, now: () => later })
    expect(done).toEqual({ ...todo, status: 'done', finishedAt: later.toISOString() })
    expect(await listTodos(options)).toEqual([])
    expect(JSON.parse(await readFile(todosFile(), 'utf8')).todos).toEqual([done])
  })

  it('reports an unknown id', async () => {
    await addTodo({ title: 'Ship it' }, options)
    await expect(completeTodo('zzzzz', options)).rejects.toThrow(TodoNotFoundError)
  })
})

describe('writing todos.json', () => {
  it.each([
    ['not JSON', '{"todos": [ {"id": '],
    ['not the schema', JSON.stringify({ todos: [{ id: 'aaaaa', title: '' }] })],
  ])('rejects a file that is %s and leaves it as it is', async (_, text) => {
    await writeFile(todosFile(), text)
    await expect(addTodo({ title: 'Ship it' }, options)).rejects.toThrow(TodosFileError)
    await expect(listTodos(options)).rejects.toThrow(/todos\.json/)
    expect(await readFile(todosFile(), 'utf8')).toBe(text)
  })

  it('leaves no lock or temp file behind', async () => {
    await addTodo({ title: 'Ship it' }, options)
    expect(await readdir(contentRoot)).toEqual(['todos.json'])
  })

  it('keeps every Todo when several are added at once', async () => {
    const titles = Array.from({ length: 10 }, (_, i) => `Todo ${i}`)
    await Promise.all(titles.map((title) => addTodo({ title }, options)))
    expect((await listTodos(options)).map((todo) => todo.title).toSorted()).toEqual(titles)
  })

  it('waits for a lock held by a running process, then gives up naming it', async () => {
    await writeLock(process.pid, new Date())
    await expect(addTodo({ title: 'Ship it' }, { ...options, lock: { timeoutMs: 100 } })).rejects.toThrow(
      new RegExp(`locked by process ${process.pid}`),
    )
    await expect(readFile(todosFile())).rejects.toThrow(/ENOENT/)
  })

  it('writes once a held lock is released', async () => {
    await writeLock(process.pid, new Date())
    setTimeout(() => void rm(lockFile()), 50)
    await addTodo({ title: 'Ship it' }, { ...options, lock: { timeoutMs: 2000 } })
    expect(await listTodos(options)).toHaveLength(1)
  })

  it('takes over a lock left by a process that is gone', async () => {
    await writeLock(deadPid(), new Date())
    await addTodo({ title: 'Ship it' }, { ...options, lock: { timeoutMs: 100 } })
    expect(await readdir(contentRoot)).toEqual(['todos.json'])
  })

  it('takes over a lock older than the stale age', async () => {
    await writeLock(process.pid, new Date(Date.now() - 60_000))
    await addTodo({ title: 'Ship it' }, { ...options, lock: { timeoutMs: 100, staleMs: 30_000 } })
    expect(await readdir(contentRoot)).toEqual(['todos.json'])
  })

  it('releases the lock when a change fails', async () => {
    await addTodo({ title: 'Ship it' }, options)
    await expect(completeTodo('zzzzz', options)).rejects.toThrow(TodoNotFoundError)
    expect(await readdir(contentRoot)).toEqual(['todos.json'])
  })
})

describe('updateTodo', () => {
  it('changes only the fields given', async () => {
    const todo = await addTodo({ title: 'Ship it #infra *low ^fri', description: 'Details' }, options)
    const changed = await updateTodo(todo.id, { title: 'Ship it now', priority: 'high' }, options)
    expect(changed).toEqual({ ...todo, title: 'Ship it now', priority: 'high' })
    expect(await listTodos(options)).toEqual([changed])
  })

  it('applies tokens typed in the title or description to the Todo', async () => {
    const todo = await addTodo({ title: 'Ship it #infra' }, options)
    const changed = await updateTodo(todo.id, { title: 'Ship it today #api ^today', description: 'Check the logs *high' }, options)
    expect(changed).toMatchObject({
      title: 'Ship it today',
      description: 'Check the logs',
      tags: ['infra', 'api'],
      priority: 'high',
      due: '2026-11-02',
    })
  })

  it('removes a Tag, clears the date and the description', async () => {
    const todo = await addTodo({ title: 'Ship it #infra #api ^fri', description: 'Details' }, options)
    const changed = await updateTodo(todo.id, { tags: ['api'], due: null, description: '  ' }, options)
    expect(changed).toEqual({
      id: todo.id,
      title: 'Ship it',
      priority: 'none',
      tags: ['api'],
      status: 'open',
      createdAt: todo.createdAt,
      subTodos: [],
    })
  })

  it('rejects a title that is only tokens and leaves the Todo as it was', async () => {
    const todo = await addTodo({ title: 'Ship it' }, options)
    await expect(updateTodo(todo.id, { title: '#infra' }, options)).rejects.toThrow(TodoInputError)
    expect(await listTodos(options)).toEqual([todo])
  })

  it('reports an unknown id', async () => {
    await expect(updateTodo('zzzzz', { priority: 'high' }, options)).rejects.toThrow(TodoNotFoundError)
  })
})

describe('listTags', () => {
  it('lists every Tag in use once, sorted, from Todos and Sub-todos in any state', async () => {
    await writeFile(
      todosFile(),
      JSON.stringify({
        todos: [
          {
            id: 'aaaaa',
            title: 'Open',
            priority: 'none',
            tags: ['infra', 'api'],
            status: 'open',
            createdAt: '2026-11-01T10:00:00.000Z',
            subTodos: [
              { id: 'bbbbb', title: 'Sub', priority: 'none', tags: ['zz-top'], status: 'open', createdAt: '2026-11-01T10:00:00.000Z' },
            ],
          },
          {
            id: 'ccccc',
            title: 'Done',
            priority: 'none',
            tags: ['auth', 'api'],
            status: 'done',
            createdAt: '2026-11-01T10:00:00.000Z',
            finishedAt: '2026-11-01T11:00:00.000Z',
            subTodos: [],
          },
        ],
      }),
    )
    expect(await listTags(options)).toEqual(['api', 'auth', 'infra', 'zz-top'])
  })

  it('is empty without todos.json', async () => {
    expect(await listTags(options)).toEqual([])
  })
})

describe('reopenTodo', () => {
  it('puts a done Todo back on the open list as it was (Undo)', async () => {
    const todo = await addTodo({ title: 'Ship it' }, options)
    await completeTodo(todo.id, options)
    expect(await reopenTodo(todo.id, options)).toEqual(todo)
    expect(await listTodos(options)).toEqual([todo])
  })
})

describe('dropTodo', () => {
  const later = new Date(2026, 10, 2, 11, 0)

  it('Drops a Todo with a reason and a finished timestamp, taking it off the open list', async () => {
    const todo = await addTodo({ title: 'Migrate the old CI' }, options)
    const dropped = await dropTodo(todo.id, { reason: '  Superseded by the new pipeline ' }, { ...options, now: () => later })
    expect(dropped).toEqual({ ...todo, status: 'dropped', dropReason: 'Superseded by the new pipeline', finishedAt: later.toISOString() })
    expect(await listTodos(options)).toEqual([])
    expect(JSON.parse(await readFile(todosFile(), 'utf8')).todos).toEqual([dropped])
  })

  it.each([[{}], [{ reason: '   ' }]])('Drops without a reason when it is skipped (%j)', async (input) => {
    const todo = await addTodo({ title: 'Migrate the old CI' }, options)
    const dropped = await dropTodo(todo.id, input, { ...options, now: () => later })
    expect(dropped).toEqual({ ...todo, status: 'dropped', finishedAt: later.toISOString() })
  })

  it('reopens a Dropped Todo as it was, clearing the reason and finished timestamp (Undo)', async () => {
    const todo = await addTodo({ title: 'Migrate the old CI' }, options)
    await dropTodo(todo.id, { reason: 'Not needed' }, options)
    expect(await reopenTodo(todo.id, options)).toEqual(todo)
    expect(await listTodos(options)).toEqual([todo])
  })

  it('reports an unknown id', async () => {
    await expect(dropTodo('zzzzz', {}, options)).rejects.toThrow(TodoNotFoundError)
  })
})

describe('deleteTodo', () => {
  it('removes a Todo for good and returns it', async () => {
    const keep = await addTodo({ title: 'Keep me' }, options)
    const mistake = await addTodo({ title: 'Typo' }, options)
    expect(await deleteTodo(mistake.id, options)).toEqual(mistake)
    expect(await listTodos(options)).toEqual([keep])
    expect(JSON.parse(await readFile(todosFile(), 'utf8')).todos).toEqual([keep])
  })

  it('reports an unknown id', async () => {
    await expect(deleteTodo('zzzzz', options)).rejects.toThrow(TodoNotFoundError)
  })
})

describe('restoreTodo', () => {
  it('puts a deleted Todo back exactly as it was (Undo)', async () => {
    const todo = await addTodo({ title: 'Typo' }, options)
    const dropped = await dropTodo(todo.id, { reason: 'Not needed' }, options)
    await deleteTodo(todo.id, options)
    expect(await restoreTodo(dropped, options)).toEqual(dropped)
    expect(JSON.parse(await readFile(todosFile(), 'utf8')).todos).toEqual([dropped])
  })

  it('refuses a Todo whose id is already taken, leaving the file as it is', async () => {
    const todo = await addTodo({ title: 'Ship it' }, options)
    const before = await readFile(todosFile(), 'utf8')
    await expect(restoreTodo({ ...todo, title: 'Other' }, options)).rejects.toThrow(TodoExistsError)
    expect(await readFile(todosFile(), 'utf8')).toBe(before)
  })

  it('refuses something that is not a Todo', async () => {
    await expect(restoreTodo({ id: 'aaaaa', title: '' } as never, options)).rejects.toThrow(/title/i)
  })
})

// A moment in November 2026, local time.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString()

describe('listFinishedTodos', () => {
  it('lists done and Dropped Todos, newest-finished first, kept however old', async () => {
    await writeTodos([
      { id: 'open1' },
      { id: 'done1', status: 'done', finishedAt: at(1, 10) },
      { id: 'drop1', status: 'dropped', finishedAt: at(2, 9) },
      { id: 'done2', status: 'done', finishedAt: '2024-01-05T10:00:00.000Z' },
      { id: 'done3', status: 'done', finishedAt: at(2, 8) },
    ])
    expect((await listFinishedTodos({}, options)).map((todo) => todo.id)).toEqual(['drop1', 'done3', 'done1', 'done2'])
  })

  it('narrows to Todos finished on one local day, done and Dropped alike', async () => {
    await writeTodos([
      { id: 'early', status: 'done', finishedAt: at(2, 0, 5) },
      { id: 'drops', status: 'dropped', finishedAt: at(2, 17) },
      { id: 'lates', status: 'done', finishedAt: at(2, 23, 55) },
      { id: 'yestr', status: 'done', finishedAt: at(1, 23, 55) },
      { id: 'tomor', status: 'dropped', finishedAt: at(3, 0, 5) },
      { id: 'still' },
    ])
    expect((await listFinishedTodos({ finishedOn: '2026-11-02' }, options)).map((todo) => todo.id)).toEqual(['lates', 'drops', 'early'])
  })

  it('rejects a day that is not YYYY-MM-DD', async () => {
    await expect(listFinishedTodos({ finishedOn: '2/11/2026' }, options)).rejects.toThrow(/YYYY-MM-DD/)
    await expect(listFinishedTodos({ finishedOn: '2026-02-30' }, options)).rejects.toThrow(/real day/)
  })
})
