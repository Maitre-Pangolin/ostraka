import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createNote,
  listNotes,
  MarkdownFileError,
  MarkdownFileNotFoundError,
  readNote,
  StaleVersionError,
  updateNote,
  type Note,
  type NoteOptions,
} from '../src/index.ts'

let contentRoot: string
let options: NoteOptions

beforeEach(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'ostraka-content-'))
  options = { env: { OSTRAKA_HOME: contentRoot } }
})

afterEach(async () => {
  await rm(contentRoot, { recursive: true, force: true })
})

const noteFile = (id: string) => join(contentRoot, 'notes', `${id}.md`)
const writeNote = async (id: string, text: string) => {
  await mkdir(join(contentRoot, 'notes'), { recursive: true })
  await writeFile(noteFile(id), text)
}

describe('createNote', () => {
  it('writes notes/<id>.md with a YAML header and a title heading, and lists it', async () => {
    const note = await createNote({ title: 'Release plan', tags: ['idea'] }, options)
    expect(note).toMatchObject({ id: expect.stringMatching(/^[a-z0-9]{5}$/), title: 'Release plan', tags: ['idea'] })
    expect(await readFile(noteFile(note.id), 'utf8')).toBe('---\ntags: [idea]\n---\n\n# Release plan\n')
    expect(await listNotes(options)).toEqual([
      { id: note.id, version: note.version, title: 'Release plan', tags: ['idea'], modifiedAt: expect.any(String) },
    ])
  })

  it('starts a Note with no title with an empty body, titled by its id', async () => {
    const note = await createNote({}, options)
    expect(note).toMatchObject({ title: note.id, tags: [], body: '' })
    expect(await readFile(noteFile(note.id), 'utf8')).toBe('---\ntags: []\n---\n')
  })
})

describe('listNotes', () => {
  it('lists no Notes before there is a notes folder', async () => {
    expect(await listNotes(options)).toEqual([])
  })

  it('titles a Note from its header, else its first heading, else its id', async () => {
    await writeNote('a', '---\ntitle: From the header\ntags: []\n---\n# From the heading\n')
    await writeNote('b', '---\ntags: [work]\n---\n\nSome text\n\n# From the heading\n')
    await writeNote('c', '---\n---\nNo heading\n')
    const titles = Object.fromEntries((await listNotes(options)).map((note) => [note.id, 'title' in note ? note.title : note.error]))
    expect(titles).toEqual({ a: 'From the header', b: 'From the heading', c: 'c' })
  })

  it('lists a Note with a broken header with its error, beside the good ones', async () => {
    await writeNote('good', '---\ntags: [work]\n---\nFine\n')
    await writeNote('bad-yaml', '---\ntags: [work\n---\nOops\n')
    await writeNote('bad-tag', '---\ntags: [Not A Tag]\n---\nOops\n')
    await writeNote('no-header', '# Just Markdown\n')
    const notes = await listNotes(options)
    const byId = Object.fromEntries(notes.map((note) => [note.id, note]))
    expect(byId.good).toMatchObject({ title: 'good', tags: ['work'] })
    expect(byId['bad-yaml']).toEqual({
      id: 'bad-yaml',
      version: expect.any(String),
      modifiedAt: expect.any(String),
      error: expect.stringMatching(/header/i),
    })
    expect(byId['bad-tag']).toMatchObject({ error: expect.stringMatching(/tags/i) })
    expect(byId['no-header']).toMatchObject({ error: expect.stringMatching(/no YAML header/i) })
  })

  it('lists the most recently changed Note first, and skips files that are not Notes', async () => {
    await writeNote('older', '---\ntags: []\n---\n')
    await writeNote('newer', '---\ntags: []\n---\n')
    await utimes(noteFile('older'), new Date(2026, 0, 1), new Date(2026, 0, 1))
    await writeFile(join(contentRoot, 'notes', 'readme.txt'), 'not a note')
    await writeFile(join(contentRoot, 'notes', '.hidden.md'), '---\n---\n')
    await writeFile(join(contentRoot, 'notes', 'newer.md.lock'), '{}')
    expect((await listNotes(options)).map((note) => note.id)).toEqual(['newer', 'older'])
  })

  it('lists only the Notes with a Tag: the Ideas are the Notes tagged idea', async () => {
    await writeNote('plain', '---\ntags: [work]\n---\n')
    await writeNote('an-idea', '---\ntags: [work, idea]\n---\n')
    expect((await listNotes({ ...options, tag: 'idea' })).map((note) => note.id)).toEqual(['an-idea'])
  })
})

