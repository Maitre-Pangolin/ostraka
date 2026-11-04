// Where a search's text matches inside a shown text, to highlight it: the same reading of the query as the index
// (`search.ts`), applied to one string. Each word is the start of a word, `"a phrase"` its whole words in order, a
// Reference or Mention typed whole that whole token; case and accents are ignored. Pure and free of Node and zod.
import { findMentions } from './mentions.ts'
import { findReferences } from './references.ts'

/** A matched run of a text, `end` exclusive. */
export type TextMatch = { start: number; end: number }

/** A word of a shown text: where it sits and its folded form, with where each folded character came from. */
type Word = { start: number; folded: string; ends: number[] }

const fold = (char: string) => char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

function wordsOf(text: string): Word[] {
  return [...text.matchAll(/[\p{L}\p{N}\p{M}]+/gu)].map((match) => {
    let folded = ''
    const ends: number[] = []
    let at = match.index
    for (const char of match[0]) {
      at += char.length
      for (const piece of fold(char)) {
        folded += piece
        ends.push(at)
      }
    }
    return { start: match.index, folded, ends }
  })
}

/** The words of a query term, folded. */
const termWords = (text: string) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).map((word) => [...word].map(fold).join(''))

type Term = { kind: 'words'; words: string[]; prefix: boolean } | { kind: 'token'; token: string }

/** A whole Reference or Mention, lowercased, when `word` is exactly one. */
function wholeToken(word: string): string | undefined {
  const [reference] = findReferences(word.toUpperCase())
  if (reference && reference.start === 0 && reference.end === word.length) return word.toLowerCase()
  const [mention] = findMentions(word.toLowerCase())
  if (mention && mention.start === 0 && mention.end === word.length) return word.toLowerCase()
  return undefined
}

function termsOf(query: string): Term[] {
  const terms: Term[] = []
  for (const [, quoted, word] of query.matchAll(/"([^"]*)"|(\S+)/g)) {
    if (quoted !== undefined) {
      const words = termWords(quoted)
      if (words.length) terms.push({ kind: 'words', words, prefix: false })
      continue
    }
    const bare = word!.replace(/^"+/, '')
    const token = wholeToken(bare)
    if (token) terms.push({ kind: 'token', token })
    else {
      const words = termWords(bare)
      if (words.length) terms.push({ kind: 'words', words, prefix: true })
    }
  }
  return terms
}

function wordMatches(words: Word[], term: Extract<Term, { kind: 'words' }>): TextMatch[] {
  const found: TextMatch[] = []
  const last = term.words.length - 1
  for (let first = 0; first + last < words.length; first++) {
    const run = words.slice(first, first + last + 1)
    const ok = run.every((word, at) =>
      at === last && term.prefix ? word.folded.startsWith(term.words[at]!) : word.folded === term.words[at],
    )
    if (!ok) continue
    const end = run[last]!
    found.push({ start: run[0]!.start, end: end.ends[term.words[last]!.length - 1]! })
  }
  return found
}

function tokenMatches(text: string, token: string): TextMatch[] {
  const found = token.startsWith('@')
    ? findMentions(text).filter((mention) => mention.token.toLowerCase() === token)
    : findReferences(text.toUpperCase()).filter((reference) => reference.token.toLowerCase() === token)
  return found.map(({ start, end }) => ({ start, end }))
}

/** Every place `query` matches in `text`, in order, overlapping ones joined. None when nothing searchable is typed. */
export function findMatches(text: string, query: string): TextMatch[] {
  const terms = termsOf(query)
  if (!terms.length) return []
  const words = wordsOf(text)
  const all = terms
    .flatMap((term) => (term.kind === 'token' ? tokenMatches(text, term.token) : wordMatches(words, term)))
    .toSorted((a, b) => a.start - b.start || b.end - a.end)
  const joined: TextMatch[] = []
  for (const match of all) {
    const previous = joined.at(-1)
    if (previous && match.start <= previous.end) previous.end = Math.max(previous.end, match.end)
    else joined.push({ ...match })
  }
  return joined
}
