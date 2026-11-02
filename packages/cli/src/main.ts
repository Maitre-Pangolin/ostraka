import { homedir } from 'node:os'
import { parseArgs } from 'node:util'
import { addTodo, completeTodo, CONTENT_KINDS, contentPath, isContentKind, listTodos, snapshot, type Todo } from '@ostraka/core'
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
  ostraka todo list [--json]    List open Todos, most urgent first
`

const SNAPSHOT_USAGE = `  ostraka snapshot "<message>" [--json]
                                Commit the content folder now (after an agent writes)
`

const USAGE = `Usage:
  ostraka serve                 Start the app on http://${HOSTNAME}:${PORT}
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
      case 'snapshot':
        return await snapshotCommand(rest, io)
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
  const server = await startServer()
  io.stdout(`Ostraka is running on http://${HOSTNAME}:${PORT}\n`)
  // Stopping commits pending content changes as a Snapshot before the process exits.
  const stop = () => void server.stop()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return 0
}
