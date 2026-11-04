// `ostraka path`: where a kind of content lives.
import { homedir } from 'node:os'
import { parseArgs } from 'node:util'
import { CONTENT_KINDS, contentPath, isContentKind } from '@ostraka/core'
import type { Io } from './main.ts'

const KINDS = CONTENT_KINDS.join('|')

export const PATH_USAGE = `  ostraka path <${KINDS}> [--json]
                                Print where that content lives
`

export async function pathCommand(args: string[], io: Io): Promise<number> {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { json: { type: 'boolean' } } })
  const [kind] = positionals
  if (kind === undefined || !isContentKind(kind) || positionals.length > 1) {
    io.stderr(`Usage: ostraka path <${KINDS}> [--json]\n`)
    return 1
  }
  const resolved = await contentPath(kind, { env: io.env, homeDir: io.homeDir ?? homedir() })
  io.stdout(values.json ? `${JSON.stringify({ kind, path: resolved })}\n` : `${resolved}\n`)
  return 0
}
