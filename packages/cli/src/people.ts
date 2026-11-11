// `ostraka people`: the People directory for agents and scripts, a thin layer over core. Agents check
// `ostraka people find` before looking a colleague up in Slack, Jira, GitLab or M365.
import { homedir } from 'node:os'
import { parseArgs } from 'node:util'
import {
  addPerson,
  findPeople,
  getPerson,
  ignorePerson,
  listPeople,
  listStubPeople,
  mergePerson,
  refreshPerson,
  renamePerson,
  type MentionUse,
  type Person,
} from '@ostraka/core'
import type { Io } from './main.ts'

export const PEOPLE_USAGE = `  ostraka people find <name|id|alias|email|handle> [--json]
                                Look a colleague up in the People directory (before any MCP lookup)
  ostraka people add <name> [--id <id>] [--email <email>] [--alias <alias>]... [--slack-id <id>]
                     [--slack-handle <handle>] [--gitlab <username>] [--jira <account id>] [--ignored] [--json]
                                Add a Person; the id defaults to the name as lowercase-hyphenated words.
                                --ignored records someone skills must not offer to add again
  ostraka people show <id> [--json]
                                Print a Person's name, aliases, email and identities
  ostraka people refresh <id> [--email <email>] [--slack-id <id>] [--slack-handle <handle>]
                         [--gitlab <username>] [--jira <account id>] [--json]
                                Record identities looked up again by email; the others stay as cached
  ostraka people ignore <id> [--json]
                                Mark a Person ignored: no skill offers to add or fill them again
  ostraka people list [--stubs] [--json]
                                Everyone in the People directory; --stubs only Stub Persons (no email, not ignored)
  ostraka people rename <id> <new id> [--name <name>] [--dry-run] [--json]
                                Give a Person a new id (and name, the old one kept as an alias), rewriting every
                                Mention in Todos, Notes and Dev logs. --dry-run counts them and writes nothing
  ostraka people merge <id> <into id> [--dry-run] [--json]
                                Merge a Person into another: Mentions rewritten, name kept as an alias
`

/** `id  Name  email`, `(ignored)` last for someone on the ignore list. */
const personLine = (person: Person) =>
  [person.id, person.name, ...(person.email ? [person.email] : []), ...(person.ignored ? ['(ignored)'] : [])].join('  ')

function slackText({ slackHandle, slackId }: Person): string | undefined {
  if (!slackHandle) return slackId
  return slackId ? `@${slackHandle} (${slackId})` : `@${slackHandle}`
}

/** A Person's id and name, then one indented row per thing known about them. */
function personCard(person: Person): string {
  const rows: [string, string | undefined][] = [
    ['Aliases', person.aliases.join(', ') || undefined],
    ['Email', person.email],
    ['Slack', slackText(person)],
    ['GitLab', person.gitlabUsername],
    ['Jira', person.jiraAccountId],
    ['Ignored', person.ignored && 'yes'],
  ]
  const shown = rows.filter((row): row is [string, string] => Boolean(row[1]))
  return [`${person.id}  ${person.name}`, ...shown.map(([label, value]) => `  ${label.padEnd(7)}  ${value}`)].join('\n')
}

/** `@from → @to in 3 places: todos.json 1, notes/ab12c.md 2`. */
function mentionChange(from: string, to: string, uses: MentionUse[]): string {
  const total = uses.reduce((sum, use) => sum + use.count, 0)
  const where = uses.map((use) => `${use.file} ${use.count}`).join(', ')
  return `@${from} → @${to} in ${total === 1 ? '1 place' : `${total} places`}${where && `: ${where}`}`
}

export async function peopleCommand(args: string[], io: Io): Promise<number> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: 'boolean' },
      stubs: { type: 'boolean' },
      name: { type: 'string' },
      'dry-run': { type: 'boolean' },
      id: { type: 'string' },
      alias: { type: 'string', multiple: true },
      ignored: { type: 'boolean' },
      email: { type: 'string' },
      'slack-id': { type: 'string' },
      'slack-handle': { type: 'string' },
      gitlab: { type: 'string' },
      jira: { type: 'string' },
    },
  })
  const [action, ...words] = positionals
  const options = { env: io.env, homeDir: io.homeDir ?? homedir() }
  const print = (value: unknown, text: string) => io.stdout(values.json ? `${JSON.stringify(value, null, 2)}\n` : `${text}\n`)
  const identities = {
    email: values.email,
    slackId: values['slack-id'],
    slackHandle: values['slack-handle'],
    gitlabUsername: values.gitlab,
    jiraAccountId: values.jira,
  }
  const given = Object.fromEntries(Object.entries(identities).filter(([, value]) => value !== undefined))

  if (action === 'find' && words.length > 0) {
    const query = words.join(' ')
    const found = await findPeople(query, options)
    print(found, found.length ? found.map(personLine).join('\n') : `No Person matches ${query}.`)
    return 0
  }
  if (action === 'add' && words.length > 0) {
    const added = await addPerson(
      {
        ...given,
        name: words.join(' '),
        ...(values.id && { id: values.id }),
        aliases: values.alias ?? [],
        ...(values.ignored && { ignored: true }),
      },
      options,
    )
    print(added, `Added ${personLine(added)}`)
    return 0
  }
  if (action === 'show' && words.length === 1) {
    const person = await getPerson(words[0]!, options)
    print(person, personCard(person))
    return 0
  }
  if (action === 'refresh' && words.length === 1 && Object.keys(given).length > 0) {
    const person = await refreshPerson(words[0]!, given, options)
    print(person, `Refreshed ${personCard(person)}`)
    return 0
  }
  if (action === 'ignore' && words.length === 1) {
    const person = await ignorePerson(words[0]!, options)
    print(person, `Ignored ${personLine(person)}`)
    return 0
  }
  if (action === 'list' && words.length === 0) {
    const people = values.stubs ? await listStubPeople(options) : await listPeople(options)
    const none = values.stubs ? 'No Stub Persons.' : 'The People directory is empty.'
    print(people, people.length ? people.map(personLine).join('\n') : none)
    return 0
  }
  if ((action === 'rename' || action === 'merge') && words.length === 2) {
    const [from, to] = words as [string, string]
    const change = { ...options, dryRun: values['dry-run'] }
    const mentions =
      action === 'rename'
        ? await renamePerson(from, { id: to, ...(values.name && { name: values.name }) }, change)
        : await mergePerson(from, to, change)
    const verb = action === 'rename' ? (values['dry-run'] ? 'Would rename' : 'Renamed') : values['dry-run'] ? 'Would merge' : 'Merged'
    print({ from, to, mentions }, `${verb} ${mentionChange(from, to, mentions)}`)
    return 0
  }
  io.stderr(`Usage:\n${PEOPLE_USAGE}`)
  return 1
}
