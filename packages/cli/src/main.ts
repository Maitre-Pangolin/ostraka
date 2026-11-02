import { homedir } from 'node:os'
import { delimiter, dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { addTodo, completeTodo, CONTENT_KINDS, contentPath, isContentKind, listTodos, type Todo } from '@ostraka/core'
import { HOSTNAME, macKeychain, PORT, startServer } from '@ostraka/server'
import { install as installAgent, realSystem, type System } from './install.ts'

export type { System } from './install.ts'

export type Io = {
  env: Record<string, string | undefined>
  homeDir?: string
  /** launchd, node and the platform, for `install`. Tests pass a fake. */
  system?: System
  stdout: (text: string) => void
  stderr: (text: string) => void
}

const KINDS = CONTENT_KINDS.join('|')

const TODO_USAGE = `  ostraka todo add <title> [--json]
                                Add an open Todo
  ostraka todo done <id> [--json]
                                Mark a Todo done
  ostraka todo list [--json]    List open Todos, most urgent first
`

const USAGE = `Usage:
  ostraka serve                 Start the app on http://${HOSTNAME}:${PORT}
  ostraka install               Start the app at login (LaunchAgent) and put \`ostraka\` in ~/.local/bin
  ostraka path <${KINDS}> [--json]
                                Print where that content lives
${TODO_USAGE}`

/** Runs one `ostraka` command and returns its exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv
  try {
    switch (command) {
      case 'path':
        return await path(rest, io)
      case 'serve':
        return await serve(io)
      case 'install':
        return await install(io)
      case 'todo':
        return await todoCommand(rest, io)
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

const todoLine = (todo: Todo) => `${todo.id}  ${todo.title}`

async function todoCommand(args: string[], io: Io): Promise<number> {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { json: { type: 'boolean' } } })
  const [action, ...words] = positionals
  const options = { env: io.env, homeDir: io.homeDir ?? homedir() }
  const print = (value: unknown, text: string) => io.stdout(values.json ? `${JSON.stringify(value, null, 2)}\n` : `${text}\n`)

  if (action === 'add' && words.length > 0) {
    const added = await addTodo({ title: words.join(' ') }, options)
    print(added, `Added ${todoLine(added)}`)
    return 0
  }
  if (action === 'done' && words.length === 1) {
    const done = await completeTodo(words[0]!, options)
    print(done, `Done ${todoLine(done)}`)
    return 0
  }
  if (action === 'list' && words.length === 0) {
    const todos = await listTodos(options)
    print(todos, todos.length ? todos.map(todoLine).join('\n') : 'No open Todos.')
    return 0
  }
  io.stderr(`Usage:\n${TODO_USAGE}`)
  return 1
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

async function install(io: Io): Promise<number> {
  const { plist, shim, logs } = await installAgent(io.homeDir ?? homedir(), io.system ?? realSystem())
  io.stdout(`LaunchAgent: ${plist} (starts at login, restarts after a crash; logs in ${logs})\n`)
  io.stdout(`CLI shim:    ${shim}\n`)
  if (!(io.env.PATH ?? '').split(delimiter).includes(dirname(shim))) {
    io.stdout(`${dirname(shim)} is not on your PATH. Add it in ~/.zshrc: export PATH="$HOME/.local/bin:$PATH"\n`)
  }
  return 0
}
