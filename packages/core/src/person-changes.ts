// Changing a Person's id: renaming one (a filled Stub Person takes the slug of their real name) or merging one into
// another (a stub whose email someone already has). Mentions are plain text, so either rewrites every `@<old id>` in
// Todos, Notes and Dev logs: the Todos in one write of `todos.json`, each Markdown file under its lock, then
// `people.json`. Counts per file come first, for the confirmation.
import { z } from 'zod'
import { markdownFiles, MarkdownFileNotFoundError, isBrokenFile } from './markdown-files.ts'
import { findMentions, replaceMentions } from './mentions.ts'
import { assertEmailFree, listPeople, PersonExistsError, PersonNotFoundError, updatePeople, type PeopleOptions } from './people.ts'
import { PERSON_ID, PersonIdentitiesSchema, type Person } from './person-schema.ts'
import { allTodoItems, rewriteTodoTexts } from './todos.ts'

/** A change to a Person that can't be made, such as merging them into themselves or an id that isn't one. */
export class PersonChangeError extends Error {}

/** How many Mentions of a Person one content file holds, by its path in the content folder (`notes/<id>.md`). */
export type MentionUse = { file: string; count: number }

const MARKDOWN = {
  notes: markdownFiles('notes', z.looseObject({})),
  devlogs: markdownFiles('devlogs', z.looseObject({})),
}

const countIn = (text: string, id: string) => findMentions(text).filter((found) => found.id === id).length

/**
 * Where a Person is mentioned: `todos.json` (titles, descriptions and drop reasons of every Todo and Sub-todo), then
 * each Note and Dev log, by path. Files that don't mention them, and Markdown files with a broken header, are left out.
 */
export async function personMentions(id: string, options: PeopleOptions = {}): Promise<MentionUse[]> {
  const todoCount = (await allTodoItems(options))
    .flatMap((item) => [item.title, item.description ?? '', item.dropReason ?? ''])
    .reduce((sum, text) => sum + countIn(text, id), 0)
  const uses: MentionUse[] = todoCount ? [{ file: 'todos.json', count: todoCount }] : []
  for (const kind of ['notes', 'devlogs'] as const) {
    const files = (await MARKDOWN[kind].list(options)).toSorted((a, b) => a.id.localeCompare(b.id))
    for (const file of files) {
      if (isBrokenFile(file)) continue
      const count = countIn(file.body, id)
      if (count) uses.push({ file: `${kind}/${file.id}.md`, count })
    }
  }
  return uses
}

/** Rewrites every Mention of `from` as one of `to`, and says how many there were in each file. */
async function rewriteMentions(from: string, to: string, options: PeopleOptions): Promise<MentionUse[]> {
  const uses = await personMentions(from, options)
  const rewrite = (text: string) => replaceMentions(text, from, to)
  await rewriteTodoTexts(rewrite, options)
  for (const { file } of uses) {
    const [kind, name] = file.split('/') as ['notes' | 'devlogs' | 'todos.json', string | undefined]
    if (kind === 'todos.json') continue
    try {
      await MARKDOWN[kind].update(name!.replace(/\.md$/, ''), ({ body }) => ({ body: rewrite(body) }), options)
    } catch (error) {
      if (!(error instanceof MarkdownFileNotFoundError)) throw error // Removed meanwhile: nothing left to rewrite.
    }
  }
  return uses
}

async function personById(id: string, options: PeopleOptions): Promise<Person[]> {
  const people = await listPeople(options)
  if (!people.some((person) => person.id === id)) throw new PersonNotFoundError(`No Person ${id} in the People directory.`)
  return people
}

const withAlias = (aliases: string[], name: string, ...more: string[]) =>
  [...new Set([...aliases, ...more])].filter((alias) => alias !== name)

/**
 * Gives a Person a new id, and a new name if one is given (the old name stays as an alias), then rewrites every
 * Mention of them. Refused before anything is written when the new id isn't one or another Person has it.
 * Says how many Mentions each file held.
 */
export async function renamePerson(id: string, to: { id: string; name?: string }, options: PeopleOptions = {}): Promise<MentionUse[]> {
  if (!PERSON_ID.test(to.id)) throw new PersonChangeError(`${to.id} isn’t a Person id: use lowercase words joined by hyphens`)
  const people = await personById(id, options)
  if (to.id !== id && people.some((person) => person.id === to.id)) {
    throw new PersonExistsError(`${to.id} is already in the People directory: merge ${id} into them instead.`)
  }
  const uses = to.id === id ? [] : await rewriteMentions(id, to.id, options)
  await updatePeople(options, (file) => {
    const person = file.people.find((candidate) => candidate.id === id)
    if (!person) throw new PersonNotFoundError(`No Person ${id} in the People directory.`)
    const name = to.name?.trim() || person.name
    Object.assign(person, { id: to.id, name, aliases: withAlias(person.aliases, name, ...(name === person.name ? [] : [person.name])) })
  })
  return uses
}

/**
 * Merges a Person into another: every Mention of them is rewritten, their name and aliases become the other's
 * aliases, identities the other lacks are kept, and they leave the directory. Says how many Mentions each file held.
 */
export async function mergePerson(id: string, intoId: string, options: PeopleOptions = {}): Promise<MentionUse[]> {
  if (id === intoId) throw new PersonChangeError(`A Person can’t be merged into themselves.`)
  await personById(id, options)
  await personById(intoId, options)
  const uses = await rewriteMentions(id, intoId, options)
  await updatePeople(options, (file) => {
    const merged = file.people.find((person) => person.id === id)
    const into = file.people.find((person) => person.id === intoId)
    if (!into) throw new PersonNotFoundError(`No Person ${intoId} in the People directory.`)
    if (!merged) return // Merged meanwhile: the Mentions are rewritten, nothing else is left.
    for (const key of Object.keys(PersonIdentitiesSchema.shape) as (keyof typeof PersonIdentitiesSchema.shape)[]) {
      if (into[key] === undefined && merged[key] !== undefined) into[key] = merged[key]
    }
    into.aliases = withAlias(into.aliases, into.name, merged.name, ...merged.aliases)
    assertEmailFree(
      file.people.filter((person) => person.id !== id),
      into,
    )
    file.people = file.people.filter((person) => person.id !== id)
  })
  return uses
}
