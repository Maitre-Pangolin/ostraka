import { homedir } from 'node:os'
import { delimiter, dirname } from 'node:path'
import { parseArgs } from 'node:util'
import {
  addSubTodo,
  addTodo,
  completeTodo,
  CONTENT_KINDS,
  contentPath,
  dropTodo,
  isContentKind,
  listFinishedTodos,
  listTodos,
  snapshot,
  type SubTodo,
  type Todo,
} from '@ostraka/core'
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

const TODO_USAGE = `  ostraka todo add <title> [--parent <id>] [--json]
                                Add an open Todo, or a Sub-todo under the Todo <id>;
                                #tag, *high|*med|*low and ^today|^tomorrow|^fri|^2026-11-05
                                set its properties
  ostraka todo done <id> [--json]
                                Mark a Todo or Sub-todo done (a Todo's open Sub-todos too)
  ostraka todo drop <id> [--reason <text>] [--json]
                                Drop a Todo or Sub-todo: abandon it, optionally saying why
  ostraka todo list [--json]    List open Todos, most urgent first, their Sub-todos under them
  ostraka todo list --finished-on <YYYY-MM-DD> [--json]
                                List the Todos done or Dropped that day, newest first
`

const SNAPSHOT_USAGE = `  ostraka snapshot "<message>" [--json]
                                Commit the content folder now (after an agent writes)
`

const USAGE = `Usage:
  ostraka serve                 Start the app on http://${HOSTNAME}:${PORT}
  ostraka install               Start the app at login (LaunchAgent) and put \`ostraka\` in ~/.local/bin
  ostraka path <${KINDS}> [--json]
                                Print where that content lives
${TODO_USAGE}${SNAPSHOT_USAGE}`

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
      case 'snapshot':
        return await snapshotCommand(rest, io)
      case 'todo':
        return await todoCommand(rest, io)
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

const PRIORITY_TOKENS = { high: '*high', medium: '*med', low: '*low', none: undefined }

/** `id  title  #tag *prio ^date`: the properties written back as the tokens that set them. */
function todoLine(todo: SubTodo): string {
  const tokens = [...todo.tags.map((tag) => `#${tag}`), PRIORITY_TOKENS[todo.priority], todo.due && `^${todo.due}`].filter(Boolean)
  return [`${todo.id}  ${todo.title}`, ...(tokens.length ? [tokens.join(' ')] : [])].join('  ')
}

const finishedLine = (todo: SubTodo) =>
  `${todoLine(todo)} (${todo.status === 'dropped' ? `Dropped${todo.dropReason ? `: ${todo.dropReason}` : ''}` : 'done'})`

/** An open Todo, then its Sub-todos indented under it in creation order, finished ones marked. */
const openTodoLines = (todo: Todo) =>
  [todoLine(todo), ...todo.subTodos.map((sub) => `  ${sub.status === 'open' ? todoLine(sub) : finishedLine(sub)}`)].join('\n')

async function todoCommand(args: string[], io: Io): Promise<number> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: 'boolean' },
      reason: { type: 'string' },
      'finished-on': { type: 'string' },
      parent: { type: 'string' },
    },
  })
  const [action, ...words] = positionals
  const finishedOn = values['finished-on']
  const options = { env: io.env, homeDir: io.homeDir ?? homedir() }
  const print = (value: unknown, text: string) => io.stdout(values.json ? `${JSON.stringify(value, null, 2)}\n` : `${text}\n`)

  if (action === 'add' && words.length > 0 && values.parent !== undefined) {
    const added = await addSubTodo(values.parent, { title: words.join(' ') }, options)
    print(added, `Added ${todoLine(added)} (Sub-todo of ${values.parent})`)
    return 0
  }
  if (action === 'add' && words.length > 0) {
    const added = await addTodo({ title: words.join(' ') }, options)
    print(added, `Added ${todoLine(added)}`)
    return 0
  }
  if (values.parent !== undefined) {
    io.stderr(`Usage:\n${TODO_USAGE}`)
    return 1
  }
  if (action === 'done' && words.length === 1) {
    const done = await completeTodo(words[0]!, options)
    print(done, `Done ${todoLine(done)}`)
    return 0
  }
  if (action === 'drop' && words.length === 1 && finishedOn === undefined) {
    const dropped = await dropTodo(words[0]!, { reason: values.reason }, options)
    print(dropped, `Dropped ${todoLine(dropped)}${dropped.dropReason ? ` (${dropped.dropReason})` : ''}`)
    return 0
  }
  if (action === 'list' && words.length === 0 && finishedOn !== undefined && values.reason === undefined) {
    const todos = await listFinishedTodos({ finishedOn }, options)
    print(todos, todos.length ? todos.map(finishedLine).join('\n') : `No Todos finished on ${finishedOn}.`)
    return 0
  }
  if (values.reason !== undefined || finishedOn !== undefined) {
    io.stderr(`Usage:\n${TODO_USAGE}`)
    return 1
  }
  if (action === 'list' && words.length === 0) {
    const todos = await listTodos(options)
    print(todos, todos.length ? todos.map(openTodoLines).join('\n') : 'No open Todos.')
    return 0
  }
  io.stderr(`Usage:\n${TODO_USAGE}`)
  return 1
}

async function snapshotCommand(args: string[], io: Io): Promise<number> {
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

async function serve(io: Io): Promise<number> {
  // macOS may prompt once per Keychain item here: they are created with `-T ""` so every read asks.
  const server = await startServer({ keychain: macKeychain(), warn: (message) => io.stderr(`${message}\n`) })
  io.stdout(`Ostraka is running on http://${HOSTNAME}:${PORT}\n`)
  // Stopping commits pending content changes as a Snapshot before the process exits.
  const stop = () => void server.stop()
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
