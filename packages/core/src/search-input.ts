// What ⌘K is given: typed text whose completed `#tag` and `@person` tokens become chips, a kind and a date menu, all
// read into one search query. Pure and free of Node and zod, so the web app shares it.
import { addDays } from './devlog-days.ts'
import { parseMention } from './mentions.ts'
import type { SearchKind, SearchQuery } from './search-types.ts'
import { normalizeTag } from './todo-tokens.ts'

/** The text left once its chips are taken out, and the chips. */
export type SearchChips = { text: string; tags: string[]; people: string[] }

/** A `#` or `@` word followed by a space or a new line: typed in full. */
const COMPLETED = /(?<=^|\s)([#@])(\S+)(?=\s)/g

/** Takes each completed `#tag` and `@person` out of the typed text, with the space after it; the rest stays as typed. */
export function pullSearchChips(typed: string): SearchChips {
  const chips: SearchChips = { text: '', tags: [], people: [] }
  let at = 0
  for (const match of typed.matchAll(COMPLETED)) {
    const [whole, sigil, word] = match as unknown as [string, string, string]
    const value = sigil === '#' ? normalizeTag(word) : parseMention(whole)
    if (value === undefined) continue
    const list = sigil === '#' ? chips.tags : chips.people
    if (!list.includes(value)) list.push(value)
    chips.text += typed.slice(at, match.index)
    at = match.index + whole.length + 1
  }
  chips.text += typed.slice(at)
  return chips
}

/** The Date menu: any date, the last 7 or 30 days, this year, or a custom range of days. */
export type SearchDates = 'any' | 'week' | 'month' | 'year' | { from: string; to: string }

/** The local days a Date menu choice covers, `from` and `to` included; none for any date. */
export function searchDateRange(dates: SearchDates, today: string): { from?: string; to?: string } {
  if (typeof dates === 'object') return { from: dates.from, to: dates.to }
  if (dates === 'week') return { from: addDays(today, -6), to: today }
  if (dates === 'month') return { from: addDays(today, -29), to: today }
  if (dates === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today }
  return {}
}

/** Everything ⌘K narrows by. */
export type SearchInput = {
  text: string
  tags: string[]
  tagMatch: 'all' | 'any'
  people: string[]
  kind: SearchKind | 'any'
  dates: SearchDates
}

/**
 * The query for what ⌘K holds: the text, with each Person searched as their whole Mention, and the Tags (all of them
 * by default), kind and dates. Undefined when nothing is typed or chosen.
 */
export function searchQuery({ text, tags, tagMatch, people, kind, dates }: SearchInput, today: string): SearchQuery | undefined {
  const words = [text.trim(), ...people.map((id) => `@${id}`)].filter(Boolean).join(' ')
  const range = searchDateRange(dates, today)
  if (!words && !tags.length && kind === 'any' && !range.from) return undefined
  return {
    text: words,
    ...(tags.length > 0 && { tags }),
    ...(tags.length > 0 && tagMatch === 'any' && { tagMatch }),
    ...(kind !== 'any' && { kinds: [kind] }),
    ...range,
  }
}
