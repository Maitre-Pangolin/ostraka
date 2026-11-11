import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addSubTodo,
  addTodo,
  completeTodo,
  deleteTodo,
  dropTodo,
  dueAfterParent,
  listTodos,
  reopenTodo,
  restoreSubTodo,
  restoreTodo,
  StaleVersionError,
  TodoExistsError,
  TodoInputError,
  TodoNotFoundError,
  TodosFileError,
  todoVersion,
  updateTodo,
  type ContentOptions,
} from '../src/index.ts'

let contentRoot: string
let options: ContentOptions

// Monday 2 November 2026, 09:30 local time.
const NOW = new Date(2026, 10, 2, 9, 30)
const minutesLater = (minutes: number): ContentOptions => ({ ...options, now: () => new Date(NOW.getTime() + minutes * 60_000) })

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  options = { env: { OSTRAKA_HOME: contentRoot }, now: () => NOW }
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
})

const storedTodos = async () => JSON.parse(await readFile(join(contentRoot, 'todos.json'), 'utf8')).todos

describe('addSubTodo', () => {
  it('adds an open Sub-todo under its parent, with its own properties and nothing inherited', async () => {
    const parent = await addTodo({ title: 'Release 2.0 #release *high ^fri', description: 'The big one' }, options)
    const sub = await addSubTodo(parent.id, { title: 'Write the notes' }, options)
    expect(sub).toEqual({
      id: expect.stringMatching(/^[a-z0-9]{5}$/),
      title: 'Write the notes',
      priority: 'none',
      tags: [],
      status: 'open',
      createdAt: NOW.toISOString(),
    })
    expect(await listTodos(options)).toEqual([{ ...parent, subTodos: [sub] }])
  })

  it('keeps Sub-todos in creation order, whatever their priority or due date', async () => {
    const parent = await addTodo({ title: 'Release 2.0' }, options)
    const first = await addSubTodo(parent.id, { title: 'Freeze the branch' }, options)
    const second = await addSubTodo(parent.id, { title: 'Fix the blocker *high ^today' }, minutesLater(1))
    const third = await addSubTodo(parent.id, { title: 'Tag the release ^tomorrow' }, minutesLater(2))
    const [listed] = await listTodos(options)
    expect(listed!.subTodos.map((sub) => sub.id)).toEqual([first.id, second.id, third.id])
  })

  it('refuses a Sub-todo under a Sub-todo, leaving the file as it is', async () => {
    const parent = await addTodo({ title: 'Release 2.0' }, options)
    const sub = await addSubTodo(parent.id, { title: 'Write the notes' }, options)
    const before = await storedTodos()
    await expect(addSubTodo(sub.id, { title: 'Too deep' }, options)).rejects.toThrow(TodoInputError)
    await expect(addSubTodo(sub.id, { title: 'Too deep' }, options)).rejects.toThrow(/Sub-todo can.t have Sub-todos/)
    expect(await storedTodos()).toEqual(before)
  })

  it('reports an unknown parent', async () => {
    await expect(addSubTodo('zzzzz', { title: 'Orphan' }, options)).rejects.toThrow(TodoNotFoundError)
  })

  it('refuses a todos.json or a restored Todo with Sub-todos nested two levels deep', async () => {
    const nested = {
      id: 'paren',
      title: 'Parent',
      priority: 'none',
      tags: [],
      status: 'open',
      createdAt: NOW.toISOString(),
      subTodos: [{ id: 'child', title: 'Child', priority: 'none', tags: [], status: 'open', createdAt: NOW.toISOString(), subTodos: [] }],
    }
    await expect(restoreTodo(nested as never, options)).rejects.toThrow(/subTodos/)
    await writeFile(join(contentRoot, 'todos.json'), JSON.stringify({ todos: [nested] }))
    await expect(listTodos(options)).rejects.toThrow(TodosFileError)
  })
})

