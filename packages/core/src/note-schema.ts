// The Note format: `notes/<id>.md`, a YAML header then a Markdown body. Imports only zod, so the web app can share
// these types. An Idea is a Note tagged `idea`, not a kind of its own.
import { z } from 'zod'

/** Flat, lowercase and hyphenated, as on Todos. */
const tag = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Tags are lowercase and hyphenated')

/** The Tag that makes a Note an Idea. */
export const IDEA_TAG = 'idea'

/**
 * A Note's header. Tags are `tags: [...]`, never inline in the body. `title` is optional: without it the Note is
 * titled by its first `# ` heading. Other keys are kept as they are.
 */
export const NoteHeaderSchema = z.looseObject({
  title: z.string().optional(),
  tags: z.array(tag).default([]),
})
export type NoteHeader = z.infer<typeof NoteHeaderSchema>

/** What starting a Note takes: an optional title (its first heading) and Tags. */
export const NewNoteSchema = z.strictObject({
  title: z.string().trim().optional(),
  tags: z.array(tag).optional(),
})
export type NewNote = z.infer<typeof NewNoteSchema>

/** A change to a Note: a new Markdown body (without the header), new Tags, or both. */
export const NoteChangeSchema = z.strictObject({
  body: z.string().optional(),
  tags: z.array(tag).optional(),
})
export type NoteChange = z.infer<typeof NoteChangeSchema>

/** A Note as read: `version` is a hash of the whole file, `modifiedAt` its last change on disk. */
export type Note = {
  id: string
  version: string
  modifiedAt: string
  title: string
  tags: string[]
  /** The Markdown body, without the header. */
  body: string
}

/** A Note in the list: everything but its body. */
export type NoteSummary = Omit<Note, 'body'>

/** A Note file whose header can't be read: listed with the reason, never hidden. */
export type BrokenNote = { id: string; version: string; modifiedAt: string; error: string }

export type NoteListing = NoteSummary | BrokenNote

export const isBrokenNote = (note: NoteListing | Note | BrokenNote): note is BrokenNote => 'error' in note
