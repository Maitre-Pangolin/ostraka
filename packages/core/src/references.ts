// References: a merge request or Jira issue written as that system's own token, `group/project!<iid>` or
// `<KEY>-<number>`, in plain text. Pure and free of Node and zod, so the web app, the server, the CLI and search
// share one grammar.

export type Reference = { kind: 'mr'; project: string; iid: number } | { kind: 'jira'; key: string }

/** A Reference found in a text: its token and where it sits, `end` exclusive. */
export type FoundReference = { token: string; start: number; end: number; reference: Reference }

// A project path is two or more segments (nested groups allowed), the iid digits. Neither may run on from a longer
// word, path or URL on either side.
const MR = String.raw`(?<![\w/.-])((?:[A-Za-z0-9_][\w.-]*\/)+[A-Za-z0-9_][\w.-]*)!(\d+)(?!\w)`
const JIRA = String.raw`(?<![\w/-])([A-Z][A-Z0-9_]+-\d+)(?![\w-])`
const REFERENCE = new RegExp(`${MR}|${JIRA}`, 'g')

/** The token a Reference is written as. */
export const referenceToken = (reference: Reference) => (reference.kind === 'mr' ? `${reference.project}!${reference.iid}` : reference.key)

/** `word` read as one whole Reference token, or undefined. */
export function parseReference(word: string): Reference | undefined {
  const [found] = findReferences(word)
  return found && found.start === 0 && found.end === word.length ? found.reference : undefined
}

/** Where References open: `gitlab.base_url` and `jira.site` from config.yml. */
export type ReferenceSites = { gitlab?: string; jira?: string }

const trimSlashes = (url: string) => url.replace(/\/+$/, '')

function under(url: URL, site: string | undefined): string | undefined {
  if (!site || !URL.canParse(site)) return undefined
  const base = new URL(site)
  if (url.host !== base.host) return undefined
  const prefix = trimSlashes(base.pathname)
  return url.pathname.startsWith(`${prefix}/`) ? url.pathname.slice(prefix.length + 1) : undefined
}

/** A pasted URL as a Reference: an MR page under `gitlab.base_url`, or a `/browse/KEY-n` page under `jira.site`. */
export function referenceFromUrl(text: string, sites: ReferenceSites): { token: string; reference: Reference } | undefined {
  const trimmed = text.trim()
  if (!/^https?:\/\/\S+$/i.test(trimmed) || !URL.canParse(trimmed)) return undefined
  const url = new URL(trimmed)
  const mr = /^((?:[^/]+\/)+?[^/]+)\/-\/merge_requests\/(\d+)(?:\/|$)/.exec(under(url, sites.gitlab) ?? '')
  const reference = mr
    ? parseReference(`${mr[1]}!${mr[2]}`)
    : parseReference(/^browse\/([^/]+)\/?$/.exec(under(url, sites.jira) ?? '')?.[1] ?? '')
  return reference && { token: referenceToken(reference), reference }
}

/** The page a Reference opens, or undefined when its site isn't configured. */
export function referenceUrl(reference: Reference, sites: ReferenceSites): string | undefined {
  if (reference.kind === 'mr') return sites.gitlab && `${trimSlashes(sites.gitlab)}/${reference.project}/-/merge_requests/${reference.iid}`
  return sites.jira && `${trimSlashes(sites.jira)}/browse/${reference.key}`
}

/** Every Reference in `text`, in order. */
export function findReferences(text: string): FoundReference[] {
  return [...text.matchAll(REFERENCE)].map((match) => {
    const [token, project, iid, key] = match
    const reference: Reference = key ? { kind: 'jira', key } : { kind: 'mr', project: project!, iid: Number(iid) }
    return { token, start: match.index, end: match.index + token.length, reference }
  })
}

/**
 * A token edited as one atomic chip. Mentions (#47) join this union, so editors and `joinPieces` treat them alike.
 */
export type Chip = { kind: 'reference'; token: string; reference: Reference }

/** A text as an editor holds it: runs of plain text between chips. */
export type TextPiece = { kind: 'text'; text: string } | Chip

/** Chips' tokens found in a text. Mentions add theirs here. */
const findChips = (text: string): { token: string; start: number; end: number }[] => findReferences(text)

/** `text` as runs of plain text and a chip per Reference. */
export function splitReferences(text: string): TextPiece[] {
  const pieces: TextPiece[] = []
  let at = 0
  for (const found of findReferences(text)) {
    if (found.start > at) pieces.push({ kind: 'text', text: text.slice(at, found.start) })
    pieces.push({ kind: 'reference', token: found.token, reference: found.reference })
    at = found.end
  }
  if (at < text.length) pieces.push({ kind: 'text', text: text.slice(at) })
  return pieces
}

