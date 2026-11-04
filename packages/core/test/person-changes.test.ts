import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addPerson,
  addSubTodo,
  addTodo,
  createNote,
  dropTodo,
  getPerson,
  listPeople,
  listStubPeople,
  mergePerson,
  PersonChangeError,
  personMentions,
  PersonExistsError,
  PersonNotFoundError,
  readNote,
  renamePerson,
  updateNote,
  type TodoOptions,
} from '../src/index.ts'

let contentRoot: string
let options: TodoOptions

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  options = { env: { OSTRAKA_HOME: contentRoot } }
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
})

const DEVLOG =
  '---\ndate: 2026-11-02\ntags: []\nsources: []\n---\n\n## Done\n\n- Paired with @milena-s on the import, then @milena-s again.\n'

/** A Todo with a Sub-todo, a dropped Todo, a Note and a Dev log, mentioning the stub `milena-s` 7 times in all. */
async function mentionEverywhere() {
  const todo = await addTodo({ title: 'Ask @milena-s about the import', description: 'cc @bram' }, options)
  await addSubTodo(todo.id, { title: 'Send @milena-s the logs' }, options)
  const dropped = await addTodo({ title: 'Old thing' }, options)
  await dropTodo(dropped.id, { reason: '@milena-s took it' }, options)
  const note = await createNote({ title: 'Import' }, options)
  await updateNote(note.id, { body: '# Import\n\n@milena-s and @milena-sx disagree; @milena-s wins.\n' }, options)
  await mkdir(join(contentRoot, 'devlogs'), { recursive: true })
  await writeFile(join(contentRoot, 'devlogs', '2026-11-02.md'), DEVLOG)
  return { note }
}

const counts = (uses: { count: number }[]) => uses.map((use) => use.count)

describe('listStubPeople', () => {
  it('lists the Persons with no email who are not ignored', async () => {
    await addPerson({ id: 'milena-s', name: 'Milena S' }, options)
    await addPerson({ name: 'Bram Okonkwo', email: 'bram@corp.example' }, options)
    await addPerson({ name: 'Quentin Ignored', ignored: true }, options)
    expect((await listStubPeople(options)).map((person) => person.id)).toEqual(['milena-s'])
  })
})

describe('personMentions', () => {
  it('counts the Mentions of a Person in each Todo, Note and Dev log file', async () => {
    const { note } = await mentionEverywhere()
    expect(await personMentions('milena-s', options)).toEqual([
      { file: 'todos.json', count: 3 },
      { file: `notes/${note.id}.md`, count: 2 },
      { file: 'devlogs/2026-11-02.md', count: 2 },
    ])
    expect(await personMentions('nobody', options)).toEqual([])
  })
})

