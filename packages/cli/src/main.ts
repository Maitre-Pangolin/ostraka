import { homedir } from 'node:os'
import { parseArgs } from 'node:util'
import { CONTENT_KINDS, contentPath, isContentKind } from '@ostraka/core'
import { HOSTNAME, macKeychain, PORT, startServer } from '@ostraka/server'

export type Io = {
  env: Record<string, string | undefined>
  homeDir?: string
  stdout: (text: string) => void
  stderr: (text: string) => void
}

const KINDS = CONTENT_KINDS.join('|')

const USAGE = `Usage:
  ostraka serve                 Start the app on http://${HOSTNAME}:${PORT}
  ostraka path <${KINDS}> [--json]
                                Print where that content lives
`

/** Runs one `ostraka` command and returns its exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv
  try {
    switch (command) {
      case 'path':
        return await path(rest, io)
      case 'serve':
        return await serve(io)
      default:
        io.stderr(USAGE)
        return 1
    }
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

async function path(args: string[], io: Io): Promise<number> {
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

async function serve(io: Io): Promise<number> {
  // macOS may prompt once per Keychain item here: they are created with `-T ""` so every read asks.
  const server = await startServer({ keychain: macKeychain(), warn: (message) => io.stderr(`${message}\n`) })
  io.stdout(`Ostraka is running on http://${HOSTNAME}:${PORT}\n`)
  const stop = () => server.close()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return 0
}
