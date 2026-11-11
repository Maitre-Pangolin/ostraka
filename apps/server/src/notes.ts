import {
  createNote,
  FileLockedError,
  isBrokenNote,
  listNotes,
  MarkdownFileError,
  MarkdownFileNotFoundError,
  NewNoteSchema,
  NoteChangeSchema,
  readNote,
  StaleVersionError,
  updateNote,
  type NoteOptions,
} from '@ostraka/core'
import { Hono, type Context } from 'hono'
import { readBody } from './todos.ts'
import { loadedVersion } from './versions.ts'

function onNoteError(error: Error, c: Context) {
  if (error instanceof MarkdownFileNotFoundError) return c.json({ error: error.message }, 404)
  if (error instanceof StaleVersionError) return c.json({ error: error.message }, 412)
  // The file's header is broken, or another writer holds the file.
  if (error instanceof MarkdownFileError || error instanceof FileLockedError) return c.json({ error: error.message }, 409)
  throw error
}

/**
 * `/api/notes`: list Notes (a broken one with its error; `?tag=idea` for the Ideas), open one, start one, and change
 * one's body or Tags. Every Note answered carries its `version`; a change sent with `If-Match` is refused (412) if
 * the file changed since. All writes go through core.
 */
export function noteRoutes(options: NoteOptions) {
  const routes = new Hono()
  routes.onError(onNoteError)

  routes.get('/', async (c) => c.json(await listNotes({ ...options, tag: c.req.query('tag') })))

  routes.get('/:id', async (c) => {
    const note = await readNote(c.req.param('id'), options)
    if (isBrokenNote(note)) return c.json({ error: note.error }, 409)
    return c.json(note)
  })

  routes.post('/', async (c) => {
    const body = await readBody(c, NewNoteSchema, {})
    if (!body.ok) return body.response
    return c.json(await createNote(body.data, options), 201)
  })

  routes.patch('/:id', async (c) => {
    const body = await readBody(c, NoteChangeSchema)
    if (!body.ok) return body.response
    return c.json(await updateNote(c.req.param('id'), body.data, { ...options, ifVersion: loadedVersion(c) }))
  })

  return routes
}