describe('renamePerson', () => {
  it('gives a Person a new id and name, keeps the old name as an alias, and rewrites every Mention', async () => {
    await addPerson({ id: 'milena-s', name: 'Milena S' }, options)
    const { note } = await mentionEverywhere()

    const changed = await renamePerson('milena-s', { id: 'milena-senechal', name: 'Milena Sénéchal' }, options)

    expect(changed).toEqual([
      { file: 'todos.json', count: 3 },
      { file: `notes/${note.id}.md`, count: 2 },
      { file: 'devlogs/2026-11-02.md', count: 2 },
    ])
    expect(await listPeople(options)).toEqual([{ id: 'milena-senechal', name: 'Milena Sénéchal', aliases: ['Milena S'] }])
    const todos = await readFile(join(contentRoot, 'todos.json'), 'utf8')
    expect(todos).not.toContain('@milena-s ')
    expect(todos.match(/@milena-senechal/g)).toHaveLength(3)
    expect(todos).toContain('cc @bram')
    expect(await readNote(note.id, options)).toMatchObject({
      body: '# Import\n\n@milena-senechal and @milena-sx disagree; @milena-senechal wins.\n',
    })
    expect(await readFile(join(contentRoot, 'devlogs', '2026-11-02.md'), 'utf8')).toBe(DEVLOG.replaceAll('@milena-s ', '@milena-senechal '))
    expect(await personMentions('milena-s', options)).toEqual([])
  })

  it('with dryRun, checks and counts but writes nothing', async () => {
    await addPerson({ id: 'milena-s', name: 'Milena S' }, options)
    await addPerson({ name: 'Bram Okonkwo' }, options)
    await mentionEverywhere()
    const before = await readFile(join(contentRoot, 'todos.json'), 'utf8')
    expect(counts(await renamePerson('milena-s', { id: 'milena-senechal' }, { ...options, dryRun: true }))).toEqual([3, 2, 2])
    expect(counts(await mergePerson('milena-s', 'bram-okonkwo', { ...options, dryRun: true }))).toEqual([3, 2, 2])
    await expect(renamePerson('milena-s', { id: 'bram-okonkwo' }, { ...options, dryRun: true })).rejects.toThrow(PersonExistsError)
    expect(await readFile(join(contentRoot, 'todos.json'), 'utf8')).toBe(before)
    expect((await listPeople(options)).map((person) => person.id)).toEqual(['bram-okonkwo', 'milena-s'])
  })

  it('keeps the name when none is given', async () => {
    await addPerson({ id: 'milena-s', name: 'Milena S' }, options)
    await renamePerson('milena-s', { id: 'milena' }, options)
    expect(await getPerson('milena', options)).toEqual({ id: 'milena', name: 'Milena S', aliases: [] })
  })

  it('refuses an id another Person has, or a Person not in the directory, before rewriting anything', async () => {
    await addPerson({ id: 'milena-s', name: 'Milena S' }, options)
    await addPerson({ name: 'Bram Okonkwo' }, options)
    await mentionEverywhere()
    await expect(renamePerson('milena-s', { id: 'bram-okonkwo' }, options)).rejects.toThrow(PersonExistsError)
    await expect(renamePerson('nobody', { id: 'somebody' }, options)).rejects.toThrow(PersonNotFoundError)
    expect(await personMentions('milena-s', options)).toHaveLength(3)
  })
})

describe('mergePerson', () => {
  it('rewrites the Mentions into the other Person, adds the name as an alias and fills only identities it lacks', async () => {
    await addPerson({ id: 'milena-s', name: 'Milena S', aliases: ['Mili'], slackHandle: 'mili', gitlabUsername: 'msx' }, options)
    await addPerson({ name: 'Milena Sénéchal', email: 'milena@corp.example', gitlabUsername: 'msenechal' }, options)
    const { note } = await mentionEverywhere()

    const changed = await mergePerson('milena-s', 'milena-senechal', options)

    expect(changed).toEqual([
      { file: 'todos.json', count: 3 },
      { file: `notes/${note.id}.md`, count: 2 },
      { file: 'devlogs/2026-11-02.md', count: 2 },
    ])
    expect(await listPeople(options)).toEqual([
      {
        id: 'milena-senechal',
        name: 'Milena Sénéchal',
        aliases: ['Milena S', 'Mili'],
        email: 'milena@corp.example',
        slackHandle: 'mili',
        gitlabUsername: 'msenechal',
      },
    ])
    expect(await personMentions('milena-s', options)).toEqual([])
    expect((await personMentions('milena-senechal', options)).map((use) => use.count)).toEqual([3, 2, 2])
  })

  it('refuses merging a Person into itself or into someone not in the directory', async () => {
    await addPerson({ id: 'milena-s', name: 'Milena S' }, options)
    await expect(mergePerson('milena-s', 'milena-s', options)).rejects.toThrow(PersonChangeError)
    await expect(mergePerson('milena-s', 'nobody', options)).rejects.toThrow(PersonNotFoundError)
    expect(await getPerson('milena-s', options)).toMatchObject({ name: 'Milena S' })
  })
})
