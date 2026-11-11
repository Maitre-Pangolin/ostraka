// `ostraka note`: list Notes and write them in the house style, a thin layer over core.
import { homedir } from 'node:os'
import { parseArgs } from 'node:util'
import { formatNotes, isBrokenNote, listNotes } from '@ostraka/core'
import type { Io } from './main.ts'

export const NOTE_USAGE = `  ostraka note list [--json]    List Notes, most recently changed first (a broken one with its error)
  ostraka note format [<id>...] [--json]
                                Write Notes in the house style after editing them by hand
`

export async function noteCommand(args: string[], io: Io): Promise<number> {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { json: { type: 'boolean' } } })
  const [action, ...ids] = positionals
  const options = { env: io.env, homeDir: io.homeDir ?? homedir() }
  if (action === 'list' && ids.length === 0) {
    const notes = await listNotes(options)
    const line = (note: (typeof notes)[number]) =>
      isBrokenNote(note)
        ? `${note.id}  broken: ${note.error}`
        : [`${note.id}  ${note.title}`, ...(note.tags.length ? [note.tags.map((tag) => `#${tag}`).join(' ')] : [])].join('  ')
    io.stdout(values.json ? `${JSON.stringify(notes, null, 2)}\n` : notes.length ? `${notes.map(line).join('\n')}\n` : 'No Notes.\n')
    return 0
  }
  if (action === 'format') {
    const { formatted, broken } = await formatNotes(ids.length ? ids : undefined, options)
    if (values.json) io.stdout(`${JSON.stringify({ formatted, broken }, null, 2)}\n`)
    else io.stdout(formatted.length ? formatted.map((id) => `Formatted ${id}\n`).join('') : 'All in house style.\n')
    for (const note of broken) io.stderr(`${note.id}: ${note.error}\n`)
    return broken.length ? 1 : 0
  }
  io.stderr(`Usage:\n${NOTE_USAGE}`)
  return 1
}