describe('a Sub-todo edits and finishes like a Todo', () => {
  it('changes its title, Tags, priority and due date without touching its parent', async () => {
    const parent = await addTodo({ title: 'Release 2.0 #release' }, options)
    const sub = await addSubTodo(parent.id, { title: 'Write the notes' }, options)
    const changed = await updateTodo(sub.id, { title: 'Write the release notes #docs *low ^tomorrow', description: 'In English' }, options)
    expect(changed).toEqual({
      ...sub,
      title: 'Write the release notes',
      description: 'In English',
      tags: ['docs'],
      priority: 'low',
      due: '2026-11-03',
    })
    expect(await listTodos(options)).toEqual([{ ...parent, subTodos: [changed] }])
  })

  it('is marked done, then reopened (Undo), staying in its place under the open parent', async () => {
    const parent = await addTodo({ title: 'Release 2.0' }, options)
    const first = await addSubTodo(parent.id, { title: 'Freeze the branch' }, options)
    const second = await addSubTodo(parent.id, { title: 'Tag the release' }, options)
    const done = await completeTodo(first.id, minutesLater(5))
    expect(done).toEqual({ ...first, status: 'done', finishedAt: new Date(2026, 10, 2, 9, 35).toISOString() })
    expect(await listTodos(options)).toEqual([{ ...parent, subTodos: [done, second] }])
    expect(await reopenTodo(first.id, options)).toEqual(first)
    expect(await listTodos(options)).toEqual([{ ...parent, subTodos: [first, second] }])
  })

  it('is Dropped with a reason', async () => {
    const parent = await addTodo({ title: 'Release 2.0' }, options)
    const sub = await addSubTodo(parent.id, { title: 'Translate the notes' }, options)
    expect(await dropTodo(sub.id, { reason: 'No one reads them' }, options)).toEqual({
      ...sub,
      status: 'dropped',
      dropReason: 'No one reads them',
      finishedAt: NOW.toISOString(),
    })
  })

  it('is deleted, and restored in its creation place (Undo)', async () => {
    const parent = await addTodo({ title: 'Release 2.0' }, options)
    const first = await addSubTodo(parent.id, { title: 'Freeze the branch' }, options)
    const typo = await addSubTodo(parent.id, { title: 'Tpyo' }, minutesLater(1))
    const last = await addSubTodo(parent.id, { title: 'Tag the release' }, minutesLater(2))
    expect(await deleteTodo(typo.id, options)).toEqual(typo)
    expect(await listTodos(options)).toEqual([{ ...parent, subTodos: [first, last] }])
    expect(await restoreSubTodo(parent.id, typo, options)).toEqual(typo)
    expect(await storedTodos()).toEqual([{ ...parent, subTodos: [first, typo, last] }])
  })

  it('refuses to restore a Sub-todo whose id is taken, or under a Sub-todo', async () => {
    const parent = await addTodo({ title: 'Release 2.0' }, options)
    const sub = await addSubTodo(parent.id, { title: 'Freeze the branch' }, options)
    await expect(restoreSubTodo(parent.id, sub, options)).rejects.toThrow(TodoExistsError)
    const deleted = await deleteTodo(sub.id, options)
    const other = await addSubTodo(parent.id, { title: 'Other' }, options)
    await expect(restoreSubTodo(other.id, deleted, options)).rejects.toThrow(TodoInputError)
  })
})

/** A parent with one open Sub-todo, one done and one Dropped before it. */
async function parentWithSubs() {
  const parent = await addTodo({ title: 'Release 2.0' }, options)
  const early = await addSubTodo(parent.id, { title: 'Freeze the branch' }, options)
  const open = await addSubTodo(parent.id, { title: 'Write the notes' }, options)
  const dropped = await addSubTodo(parent.id, { title: 'Translate the notes' }, options)
  const finishedEarly = await completeTodo(early.id, minutesLater(10))
  const droppedEarly = await dropTodo(dropped.id, { reason: 'No one reads them' }, minutesLater(20))
  return { parent, open, finishedEarly, droppedEarly }
}

