import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  deleteTag,
  mergeTag,
  renameTag,
  setTagColor,
  TagExistsError,
  TagNameError,
  TagNotFoundError,
  TagsFileError,
  tagUsage,
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

const file = (path: string) => join(contentRoot, path)
const write = async (path: string, text: string) => {
  await mkdir(join(file(path), '..'), { recursive: true })
  await writeFile(file(path), text)
}
const read = (path: string) => readFile(file(path), 'utf8')

const item = (id: string, tags: string[], extra: object = {}) => ({
  id,
  title: id,
  priority: 'none',
  tags,
  status: 'open',
  createdAt: '2026-10-01T10:00:00.000Z',
  ...extra,
})

/** A Todo, its Sub-todo and a done Todo, a Note, a Dev log day, a monthly summary and a Sketch, most tagged `infra`. */
async function writeContent() {
  await write(
    'todos.json',
    JSON.stringify({
      todos: [
        { ...item('aaaaa', ['infra', 'api']), subTodos: [item('bbbbb', ['infra'])] },
        { ...item('ccccc', ['api', 'infra'], { status: 'done', finishedAt: '2026-10-02T10:00:00.000Z' }), subTodos: [] },
        { ...item('ddddd', ['api']), subTodos: [] },
      ],
    }),
  )
  await write('notes/plan.md', '---\ntitle: Plan  # mine\ntags: [infra, idea]\n---\n\n# Plan\n')
  await write('devlogs/2026-10-29.md', '---\ndate: 2026-10-29\ntags: [infra]\nsources: [gitlab]\n---\n\n## Done\n\n- One\n')
  await write('devlogs/2026-10.md', '---\nmonth: 2026-10\ntags:\n  - billing\n  - infra\n---\n\nA month.\n')
  await write('sketches/flow.md', '---\ntitle: Flow\ntags: [infra]\n---\n\n```mermaid\nflowchart LR\n  a --> b\n```\n')
}

describe('tagUsage', () => {
  it('lists each Tag in use with its colour and how many Todos, Notes, Dev logs and Sketches use it', async () => {
    await writeContent()
    await write('tags.yml', 'infra:\n  color: teal\n')
    expect(await tagUsage(options)).toEqual([
      { name: 'api', color: 'green', uses: { todos: 3, notes: 0, devlogs: 0, sketches: 0 } },
      { name: 'billing', color: 'yellow', uses: { todos: 0, notes: 0, devlogs: 1, sketches: 0 } },
      { name: 'idea', color: 'teal', uses: { todos: 0, notes: 1, devlogs: 0, sketches: 0 } },
      { name: 'infra', color: 'teal', uses: { todos: 3, notes: 1, devlogs: 2, sketches: 1 } },
    ])
  })

  it('is empty when nothing is tagged', async () => {
    expect(await tagUsage(options)).toEqual([])
  })
})

const todoTags = async () =>
  Object.fromEntries(
    (JSON.parse(await read('todos.json')) as { todos: { id: string; tags: string[]; subTodos: { id: string; tags: string[] }[] }[] }).todos
      .flatMap((todo) => [todo, ...todo.subTodos])
      .map((todo) => [todo.id, todo.tags]),
  )

describe('renameTag', () => {
  it('rewrites every Todo and Sub-todo, and the tags line of every Note, Dev log and Sketch, in one operation', async () => {
    await writeContent()
    const changed = await renameTag('infra', 'platform', options)
    expect(changed).toEqual({ todos: 3, notes: 1, devlogs: 2, sketches: 1 })
    expect(await todoTags()).toEqual({ aaaaa: ['platform', 'api'], bbbbb: ['platform'], ccccc: ['api', 'platform'], ddddd: ['api'] })
    // Only the tags line changes; comments, other fields and the body stay byte-for-byte.
    expect(await read('notes/plan.md')).toBe('---\ntitle: Plan  # mine\ntags: [platform, idea]\n---\n\n# Plan\n')
    expect(await read('devlogs/2026-10-29.md')).toBe(
      '---\ndate: 2026-10-29\ntags: [platform]\nsources: [gitlab]\n---\n\n## Done\n\n- One\n',
    )
    expect(await read('devlogs/2026-10.md')).toBe('---\nmonth: 2026-10\ntags: [billing, platform]\n---\n\nA month.\n')
    expect(await read('sketches/flow.md')).toBe('---\ntitle: Flow\ntags: [platform]\n---\n\n```mermaid\nflowchart LR\n  a --> b\n```\n')
    expect((await tagUsage(options)).map((tag) => tag.name)).toEqual(['api', 'billing', 'idea', 'platform'])
  })

  it('carries the Tag’s colour over to its new name', async () => {
    await writeContent()
    await write('tags.yml', '# Tag colours\ninfra:\n  color: teal\napi:\n  color: red\n')
    await renameTag('infra', 'platform', options)
    expect(await read('tags.yml')).toBe('# Tag colours\napi:\n  color: red\nplatform:\n  color: teal\n')
  })

  it('takes the new name as typed: lowercased, without its #', async () => {
    await writeContent()
    await renameTag('infra', '#Platform', options)
    expect((await tagUsage(options)).map((tag) => tag.name)).toContain('platform')
  })

  it('refuses a name already in use (that is a merge), a Tag not in use, and a name that is not a Tag', async () => {
    await writeContent()
    await expect(renameTag('infra', 'api', options)).rejects.toThrow(TagExistsError)
    await expect(renameTag('nope', 'other', options)).rejects.toThrow(TagNotFoundError)
    await expect(renameTag('infra', '%%', options)).rejects.toThrow(TagNameError)
    expect(await read('notes/plan.md')).toContain('tags: [infra, idea]')
  })

  it('leaves a file with a broken header alone', async () => {
    await writeContent()
    await write('notes/broken.md', '---\ntags: [infra\n---\n')
    await renameTag('infra', 'platform', options)
    expect(await read('notes/broken.md')).toBe('---\ntags: [infra\n---\n')
  })
})