/** Whether `token` still reads as one whole chip between the characters `before` and `after`. */
const standsAlone = (before: string, token: string, after: string) =>
  findChips(`${before}${token}${after}`).some((found) => found.start === before.length && found.token === token)

/**
 * Pieces back to plain text, for saving. A character touching a chip that would stop its token parsing back (a
 * word, a path) gets a space between them; punctuation stays as typed.
 */
export function joinPieces(pieces: TextPiece[]): string {
  let text = ''
  let lastChip: string | undefined
  for (const piece of pieces) {
    const next = piece.kind === 'text' ? piece.text : piece.token
    if (!next) continue
    const touchesBefore = lastChip !== undefined && !standsAlone('', lastChip, next[0]!)
    const touchesAfter = piece.kind !== 'text' && text !== '' && !standsAlone(text.at(-1)!, piece.token, '')
    if (touchesBefore || touchesAfter) text += ' '
    text += next
    lastChip = piece.kind === 'text' ? undefined : piece.token
  }
  return text
}

/** A Reference offered while one is typed: picking it inserts `token`. */
export type ReferenceSuggestion = { kind: 'reference'; token: string; title: string; reference: Reference }

/** What the work overview polled, as suggestions need it. */
export type ReferenceCandidates = {
  /** My open MRs, reviewing and authored. */
  mergeRequests: { reference: string; title: string }[]
  /** My tickets in the open sprint, with their status category (`done` ones are not suggested). */
  tickets: { key: string; summary: string; category: string }[]
}

/**
 * Completions for `fragment`, the word being typed: open MRs after `!` (by the start of the iid, or a word of the
 * title or project path), open sprint tickets after `KEY-` (by the start of the key).
 */
export function suggestReferences(fragment: string, { mergeRequests, tickets }: ReferenceCandidates): ReferenceSuggestion[] {
  const mrQuery = /^!([\w.-]*)$/.exec(fragment)?.[1]?.toLowerCase()
  if (mrQuery !== undefined) {
    const seen = new Set<string>()
    return mergeRequests.flatMap((mr): ReferenceSuggestion[] => {
      const reference = parseReference(mr.reference)
      if (reference?.kind !== 'mr' || seen.has(mr.reference)) return []
      const matches = /^\d+$/.test(mrQuery)
        ? String(reference.iid).startsWith(mrQuery)
        : mr.title.toLowerCase().includes(mrQuery) || reference.project.toLowerCase().includes(mrQuery)
      if (!matches) return []
      seen.add(mr.reference)
      return [{ kind: 'reference', token: mr.reference, title: mr.title, reference }]
    })
  }
  if (/^[A-Z][A-Z0-9_]+-\d*$/.test(fragment)) {
    return tickets
      .filter((ticket) => ticket.category !== 'done' && ticket.key.startsWith(fragment))
      .map((ticket) => ({ kind: 'reference', token: ticket.key, title: ticket.summary, reference: { kind: 'jira', key: ticket.key } }))
  }
  return []
}

/** What ends a Reference being typed: a space, a new line or punctuation. */
const ENDS_TOKEN = /^[\s,.;:)\]}?!'"]/
const SHORT_MR = /(?<![\w/.-])!(\d+)(?=[\s,.;:)\]}?!'"])/g

/**
 * References typed in full and followed by a space or punctuation, so ready to become chips while typing. `!<iid>`
 * counts too, as the full token of the one MR in `openMergeRequests` (tokens) with that iid; `start` and `end` then
 * cover the `!<iid>` typed.
 */
export function completedReferences(text: string, { openMergeRequests }: { openMergeRequests: string[] }): FoundReference[] {
  const full = findReferences(text).filter((found) => ENDS_TOKEN.test(text.slice(found.end)))
  const short = [...text.matchAll(SHORT_MR)].flatMap((match): FoundReference[] => {
    const iid = Number(match[1])
    const open = openMergeRequests.map(parseReference).filter((reference) => reference?.kind === 'mr' && reference.iid === iid)
    if (open.length !== 1) return []
    const reference = open[0]!
    return [{ token: referenceToken(reference), start: match.index, end: match.index + match[0].length, reference }]
  })
  return [...full, ...short].toSorted((a, b) => a.start - b.start)
}
