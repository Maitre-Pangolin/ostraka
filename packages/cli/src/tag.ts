// `ostraka tag`: the Tags in use, a thin layer over core.
import { homedir } from 'node:os'
import { parseArgs } from 'node:util'
import { listTags } from '@ostraka/core'
import type { Io } from './main.ts'

export const TAG_USAGE = `  ostraka tag list [--json]     List the Tags in use on Todos, Notes, Dev logs and Sketches
`

export async function tagCommand(args: string[], io: Io): Promise<number> {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { json: { type: 'boolean' } } })
  if (positionals.length !== 1 || positionals[0] !== 'list') {
    io.stderr(`Usage:\n${TAG_USAGE}`)
    return 1
  }
  const tags = await listTags({ env: io.env, homeDir: io.homeDir ?? homedir() })
  if (values.json) io.stdout(`${JSON.stringify(tags, null, 2)}\n`)
  else io.stdout(tags.length ? tags.map(({ name }) => `#${name}\n`).join('') : 'No Tags.\n')
  return 0
}
