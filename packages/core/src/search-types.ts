// What search takes and finds, shared with the web app: free of Node.
import { z } from 'zod'
import type { TodoStatus } from './todo-schema.ts'

export const SEARCH_KINDS = ['todo', 'note', 'devlog', 'sketch'] as const
export type SearchKind = (typeof SEARCH_KINDS)[number]

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a day as YYYY-MM-DD')

/** What to find: words and `"phrases"`, narrowed by Tags, kinds and local days (`from` and `to` included). */
export const SearchQuerySchema = z.strictObject({
  text: z.string().default(''),
  tags: z.array(z.string()).optional(),
  /** `all` (default): every Tag given; `any`: at least one. */
  tagMatch: z.enum(['all', 'any']).optional(),
  kinds: z.array(z.enum(SEARCH_KINDS, `Kinds are ${SEARCH_KINDS.join(', ')}`)).optional(),
  from: day.optional(),
  to: day.optional(),
  /** At most this many hits of each kind (default 20). */
  limit: z.number('limit is a number').int().min(1).max(200).optional(),
})
export type SearchQuery = z.input<typeof SearchQuerySchema>

/** A query as URL search params (`/api/search?q=…&tag=…&kind=…`), repeated for each Tag and kind. */
export function searchParams({ text, tags = [], tagMatch, kinds = [], from, to, limit }: SearchQuery): URLSearchParams {
  const params = new URLSearchParams()
  if (text) params.set('q', text)
  for (const tag of tags) params.append('tag', tag)
  if (tagMatch) params.set('tagMatch', tagMatch)
  for (const kind of kinds) params.append('kind', kind)
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (limit !== undefined) params.set('limit', String(limit))
  return params
}

/** URL search params back to a checked query; throws a ZodError naming what is wrong. */
export function parseSearchParams(params: URLSearchParams): SearchQuery {
  const one = (key: string) => params.get(key) ?? undefined
  const many = (key: string) => (params.has(key) ? params.getAll(key) : undefined)
  return SearchQuerySchema.parse({
    text: one('q'),
    tags: many('tag'),
    tagMatch: one('tagMatch'),
    kinds: many('kind'),
    from: one('from'),
    to: one('to'),
    limit: params.has('limit') ? Number(params.get('limit')) : undefined,
  })
}

/** A run of a snippet's text, `match` where the query matched. */
export type SnippetPiece = { text: string; match?: true }

/**
 * One item found. `title` is a Dev log's day (`YYYY-MM-DD`) or a monthly summary's month (`YYYY-MM`); `date` is the
 * local day the item is dated by: a Todo's finish (else its creation), a Note's or Sketch's last change, a Dev
 * log's day, a monthly summary's first day.
 */
export type SearchHit = {
  kind: SearchKind
  id: string
  title: string
  date: string
  tags: string[]
  /** The text around the best match, from the body (a Todo's description). Empty when the body has none. */
  snippet: SnippetPiece[]
  /** A Todo's or Sub-todo's state. */
  status?: TodoStatus
  /** A Sub-todo's parent Todo. */
  parentId?: string
}