describe('finishing a parent', () => {
  const later = new Date(2026, 10, 2, 11, 0)

  it('marks its open Sub-todos done with it, leaving finished ones as they were', async () => {
    const { parent, open, finishedEarly, droppedEarly } = await parentWithSubs()
    const done = await completeTodo(parent.id, { ...options, now: () => later })
    const finishedAt = later.toISOString()
    expect(done).toEqual({
      ...parent,
      status: 'done',
      finishedAt,
      subTodos: [finishedEarly, { ...open, status: 'done', finishedAt }, droppedEarly],
    })
    expect(await storedTodos()).toEqual([done])
  })

  it('Drops its open Sub-todos with it, for the same reason', async () => {
    const { parent, open, finishedEarly, droppedEarly } = await parentWithSubs()
    const dropped = await dropTodo(parent.id, { reason: 'Release cancelled' }, { ...options, now: () => later })
    const finishedAt = later.toISOString()
    expect(dropped.status).toBe('dropped')
    expect(await storedTodos()).toEqual([
      {
        ...parent,
        status: 'dropped',
        dropReason: 'Release cancelled',
        finishedAt,
        subTodos: [finishedEarly, { ...open, status: 'dropped', dropReason: 'Release cancelled', finishedAt }, droppedEarly],
      },
    ])
  })

  it.each([
    ['done', (id: string) => completeTodo(id, { ...options, now: () => later })],
    ['Dropped', (id: string) => dropTodo(id, { reason: 'Release cancelled' }, { ...options, now: () => later })],
  ])('reopens, after %s, with the Sub-todos it finished and not the others (Undo)', async (_, finish) => {
    const { parent, open, finishedEarly, droppedEarly } = await parentWithSubs()
    await finish(parent.id)
    const reopened = { ...parent, subTodos: [finishedEarly, open, droppedEarly] }
    expect(await reopenTodo(parent.id, options)).toEqual(reopened)
    expect(await listTodos(options)).toEqual([reopened])
  })
})

describe('dueAfterParent', () => {
  it('warns about an open Sub-todo due after its parent', async () => {
    const parent = await addTodo({ title: 'Release 2.0 ^2026-11-06' }, options)
    const late = await addSubTodo(parent.id, { title: 'Write the notes ^2026-11-09' }, options)
    const onTime = await addSubTodo(parent.id, { title: 'Freeze the branch ^2026-11-06' }, options)
    const undated = await addSubTodo(parent.id, { title: 'Tag the release' }, options)
    expect(dueAfterParent(late, parent)).toBe(true)
    expect(dueAfterParent(onTime, parent)).toBe(false)
    expect(dueAfterParent(undated, parent)).toBe(false)
  })

  it('does not warn when the parent has no due date, or the Sub-todo is finished', async () => {
    const undatedParent = await addTodo({ title: 'Someday' }, options)
    const sub = await addSubTodo(undatedParent.id, { title: 'Write the notes ^2026-11-09' }, options)
    expect(dueAfterParent(sub, undatedParent)).toBe(false)

    const parent = await addTodo({ title: 'Release 2.0 ^2026-11-06' }, options)
    const late = await addSubTodo(parent.id, { title: 'Write the notes ^2026-11-09' }, options)
    expect(dueAfterParent(await completeTodo(late.id, options), parent)).toBe(false)
  })
})

describe('changing a Sub-todo from a loaded copy', () => {
  it('refuses when the Sub-todo changed since it was loaded', async () => {
    const parent = await addTodo({ title: 'Release 2.0' }, options)
    const loaded = await addSubTodo(parent.id, { title: 'Write the notes' }, options)
    await updateTodo(loaded.id, { title: 'Write the notes in English' }, options) // an agent's edit
    const stale = { ...options, ifVersion: todoVersion(loaded) }
    await expect(completeTodo(loaded.id, stale)).rejects.toThrow(StaleVersionError)
    await expect(updateTodo(loaded.id, { priority: 'high' }, stale)).rejects.toThrow(/Sub-todo “Write the notes in English” changed/)
    await expect(deleteTodo(loaded.id, stale)).rejects.toThrow(StaleVersionError)
  })

  it('keeps a parent and its Sub-todos versioned apart, so changing one never makes the other stale', async () => {
    const parent = await addTodo({ title: 'Release 2.0' }, options)
    const sub = await addSubTodo(parent.id, { title: 'Write the notes' }, options)
    const done = await completeTodo(sub.id, { ...options, ifVersion: todoVersion(sub) })
    const renamed = await updateTodo(parent.id, { title: 'Release 2.1' }, { ...options, ifVersion: todoVersion(parent) })
    expect(renamed.title).toBe('Release 2.1')
    expect(await reopenTodo(sub.id, { ...options, ifVersion: todoVersion(done) })).toEqual(sub)
  })
})