describe('readNote', () => {
  it('reads a Note: its body without the header and the blank line after it, and its version', async () => {
    await writeNote('plan', '---\ntags: [work]\n---\n\n# Plan\n\nText\n')
    expect(await readNote('plan', options)).toEqual({
      id: 'plan',
      version: expect.any(String),
      modifiedAt: expect.any(String),
      title: 'Plan',
      tags: ['work'],
      body: '# Plan\n\nText\n',
    })
  })

  it('reads a Note with a broken header as its error', async () => {
    await writeNote('bad', '---\ntags: [work\n---\n')
    expect(await readNote('bad', options)).toMatchObject({ id: 'bad', error: expect.stringMatching(/header/i) })
  })

  it('finds no Note for an unknown id or one that leaves the notes folder', async () => {
    await expect(readNote('nope', options)).rejects.toThrow(MarkdownFileNotFoundError)
    await expect(readNote('../todos', options)).rejects.toThrow(MarkdownFileNotFoundError)
  })
})

describe('updateNote', () => {
  const HEADER = '---\ntitle:   Odd   spacing  # a comment\ntags: [work,   idea]   # keep me\nextra: {a: 1}\n---\n\n'

  it('saves a new body in house style, re-attaching the header byte-for-byte', async () => {
    await writeNote('n', `${HEADER}Old\n`)
    const { version } = (await readNote('n', options)) as Note
    const note = await updateNote('n', { body: '* one\n* two' }, { ...options, ifVersion: version })
    expect(await readFile(noteFile('n'), 'utf8')).toBe(`${HEADER}- one\n- two\n`)
    expect(note).toMatchObject({ body: '- one\n- two\n', tags: ['work', 'idea'] })
    expect(note.version).not.toBe(version)
  })

  it('writes nothing when the body saved is the one on disk', async () => {
    await writeNote('n', `${HEADER}# Same\n`)
    await utimes(noteFile('n'), new Date(2026, 0, 1), new Date(2026, 0, 1))
    const before = (await readNote('n', options)) as Note
    expect(await updateNote('n', { body: '# Same\n' }, options)).toEqual(before)
    expect((await stat(noteFile('n'))).mtime).toEqual(new Date(2026, 0, 1))
  })

  it('changes Tags by rewriting only the tags line', async () => {
    await writeNote('n', `${HEADER}Body\n`)
    await updateNote('n', { tags: ['work', 'release-plan'] }, options)
    expect(await readFile(noteFile('n'), 'utf8')).toBe(
      '---\ntitle:   Odd   spacing  # a comment\ntags: [work, release-plan]   # keep me\nextra: {a: 1}\n---\n\nBody\n',
    )
  })

  it('adds a tags line to a header without one, and rewrites a block list as one line', async () => {
    await writeNote('none', '---\ntitle: T\n---\nBody\n')
    await updateNote('none', { tags: ['idea'] }, options)
    expect(await readFile(noteFile('none'), 'utf8')).toBe('---\ntitle: T\ntags: [idea]\n---\nBody\n')
    await writeNote('block', '---\ntags:\n  - a\n  - b\ntitle: T\n---\nBody\n')
    await updateNote('block', { tags: ['b'] }, options)
    expect(await readFile(noteFile('block'), 'utf8')).toBe('---\ntags: [b]\ntitle: T\n---\nBody\n')
  })

  it('refuses a change made from a copy older than the file (an agent wrote since)', async () => {
    await writeNote('n', '---\ntags: []\n---\nMine\n')
    const { version } = (await readNote('n', options)) as Note
    await writeNote('n', '---\ntags: []\n---\nThe agent’s\n')
    await expect(updateNote('n', { body: 'Mine, edited' }, { ...options, ifVersion: version })).rejects.toThrow(StaleVersionError)
    expect(await readFile(noteFile('n'), 'utf8')).toBe('---\ntags: []\n---\nThe agent’s\n')
  })

  it('refuses to save a Note whose header is broken, leaving the file as it is', async () => {
    await writeNote('bad', '---\ntags: [work\n---\nBody\n')
    await expect(updateNote('bad', { body: 'New' }, options)).rejects.toThrow(MarkdownFileError)
    expect(await readFile(noteFile('bad'), 'utf8')).toBe('---\ntags: [work\n---\nBody\n')
  })

  it('refuses a Tag that is not lowercase and hyphenated', async () => {
    await writeNote('n', '---\ntags: []\n---\n')
    await expect(updateNote('n', { tags: ['Not A Tag'] }, options)).rejects.toThrow(/lowercase/)
  })
})
