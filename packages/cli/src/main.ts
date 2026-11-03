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
  formatNotes,
  isBrokenDevlog,
  isBrokenNote,
  listDevlogs,
  listNotes,
  listTags,
  isContentKind,
  listFinishedTodos,
  localDay,
  missingDevlogWeeks,
  listTodos,
  snapshot,
  type DevlogListing,
  type SubTodo,
  type Todo,
} from '@ostraka/core'
import { HOSTNAME, macKeychain, PORT, startServer, type Keychain } from '@ostraka/server'
import { BACKUP_USAGE, backupCommand, initCommand } from './backup.ts'
import { install as installAgent, realSystem, type System } from './install.ts'

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

const NOTE_USAGE = `  ostraka note list [--json]    List Notes, most recently changed first (a broken one with its error)
  ostraka note format [<id>...] [--json]
                                Write Notes in the house style after editing them by hand
`

const DEVLOG_USAGE = `  ostraka devlog list [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>] [--json]
                                List Dev logs and monthly summaries, newest first (a broken one with its error)
  ostraka devlog missing [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>] [--json]
                                List the weekdays with no Dev log, by week, oldest first: from the first
                                Dev log (or --from) to today (or --to)
`

const TAG_USAGE = `  ostraka tag list [--json]     List the Tags in use on Todos, Notes, Dev logs and Sketches
`

const SNAPSHOT_USAGE = `  ostraka snapshot "<message>" [--json]
                                Commit the content folder now (after an agent writes)
`

const USAGE = `Usage:
  ostraka serve                 Start the app on http://${HOSTNAME}:${PORT}
  ostraka install               Start the app at login (LaunchAgent), put \`ostraka\` in ~/.local/bin
                                and link the repo's skills into ~/.claude/skills
  ostraka path <${KINDS}> [--json]
                                Print where that content lives
${TODO_USAGE}${NOTE_USAGE}${DEVLOG_USAGE}${TAG_USAGE}${SNAPSHOT_USAGE}${BACKUP_USAGE}`

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
      case 'note':
        return await noteCommand(rest, io)
      case 'devlog':
        return await devlogCommand(rest, io)
      case 'tag':
        return await tagCommand(rest, io)
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

async function noteCommand(args: string[], io: Io): Promise<number> {
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

const DAY = /^\d{4}-\d{2}-\d{2}$/
const MONTH = /^\d{4}-\d{2}$/

/** A day from `from` to `to`, a monthly summary of a month they touch, and any misnamed file, which is always shown. */
const inRange = (id: string, from = '0000-00-00', to = '9999-99-99') =>
  DAY.test(id) ? id >= from && id <= to : MONTH.test(id) ? id >= from.slice(0, 7) && id <= to.slice(0, 7) : true

/** `date  #tag  sources: …`, `date  off: label`, `month  monthly summary  #tag` or `id  broken: error`. */
function devlogLine(log: DevlogListing): string {
  if (isBrokenDevlog(log)) return `${log.id}  broken: ${log.error}`
  const tags = log.tags.length ? [log.tags.map((tag) => `#${tag}`).join(' ')] : []
  if (log.kind === 'month') return [`${log.id}  monthly summary`, ...tags].join('  ')
  if (log.off) return `${log.id}  off${log.label ? `: ${log.label}` : ''}`
  return [log.id, ...tags, ...(log.sources.length ? [`sources: ${log.sources.join(', ')}`] : [])].join('  ')
}

async function devlogCommand(args: string[], io: Io): Promise<number> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: { json: { type: 'boolean' }, from: { type: 'string' }, to: { type: 'string' } },
  })
  const { from, to } = values
  const [subcommand] = positionals
  const dates = [from, to].filter((date) => date !== undefined)
  if (positionals.length !== 1 || (subcommand !== 'list' && subcommand !== 'missing') || !dates.every((date) => DAY.test(date))) {
    io.stderr(`Usage:\n${DEVLOG_USAGE}`)
    return 1
  }
  const all = await listDevlogs({ env: io.env, homeDir: io.homeDir ?? homedir() })
  if (subcommand === 'missing') {
    if (from === undefined && !all.some((log) => DAY.test(log.id))) {
      io.stderr('No Dev log yet, so no first day to start from: pass --from <YYYY-MM-DD>.\n')
      return 1
    }
    const weeks = missingDevlogWeeks(all, localDay((io.now ?? (() => new Date()))()), { from, to })
    const lines = weeks.map((week) => `week of ${week.start}: ${week.days.join(' ')}`)
    io.stdout(values.json ? `${JSON.stringify(weeks, null, 2)}\n` : lines.length ? `${lines.join('\n')}\n` : 'No missing days.\n')
    return 0
  }
  const logs = all.filter((log) => inRange(log.id, from, to))
  io.stdout(values.json ? `${JSON.stringify(logs, null, 2)}\n` : logs.length ? `${logs.map(devlogLine).join('\n')}\n` : 'No Dev logs.\n')
  return 0
}

async function tagCommand(args: string[], io: Io): Promise<number> {
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
  const { plist, shim, logs, skills, skippedSkills, oldDevlogCommand } = await installAgent(
    io.homeDir ?? homedir(),
    io.system ?? realSystem(),
  )
  io.stdout(`LaunchAgent: ${plist} (starts at login, restarts after a crash; logs in ${logs})\n`)
  io.stdout(`CLI shim:    ${shim}\n`)
  for (const skill of skills) io.stdout(`Skill:       ${skill} (a link to this repo's copy)\n`)
  for (const skill of skippedSkills) {
    io.stdout(`Skill:       ${skill} is not a link from \`ostraka install\`, so it was left as is; move it away and run install again.\n`)
  }
  if (oldDevlogCommand) io.stdout(`${oldDevlogCommand} is the old Cursor /devlog command: the devlog skill replaces it, so delete it.\n`)
  if (!(io.env.PATH ?? '').split(delimiter).includes(dirname(shim))) {
    io.stdout(`${dirname(shim)} is not on your PATH. Add it in ~/.zshrc: export PATH="$HOME/.local/bin:$PATH"\n`)
  }
  return 0
}
