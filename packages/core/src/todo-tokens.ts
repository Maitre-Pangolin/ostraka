// Quick-entry tokens: `#tag`, `*high|*med|*low` and `^today|^tomorrow|^fri|^2026-11-05` become a Todo's properties
// and leave its text. Pure and free of Node and zod, so the web app, the server and the CLI share one parser.
import type { Priority } from './todo-schema.ts'

export type TokenPriority = Exclude<Priority, 'none'>

/** What the tokens found in a text set. */
export type TokenProps = { tags: string[]; priority?: TokenPriority; due?: string }

export type Pulled = TokenProps & { text: string }

type Token = { kind: 'tag'; tag: string } | { kind: 'priority'; priority: TokenPriority } | { kind: 'due'; due: string }

const PRIORITY_WORDS: Record<string, TokenPriority> = { high: 'high', med: 'medium', medium: 'medium', low: 'low' }
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** `day` moved by `days`, both YYYY-MM-DD. Calendar arithmetic in UTC, so no time zone shifts the day. */
function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function parseDue(word: string, today: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(word)) return addDays(word, 0) === word ? word : undefined
  if (word === 'today') return today
  if (word === 'tomorrow') return addDays(today, 1)
  const weekday = word.length >= 3 ? WEEKDAYS.findIndex((name) => name.startsWith(word)) : -1
  if (weekday >= 0) {
    // The next one to come: `^fri` on a Friday means a week later.
    const current = new Date(`${today}T00:00:00Z`).getUTCDay()
    return addDays(today, (weekday - current + 7) % 7 || 7)
  }
  return undefined
}

/** The stored form of a Tag: lowercase, words joined by single hyphens. Undefined when nothing valid is left. */
export function normalizeTag(raw: string): string | undefined {
  const tag = raw
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(tag) ? tag : undefined
}

function parseToken(word: string, today: string): Token | undefined {
  const sigil = word[0]
  const rest = word.slice(1).toLowerCase()
  if (sigil === '#') {
    const tag = normalizeTag(rest)
    return tag === undefined ? undefined : { kind: 'tag', tag }
  }
  if (sigil === '*') {
    const priority = PRIORITY_WORDS[rest]
    return priority && { kind: 'priority', priority }
  }
  if (sigil === '^') {
    const due = parseDue(rest, today)
    return due === undefined ? undefined : { kind: 'due', due }
  }
  return undefined
}

/** A completion for the token being typed. `isNew` marks a Tag no Todo has yet: picking it creates it. */
export type TokenSuggestion = { token: string } & (Token | { kind: 'tag'; tag: string; isNew: true })

const PRIORITY_TOKENS = ['high', 'med', 'low'] as const
const DUE_WORDS = ['today', 'tomorrow', ...[1, 2, 3, 4, 5, 6, 0].map((day) => WEEKDAYS[day]!.slice(0, 3))]

/**
 * Completions for `fragment`, the word being typed: existing Tags (plus a new one) after `#`, priorities after `*`,
 * days after `^`. `tags` are the Tags in use; `exclude` the ones the Todo already has.
 */
export function suggestTokens(
  fragment: string,
  { today, tags, exclude = [] }: { today: string; tags: string[]; exclude?: string[] },
): TokenSuggestion[] {
  const sigil = fragment[0]
  const typed = fragment.slice(1).toLowerCase()
  if (sigil === '#') {
    const tag = typed ? normalizeTag(typed) : ''
    if (tag === undefined) return []
    const matching = tags.filter((t) => t.startsWith(tag))
    if (tag && !matching.length) return [{ token: `#${tag}`, kind: 'tag', tag, isNew: true }]
    return matching.filter((t) => !exclude.includes(t)).map((t) => ({ token: `#${t}`, kind: 'tag', tag: t }))
  }
  if (sigil === '*') {
    return PRIORITY_TOKENS.filter((word) => word.startsWith(typed)).map((word) => ({
      token: `*${word}`,
      kind: 'priority',
      priority: PRIORITY_WORDS[word]!,
    }))
  }
  if (sigil === '^') {
    const words = DUE_WORDS.filter((word) => word.startsWith(typed))
    if (!words.length && parseDue(typed, today) !== undefined) words.push(typed)
    return words.map((word) => ({ token: `^${word}`, kind: 'due', due: parseDue(word, today)! }))
  }
  return []
}

const ANY_TOKEN = /(?<=^|\s)[#*^]\S+(?=\s|$)/g
const COMPLETED_TOKEN = /(?<=^|\s)[#*^]\S+(?=\s)/g

const isBlank = (char: string | undefined) => char === ' ' || char === '\t'

// Each token leaves with one space next to it, so the words around it stay apart by the spacing they had.
function pull(text: string, pattern: RegExp, today: string, caret: number): Pulled & { caret: number } {
  const props: TokenProps = { tags: [] }
  let rest = ''
  let at = 0
  let movedCaret = caret
  for (const match of text.matchAll(pattern)) {
    const token = parseToken(match[0], today)
    if (!token) continue
    if (token.kind === 'tag') {
      if (!props.tags.includes(token.tag)) props.tags.push(token.tag)
    } else if (token.kind === 'priority') props.priority = token.priority
    else props.due = token.due

    let start = match.index
    let end = start + match[0].length
    if (isBlank(text[end])) end++
    else if (start > at && isBlank(text[start - 1])) start--
    if (caret > start) movedCaret -= Math.min(caret, end) - start
    rest += text.slice(at, start)
    at = end
  }
  rest += text.slice(at)
  return { text: rest, caret: movedCaret, ...props }
}

/** Takes every token out of `text` (adding a Todo, the CLI) and returns what's left, trimmed, with the properties they set. */
export function pullTokens(text: string, { today }: { today: string }): Pulled {
  const { text: rest, caret: _, ...props } = pull(text, ANY_TOKEN, today, 0)
  return { text: rest.trim(), ...props }
}

/**
 * While typing: takes only the completed tokens, those followed by a space or a new line, and leaves the rest of the
 * text as typed. `caret` is where the caret was; the result says where it goes.
 */
export function pullCompletedTokens(text: string, { today, caret }: { today: string; caret: number }): Pulled & { caret: number } {
  return pull(text, COMPLETED_TOKEN, today, caret)
}
