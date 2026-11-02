import { homedir } from 'node:os'
import { parseArgs } from 'node:util'
import {
  addTodo,
  completeTodo,
  CONTENT_KINDS,
  contentPath,
  dropTodo,
  isContentKind,
  listFinishedTodos,
  listTodos,
  type Todo,
} from '@ostraka/core'
import { HOSTNAME, PORT, startServer } from '@ostraka/server'

export type Io = {
  env: Record<string, string | undefined>
  homeDir?: string
  stdout: (text: string) => void
  stderr: (text: string) => void
}

const KINDS = CONTENT_KINDS.join('|')

const TODO_USAGE = `  ostraka todo add <title> [--json]
                                Add an open Todo
  ostraka todo done <id> [--json]
                                Mark a Todo done
  ostraka todo drop <id> [--reason <text>] [--json]
                                Drop a Todo: abandon it, optionally saying why
  ostraka todo list [--json]    List open Todos, most urgent first
  ostraka todo list --finished-on <YYYY-MM-DD> [--json]
                                List the Todos done or Dropped that day, newest first
`

const USAGE = `Usage:
  ostraka serve                 Start the app on http://${HOSTNAME}:${PORT}
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

const todoLine = (todo: Todo) => `${todo.id}  ${todo.title}`

const finishedLine = (todo: Todo) =>
  `${todoLine(todo)} (${todo.status === 'dropped' ? `Dropped${todo.dropReason ? `: ${todo.dropReason}` : ''}` : 'done'})`

async function todoCommand(args: string[], io: Io): Promise<number> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: { json: { type: 'boolean' }, reason: { type: 'string' }, 'finished-on': { type: 'string' } },
  })
  const [action, ...words] = positionals
  const finishedOn = values['finished-on']
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
    print(todos, todos.length ? todos.map(todoLine).join('\n') : 'No open Todos.')
    return 0
  }
  io.stderr(`Usage:\n${TODO_USAGE}`)
  return 1
}

async function serve(io: Io): Promise<number> {
  const server = await startServer()
  io.stdout(`Ostraka is running on http://${HOSTNAME}:${PORT}\n`)
  const stop = () => server.close()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return 0
}
