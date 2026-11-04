// `ostraka`: dispatches each command to its module; each is a thin layer over core.
import { HOSTNAME, PORT, type Keychain } from '@ostraka/server'
import { BACKUP_USAGE, backupCommand, initCommand } from './backup.ts'
import { DEVLOG_USAGE, devlogCommand } from './devlog.ts'
import { installCommand, type System } from './install.ts'
import { MIGRATE_USAGE, migrateCommand } from './migrate.ts'
import { NOTE_USAGE, noteCommand } from './note.ts'
import { PATH_USAGE, pathCommand } from './path.ts'
import { PEOPLE_USAGE, peopleCommand } from './people.ts'
import { SEARCH_USAGE, searchCommand } from './search.ts'
import { serveCommand } from './serve.ts'
import { SNAPSHOT_USAGE, snapshotCommand } from './snapshot.ts'
import { TAG_USAGE, tagCommand } from './tag.ts'
import { TODO_USAGE, todoCommand } from './todo.ts'

export type { System } from './install.ts'

export type Io = {
  env: Record<string, string | undefined>
  homeDir?: string
  /** launchd, node and the platform, for `install`. Tests pass a fake. */
  system?: System
  /** The macOS Keychain from the `ostraka` binary, a fake in tests; `backup` and `init` refuse to run without one. */
  keychain?: Keychain
  /** The current moment, for "today"; tests pass a fixed one. */
  now?: () => Date
  /** Asks the user one line, for the `init` walkthrough. */
  readLine?: (prompt: string) => Promise<string>
  /** Calls to the running server (`ostraka search`); tests pass a fake. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  stdout: (text: string) => void
  stderr: (text: string) => void
}

const USAGE = `Usage:
  ostraka serve                 Start the app on http://${HOSTNAME}:${PORT}
  ostraka install               Start the app at login (LaunchAgent), put \`ostraka\` in ~/.local/bin
                                and link the repo's skills into ~/.claude/skills
${PATH_USAGE}${TODO_USAGE}${NOTE_USAGE}${DEVLOG_USAGE}${MIGRATE_USAGE}${TAG_USAGE}${PEOPLE_USAGE}${SEARCH_USAGE}${SNAPSHOT_USAGE}${BACKUP_USAGE}`

/** Runs one `ostraka` command and returns its exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv
  try {
    switch (command) {
      case 'path':
        return await pathCommand(rest, io)
      case 'serve':
        return await serveCommand(io)
      case 'install':
        return await installCommand(io)
      case 'snapshot':
        return await snapshotCommand(rest, io)
      case 'todo':
        return await todoCommand(rest, io)
      case 'note':
        return await noteCommand(rest, io)
      case 'search':
        return await searchCommand(rest, io)
      case 'devlog':
        return await devlogCommand(rest, io)
      case 'migrate':
        return await migrateCommand(rest, io)
      case 'tag':
        return await tagCommand(rest, io)
      case 'people':
        return await peopleCommand(rest, io)
      case 'backup':
        return await backupCommand(rest, io)
      case 'init':
        return await initCommand(rest, io)
      default:
        io.stderr(USAGE)
        return 1
    }
  } catch (error) {
    io.stderr(`${errorMessage(error)}\n`)
    return 1
  }
}

/** Invalid input from core's schemas carries one message per problem; anything else, its message. */
function errorMessage(error: unknown): string {
  const issues = (error as { issues?: unknown }).issues
  if (Array.isArray(issues)) return issues.map((issue: { message: string }) => issue.message).join('\n')
  return error instanceof Error ? error.message : String(error)
}
