// `ostraka search`: the running server's index when it serves this content folder, else the files directly.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  parseSearchParams,
  resolveContentRoot,
  SEARCH_KINDS,
  searchContent,
  searchParams,
  type ContentKind,
  type SearchHit,
  type SearchKind,
  type SearchQuery,
} from '@ostraka/core'
import type { Io } from './main.ts'
import { askServer } from './server.ts'

export const SEARCH_USAGE = `  ostraka search [<query>] [--tag <tag>]... [--kind <${SEARCH_KINDS.join('|')}>]... [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>] [--json]
                                Find Notes, Dev logs, Todos and Sketches: each word a prefix,
                                "a phrase" exactly, a Reference or @mention as a whole token;
                                every --tag must be on a hit; newest first with no query
`

const FOLDERS: Record<SearchKind, ContentKind> = { todo: 'todos', note: 'notes', devlog: 'devlogs', sketch: 'sketches' }

/** The hits from the running server when it serves this content folder and its index is built; else undefined. */
async function searchServer(query: SearchQuery, root: string, io: Io): Promise<SearchHit[] | undefined> {
  // Not running, or for another folder: the files are searched directly.
  const answer = await askServer(`/search?${searchParams(query)}`, root, io, { timeoutMs: 5000 })
  if (answer.kind !== 'answered' || !answer.res.ok) return undefined
  try {
    const { indexing, hits } = (await answer.res.json()) as { indexing: boolean; hits: SearchHit[] }
    return indexing ? undefined : hits
  } catch {
    return undefined
  }
}

export async function searchCommand(args: string[], io: Io): Promise<number> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: 'boolean' },
      tag: { type: 'string', multiple: true },
      kind: { type: 'string', multiple: true },
      from: { type: 'string' },
      to: { type: 'string' },
    },
  })
  const text = positionals.join(' ')
  if (!text.trim() && !values.tag && !values.kind && !values.from && !values.to) {
    io.stderr(`Usage:\n${SEARCH_USAGE}`)
    return 1
  }
  // Checked as the server checks it, whichever ends up answering.
  const query = parseSearchParams(
    searchParams({ text, tags: values.tag, kinds: values.kind as SearchKind[], from: values.from, to: values.to }),
  )
  const options = { env: io.env, homeDir: io.homeDir ?? homedir() }
  const root = await resolveContentRoot(options)
  const hits = (await searchServer(query, root, io)) ?? (await searchContent(query, options))
  const withPaths = hits.map((hit) => ({
    ...hit,
    ...(hit.kind !== 'todo' && { path: join(root, FOLDERS[hit.kind], `${hit.id}.md`) }),
  }))
  if (values.json) {
    io.stdout(`${JSON.stringify(withPaths, null, 2)}\n`)
    return 0
  }
  const lines = withPaths.map((hit) => {
    const status = hit.status && hit.status !== 'open' ? [hit.status === 'done' ? '(done)' : '(Dropped)'] : []
    const parent = hit.parentId ? [`(Sub-todo of ${hit.parentId})`] : []
    const head = [
      hit.kind,
      hit.id,
      hit.title,
      hit.date,
      ...(hit.tags.length ? [hit.tags.map((tag) => `#${tag}`).join(' ')] : []),
      ...status,
      ...parent,
    ]
    const snippet = hit.snippet
      .map((piece) => (piece.match ? `**${piece.text}**` : piece.text))
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
    return [head.join('  '), ...('path' in hit ? [`  ${hit.path}`] : []), ...(snippet ? [`  ${snippet}`] : [])].join('\n')
  })
  io.stdout(lines.length ? `${lines.join('\n')}\n` : 'Nothing found.\n')
  return 0
}
