// `ostraka snapshot`: commit the content folder now, after an agent writes.
import { homedir } from 'node:os'
import { parseArgs } from 'node:util'
import { snapshot } from '@ostraka/core'
import type { Io } from './main.ts'

export const SNAPSHOT_USAGE = `  ostraka snapshot "<message>" [--json]
                                Commit the content folder now (after an agent writes)
`

export async function snapshotCommand(args: string[], io: Io): Promise<number> {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { json: { type: 'boolean' } } })
  const [message] = positionals
  if (message === undefined || message.trim() === '' || positionals.length > 1) {
    io.stderr(`Usage:\n${SNAPSHOT_USAGE}`)
    return 1
  }
  const made = await snapshot(message, { env: io.env, homeDir: io.homeDir ?? homedir() })
  if (values.json) io.stdout(`${JSON.stringify(made ?? null, null, 2)}\n`)
  else io.stdout(made ? `Snapshot ${made.commit.slice(0, 7)}  ${made.message}\n` : 'Nothing changed since the last Snapshot.\n')
  return 0
}
