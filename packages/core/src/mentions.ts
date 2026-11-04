// Mentions: a Person written as `@<person id>` in plain text. Pure and free of Node and zod, so the web app, the
// server, the CLI and search share one grammar, as with References (`references.ts`).

/** Lowercase, accents and case left out, for matching names as typed. */
export const foldText = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** The id a name suggests: its words, without accents, joined by hyphens. */
export const personIdFromName = (name: string) =>
  foldText(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** A Mention found in a text: its token, the Person's id and where it sits, `end` exclusive. */
export type FoundMention = { token: string; id: string; start: number; end: number }

// The id's words may not run on from or into a longer word, an email, a path or another Mention.
const MENTION = /(?<![\p{L}\p{N}_@./-])@([a-z0-9]+(?:-[a-z0-9]+)*)(?![\p{L}\p{N}_@/-])/gu

/** The token a Mention of `id` is written as. */
export const mentionToken = (id: string) => `@${id}`

/** Every Mention in `text`, in order. */
export function findMentions(text: string): FoundMention[] {
  return [...text.matchAll(MENTION)].map((match) => ({
    token: match[0],
    id: match[1]!,
    start: match.index,
    end: match.index + match[0].length,
  }))
}

/** `word` read as one whole Mention token: the Person's id, or undefined. */
export function parseMention(word: string): string | undefined {
  const [found] = findMentions(word)
  return found && found.start === 0 && found.end === word.length ? found.id : undefined
}

/** `text` with every Mention of Person `from` written as a Mention of `to`; nothing else changes. */
export function replaceMentions(text: string, from: string, to: string): string {
  let result = ''
  let at = 0
  for (const found of findMentions(text)) {
    if (found.id !== from) continue
    result += text.slice(at, found.start) + mentionToken(to)
    at = found.end
  }
  return result + text.slice(at)
}

/** The Persons a text mentions, each once, in order. */
export const mentionedPeople = (text: string) => [...new Set(findMentions(text).map((found) => found.id))]

/** What suggestions need to know of a Person (a `Person` from the People directory fits). */
export type MentionCandidate = { id: string; name: string; aliases: string[]; ignored?: boolean }

/** A Person offered while a Mention is typed: picking it inserts `token`. */
export type MentionSuggestion = { kind: 'mention'; token: string; id: string; name: string }

const words = (value: string) =>
  foldText(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/**
 * Completions for `fragment`, the word being typed, after `@`: Persons whose id starts with what follows, then those
 * with a word of their name or an alias starting with it (case and accents ignored), by name. Ignored Persons are
 * left out.
 */
export function suggestPeople(fragment: string, people: MentionCandidate[]): MentionSuggestion[] {
  const typed = /^@([^\s@]*)$/.exec(fragment)?.[1]
  if (typed === undefined) return []
  const query = foldText(typed)
  const rank = (person: MentionCandidate) => {
    if (person.id.startsWith(query)) return 0
    const names = [person.name, ...person.aliases]
    const matches = names.some((name) => personIdFromName(name).startsWith(query) || words(name).some((word) => word.startsWith(query)))
    return matches ? 1 : undefined
  }
  return people
    .filter((person) => !person.ignored)
    .flatMap((person) => {
      const at = rank(person)
      return at === undefined ? [] : [{ person, at }]
    })
    .toSorted((a, b) => a.at - b.at || foldText(a.person.name).localeCompare(foldText(b.person.name)))
    .map(({ person }): MentionSuggestion => ({ kind: 'mention', token: mentionToken(person.id), id: person.id, name: person.name }))
}

/** Where a Person is reached, for the contact card: a Slack DM first, then email, GitLab and Jira profiles. */
export type PersonLinks = { slack?: string; email?: string; gitlab?: string; jira?: string }

type Identities = { email?: string; slackId?: string; gitlabUsername?: string; jiraAccountId?: string }

const trimSlashes = (url: string) => url.replace(/\/+$/, '')

/** The links a Person's identities open, profiles under `gitlab.base_url` and `jira.site`; none for what is unknown. */
export function personLinks(person: Identities, sites: { gitlab?: string; jira?: string }): PersonLinks {
  const links: PersonLinks = {}
  // Slack's redirect opens the DM with a user id in the Slack app, without knowing the workspace's id.
  if (person.slackId) links.slack = `https://slack.com/app_redirect?channel=${encodeURIComponent(person.slackId)}`
  if (person.email) links.email = `mailto:${person.email}`
  if (person.gitlabUsername && sites.gitlab) links.gitlab = `${trimSlashes(sites.gitlab)}/${encodeURIComponent(person.gitlabUsername)}`
  if (person.jiraAccountId && sites.jira) links.jira = `${trimSlashes(sites.jira)}/jira/people/${encodeURIComponent(person.jiraAccountId)}`
  return links
}

/** What ends a Mention being typed: a space, a new line or punctuation. */
const ENDS_TOKEN = /^[\s,.;:)\]}?!'"]/

/** Mentions of known Persons typed in full and followed by a space or punctuation, so ready to become chips. */
export function completedMentions(text: string, isPerson: (id: string) => boolean): FoundMention[] {
  return findMentions(text).filter((found) => isPerson(found.id) && ENDS_TOKEN.test(text.slice(found.end)))
}
