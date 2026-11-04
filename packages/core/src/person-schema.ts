// The People directory's format: `people.json`, one Person per colleague. Imports only zod, so the web app can share
// these types. Written only through core (`people.ts`) and the `ostraka people` commands.
import { z } from 'zod'

/** A Person's id, as Mentions write it after `@`: lowercase words joined by hyphens. */
export const PERSON_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const text = z.string().trim().min(1)

/** The identities cached for a Person in each Activity source, looked up once by email. */
export const PersonIdentitiesSchema = z.strictObject({
  /** The one company email (the Outlook one). */
  email: z.email('email is one company email address').optional(),
  slackId: text.optional(),
  /** Without the leading `@`. */
  slackHandle: text.transform((handle) => handle.replace(/^@/, '')).optional(),
  gitlabUsername: text.optional(),
  jiraAccountId: text.optional(),
})
export type PersonIdentities = z.infer<typeof PersonIdentitiesSchema>

/**
 * A colleague: id slug, display name, aliases, and their identities. `ignored` keeps someone skills must not offer
 * to add again. A Person with no email who isn't ignored is a Stub Person.
 */
export const PersonSchema = z.strictObject({
  id: z.string().regex(PERSON_ID, 'id is lowercase words joined by hyphens, such as ilse-vantongeren'),
  name: text,
  aliases: z.array(text).default([]),
  ...PersonIdentitiesSchema.shape,
  ignored: z.literal(true).optional(),
})
export type Person = z.infer<typeof PersonSchema>

export const PeopleFileSchema = z.strictObject({ people: z.array(PersonSchema) })
export type PeopleFile = z.infer<typeof PeopleFileSchema>

/** A new Person from the app or the CLI: the id defaults to the name's slug. */
export const NewPersonSchema = PersonSchema.extend({ id: PersonSchema.shape.id.optional() })
export type NewPerson = z.input<typeof NewPersonSchema>

const KEY_ORDER = ['id', 'name', 'aliases', 'email', 'slackId', 'slackHandle', 'gitlabUsername', 'jiraAccountId', 'ignored'] as const

/** `people.json` as written: sorted by id, keys in a stable order, two-space JSON. */
export function formatPeopleFile(file: PeopleFile): string {
  const people = file.people
    .toSorted((a, b) => a.id.localeCompare(b.id))
    .map((person) => Object.fromEntries(KEY_ORDER.filter((key) => person[key] !== undefined).map((key) => [key, person[key]])))
  return `${JSON.stringify({ people }, null, 2)}\n`
}
