// Notes: `notes/<id>.md`, read and written through the shared Markdown file type.
import { randomInt } from 'node:crypto'
import {
  isBrokenFile,
  markdownFiles,
  MarkdownFileExistsError,
  type BrokenMarkdownFile,
  type MarkdownChangeOptions,
  type MarkdownFile,
  type MarkdownFileOptions,
} from './markdown-files.ts'
import {
  NewNoteSchema,
  NoteChangeSchema,
  NoteHeaderSchema,
  type BrokenNote,
  type NewNote,
  type Note,
  type NoteChange,
  type NoteHeader,
  type NoteListing,
} from './note-schema.ts'

export type NoteOptions = MarkdownFileOptions
/** For a change made from a loaded copy: the `version` of that copy. */
export type NoteChangeOptions = MarkdownChangeOptions

const notes = markdownFiles('notes', NoteHeaderSchema)

/** The header's title, else the first `# ` heading, else the id. */
function titleOf(id: string, header: NoteHeader, body: string): string {
  const heading = /^# +(.+?)(?: +#+)? *$/m.exec(body)?.[1]
  return header.title?.trim() || heading?.trim() || id
}

function toNote(file: MarkdownFile<NoteHeader> | BrokenMarkdownFile): Note | BrokenNote {
  if (isBrokenFile(file)) return file
  const { id, version, modifiedAt, header, body } = file
  return { id, version, modifiedAt, title: titleOf(id, header, body), tags: header.tags, body }
}

/** Every Note, most recently changed first; one with a broken header is listed with its error. `tag` narrows to a Tag. */
export async function listNotes(options: NoteOptions & { tag?: string } = {}): Promise<NoteListing[]> {
  const listed = (await notes.list(options)).map(toNote)
  return listed
    .filter((note) => options.tag === undefined || ('tags' in note && note.tags.includes(options.tag)))
    .map((note) => {
      if (!('body' in note)) return note
      const { body: _body, ...summary } = note
      return summary
    })
}

/** One Note with its body, or why its header can't be read. */
export async function readNote(id: string, options: NoteOptions = {}): Promise<Note | BrokenNote> {
  return toNote(await notes.read(id, options))
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const newId = () => Array.from({ length: 5 }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join('')

/** Starts a Note with a short random id: Tags in its header, the title as its first heading. */
export async function createNote(input: NewNote, options: NoteOptions = {}): Promise<Note> {
  const { title, tags = [] } = NewNoteSchema.parse(input)
  for (;;) {
    try {
      return toNote(await notes.create(newId(), { header: { tags }, body: title ? `# ${title}\n` : '' }, options)) as Note
    } catch (error) {
      if (!(error instanceof MarkdownFileExistsError)) throw error
    }
  }
}

/**
 * Changes a Note's body, its Tags, or both. The header stays byte-for-byte but for the `tags:` line, the body is
 * written in house style, and nothing is written when nothing changed.
 */
export async function updateNote(id: string, input: NoteChange, options: NoteChangeOptions = {}): Promise<Note> {
  const { body, tags } = NoteChangeSchema.parse(input)
  return toNote(await notes.update(id, { body, ...(tags && { header: { tags } }) }, options)) as Note
}
