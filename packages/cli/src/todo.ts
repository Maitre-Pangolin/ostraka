// `ostraka todo`: add, finish and list Todos and Sub-todos, a thin layer over core.
import { homedir } from 'node:os'
import { parseArgs } from 'node:util'
import {
  addSubTodo,
  addTodo,
  completeTodo,
  dropTodo,
  listFinishedOn,
  listTodos,
  localDay,
  mentionedReferences,
  todaysTodos,
  type FinishedSubTodo,
  type SubTodo,
  type Todo,
} from '@ostraka/core'
import type { Io } from './main.ts'

export const TODO_USAGE = `  ostraka todo add <title> [--parent <id>] [--json]
                                Add an open Todo, or a Sub-todo under the Todo <id>;
                                #tag, *high|*med|*low and ^today|^tomorrow|^fri|^2026-11-05
                                set its properties
  ostraka todo done <id> [--json]
                                Mark a Todo or Sub-todo done (a Todo's open Sub-todos too)
  ostraka todo drop <id> [--reason <text>] [--json]
                                Drop a Todo or Sub-todo: abandon it, optionally saying why
  ostraka todo list [--json]    List open Todos, most urgent first, their Sub-todos under them
  ostraka todo list --finished-on <YYYY-MM-DD> [--json]
                                List the Todos and Sub-todos done or Dropped that day, newest first
                                (a Sub-todo as Parent › Sub-todo; --json names its parent)
  ostraka todo list --today [--json]
                                List today's Todos for the Briefing: overdue, due today, then the top 3
                                high-priority ones without a due date (a Sub-todo as Parent › Sub-todo)
  ostraka todo list --references [--json]
                                List the MR and Jira References open Todos and Sub-todos mention
`

const PRIORITY_TOKENS = { high: '*high', medium: '*med', low: '*low', none: undefined }

/** `id  title  #tag *prio ^date`: the properties written back as the tokens that set them. */
function todoLine(todo: Pick<SubTodo, 'id' | 'title' | 'tags' | 'priority' | 'due'>): string {
  const tokens = [...todo.tags.map((tag) => `#${tag}`), PRIORITY_TOKENS[todo.priority], todo.due && `^${todo.due}`].filter(Boolean)
  return [`${todo.id}  ${todo.title}`, ...(tokens.length ? [tokens.join(' ')] : [])].join('  ')
}

const finishedLine = (todo: SubTodo) =>
  `${todoLine(todo)} (${todo.status === 'dropped' ? `Dropped${todo.dropReason ? `: ${todo.dropReason}` : ''}` : 'done'})`

/** A finished Todo, or a finished Sub-todo listed on its own as `Parent › Sub-todo`. */
const finishedOnLine = (item: Todo | FinishedSubTodo) =>
  finishedLine('parent' in item ? { ...item, title: `${item.parent.title} › ${item.title}` } : item)

/** An open Todo, then its Sub-todos indented under it in creation order, finished ones marked. */
const openTodoLines = (todo: Todo) =>
  [todoLine(todo), ...todo.subTodos.map((sub) => `  ${sub.status === 'open' ? todoLine(sub) : finishedLine(sub)}`)].join('\n')

export async function todoCommand(args: string[], io: Io): Promise<number> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: 'boolean' },
      reason: { type: 'string' },
      'finished-on': { type: 'string' },
      today: { type: 'boolean' },
      references: { type: 'boolean' },
      parent: { type: 'string' },
    },
  })
  const [action, ...words] = positionals
  const finishedOn = values['finished-on']
  const options = { env: io.env, homeDir: io.homeDir ?? homedir() }
  const print = (value: unknown, text: string) => io.stdout(values.json ? `${JSON.stringify(value, null, 2)}\n` : `${text}\n`)
  // `--today` and `--references` are each a listing of their own, so they take no other option.
  const briefing = [values.today, values.references].filter(Boolean).length
  if (
    briefing &&
    (action !== 'list' || briefing > 1 || finishedOn !== undefined || values.reason !== undefined || values.parent !== undefined)
  ) {
    io.stderr(`Usage:\n${TODO_USAGE}`)
    return 1
  }

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
    const items = await listFinishedOn({ finishedOn }, options)
    print(items, items.length ? items.map(finishedOnLine).join('\n') : `No Todos finished on ${finishedOn}.`)
    return 0
  }
  if (values.reason !== undefined || finishedOn !== undefined) {
    io.stderr(`Usage:\n${TODO_USAGE}`)
    return 1
  }
  if (action === 'list' && words.length === 0 && values.today) {
    const todos = todaysTodos(await listTodos(options), localDay((io.now ?? (() => new Date()))()))
    print(
      todos,
      todos.length ? todos.map((todo) => `${todoLine(todo)}  (${todo.why})`).join('\n') : 'Nothing overdue, due today or high priority.',
    )
    return 0
  }
  if (action === 'list' && words.length === 0 && values.references) {
    const references = mentionedReferences(await listTodos(options))
    print(references, references.length ? references.join('\n') : 'No References in open Todos.')
    return 0
  }
  if (action === 'list' && words.length === 0) {
    const todos = await listTodos(options)
    print(todos, todos.length ? todos.map(openTodoLines).join('\n') : 'No open Todos.')
    return 0
  }
  io.stderr(`Usage:\n${TODO_USAGE}`)
  return 1
}