describe('mergeTag', () => {
  it('rewrites every Todo onto the other Tag, keeping it once where both were', async () => {
    await writeContent()
    const changed = await mergeTag('api', 'infra', options)
    expect(changed).toEqual({ todos: 3, notes: 0, devlogs: 0, sketches: 0 })
    expect(await todoTags()).toEqual({ aaaaa: ['infra'], bbbbb: ['infra'], ccccc: ['infra'], ddddd: ['infra'] })
    expect((await tagUsage(options)).map((tag) => tag.name)).toEqual(['billing', 'idea', 'infra'])
  })

  it('merges in Note, Dev log and Sketch headers too', async () => {
    await writeContent()
    expect(await mergeTag('billing', 'infra', options)).toEqual({ todos: 0, notes: 0, devlogs: 1, sketches: 0 })
    expect(await read('devlogs/2026-10.md')).toBe('---\nmonth: 2026-10\ntags: [infra]\n---\n\nA month.\n')
    expect(await mergeTag('infra', 'idea', options)).toEqual({ todos: 3, notes: 1, devlogs: 2, sketches: 1 })
    expect(await read('notes/plan.md')).toBe('---\ntitle: Plan  # mine\ntags: [idea]\n---\n\n# Plan\n')
    expect(await read('sketches/flow.md')).toContain('\ntags: [idea]\n')
  })

  it('keeps the colour of the Tag merged into and drops the other’s', async () => {
    await writeContent()
    await write('tags.yml', 'api:\n  color: red\ninfra:\n  color: teal\n')
    await mergeTag('api', 'infra', options)
    expect(await read('tags.yml')).toBe('infra:\n  color: teal\n')
  })

  it('refuses merging a Tag into itself or a Tag not in use', async () => {
    await writeContent()
    await expect(mergeTag('api', 'api', options)).rejects.toThrow(TagNameError)
    await expect(mergeTag('nope', 'api', options)).rejects.toThrow(TagNotFoundError)
  })
})

describe('deleteTag', () => {
  it('removes the Tag from every Todo, Note, Dev log and Sketch, and its colour', async () => {
    await writeContent()
    await write('tags.yml', 'infra:\n  color: teal\n')
    expect(await deleteTag('infra', options)).toEqual({ todos: 3, notes: 1, devlogs: 2, sketches: 1 })
    expect(await todoTags()).toEqual({ aaaaa: ['api'], bbbbb: [], ccccc: ['api'], ddddd: ['api'] })
    expect(await read('notes/plan.md')).toBe('---\ntitle: Plan  # mine\ntags: [idea]\n---\n\n# Plan\n')
    expect(await read('devlogs/2026-10-29.md')).toBe('---\ndate: 2026-10-29\ntags: []\nsources: [gitlab]\n---\n\n## Done\n\n- One\n')
    expect(await read('tags.yml')).toBe('')
    expect((await tagUsage(options)).map((tag) => tag.name)).toEqual(['api', 'billing', 'idea'])
  })

  it('refuses a Tag not in use', async () => {
    await expect(deleteTag('nope', options)).rejects.toThrow(TagNotFoundError)
  })
})

describe('setTagColor', () => {
  it('saves the colour to tags.yml, keeping the other entries and comments', async () => {
    await writeContent()
    await write('tags.yml', '# Tag colours\napi:\n  color: red\n')
    await setTagColor('infra', 'violet', options)
    expect(await read('tags.yml')).toBe('# Tag colours\napi:\n  color: red\ninfra:\n  color: violet\n')
    await setTagColor('api', 'blue', options)
    expect(await read('tags.yml')).toBe('# Tag colours\napi:\n  color: blue\ninfra:\n  color: violet\n')
    expect((await tagUsage(options)).find((tag) => tag.name === 'infra')?.color).toBe('violet')
  })

  it('goes back to the colour the name hashes to when cleared', async () => {
    await writeContent()
    await setTagColor('infra', 'violet', options)
    await setTagColor('infra', undefined, options)
    expect(await read('tags.yml')).toBe('')
    expect((await tagUsage(options)).find((tag) => tag.name === 'infra')?.color).toBe('orange')
  })

  it('creates tags.yml when there is none, and refuses a colour that is not one of the eight', async () => {
    await writeContent()
    await setTagColor('api', 'pink', options)
    expect(await read('tags.yml')).toBe('api:\n  color: pink\n')
    await expect(setTagColor('api', 'mauve' as never, options)).rejects.toThrow(TagsFileError)
  })
})
