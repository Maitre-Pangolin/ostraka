// The People directory: `people.json` in the content folder, read and written only here, so the app, the CLI and
// agents share one set of rules. Writes take the file's lock, validate, then replace it through a temp file.
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { contentPath } from './content-path.ts'
import type { ContentRootOptions } from './content-root.ts'
import { withFileLock, writeFileAtomic, type LockOptions } from './locked-file.ts'
import { foldText, personIdFromName } from './mentions.ts'
import {
  formatPeopleFile,
  NewPersonSchema,
  PeopleFileSchema,
  PersonIdentitiesSchema,
  PersonSchema,
  type NewPerson,
  type PeopleFile,
  type Person,
  type PersonIdentities,
} from './person-schema.ts'

export type PeopleOptions = ContentRootOptions & { lock?: LockOptions }

export class PeopleFileError extends Error {}
export class PersonNotFoundError extends Error {}
export class PersonExistsError extends Error {}

async function readPeopleFile(file: string): Promise<PeopleFile> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { people: [] }
    throw error
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new PeopleFileError(`Invalid ${file}: ${(error as Error).message}`)
  }
  const result = PeopleFileSchema.safeParse(json)
  if (!result.success) throw new PeopleFileError(`Invalid ${file}:\n${z.prettifyError(result.error)}`)
  return result.data
}

/** The only way `people.json` is written: under its lock, an invalid file refused, the result validated. */
async function updatePeople<T>(options: PeopleOptions, change: (file: PeopleFile) => T): Promise<T> {
  const file = await contentPath('people', options)
  await mkdir(dirname(file), { recursive: true })
  return withFileLock(
    file,
    async () => {
      const people = await readPeopleFile(file)
      const result = change(people)
      const checked = PeopleFileSchema.safeParse(people)
      if (!checked.success) throw new PeopleFileError(`Refusing to write an invalid ${file}:\n${z.prettifyError(checked.error)}`)
      await writeFileAtomic(file, formatPeopleFile(checked.data))
      return result
    },
    options.lock,
  )
}

/** Every Person in the directory, by id. */
export async function listPeople(options: ContentRootOptions = {}): Promise<Person[]> {
  const { people } = await readPeopleFile(await contentPath('people', options))
  return people.toSorted((a, b) => a.id.localeCompare(b.id))
}

/** One Person by id. */
export async function getPerson(id: string, options: ContentRootOptions = {}): Promise<Person> {
  const person = (await listPeople(options)).find((candidate) => candidate.id === id)
  if (!person) throw new PersonNotFoundError(`No Person ${id} in the People directory.`)
  return person
}

const sameEmail = (a: string | undefined, b: string | undefined) => a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase()

function assertEmailFree(people: Person[], person: Person) {
  const owner = people.find((other) => other.id !== person.id && sameEmail(other.email, person.email))
  if (owner) throw new PersonExistsError(`${owner.id} already has the email ${person.email}.`)
}

/** Adds a Person; the id defaults to the name's slug. An id or email already in the directory is refused. */
export async function addPerson(input: NewPerson, options: PeopleOptions = {}): Promise<Person> {
  const parsed = NewPersonSchema.parse(input)
  const person = PersonSchema.parse({ ...parsed, id: parsed.id ?? personIdFromName(parsed.name) })
  return updatePeople(options, (file) => {
    if (file.people.some((other) => other.id === person.id)) throw new PersonExistsError(`${person.id} is already in the People directory.`)
    assertEmailFree(file.people, person)
    file.people.push(person)
    return person
  })
}

/** Records identities looked up again: each one given replaces the cached one, the others stay. */
export async function refreshPerson(id: string, identities: PersonIdentities, options: PeopleOptions = {}): Promise<Person> {
  const found = PersonIdentitiesSchema.parse(identities)
  return updatePeople(options, (file) => {
    const at = file.people.findIndex((person) => person.id === id)
    if (at < 0) throw new PersonNotFoundError(`No Person ${id} in the People directory.`)
    const person = { ...file.people[at]!, ...Object.fromEntries(Object.entries(found).filter(([, value]) => value !== undefined)) }
    assertEmailFree(file.people, person)
    file.people[at] = person
    return person
  })
}

/**
 * The Persons a query names, for agents checking the directory before an MCP lookup: by any part of the name, id or
 * an alias (case and accents ignored), or exactly by email, Slack handle (with or without `@`) or GitLab username.
 */
export async function findPeople(query: string, options: ContentRootOptions = {}): Promise<Person[]> {
  const wanted = foldText(query.trim()).replace(/^@/, '')
  if (!wanted) return []
  return (await listPeople(options)).filter((person) => {
    const names = [person.id, person.name, ...person.aliases].map(foldText)
    const exact = [person.email, person.slackHandle, person.gitlabUsername, person.slackId, person.jiraAccountId].map((value) =>
      value === undefined ? undefined : foldText(value),
    )
    return names.some((name) => name.includes(wanted)) || exact.includes(wanted)
  })
}
