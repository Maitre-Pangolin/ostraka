// Search over the server API. The key starts with 'search', which live updates refetch on any content change.
import { searchParams, type SearchHit, type SearchKind, type SearchQuery } from '@ostraka/core/search-types'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { request, retryUnanswered } from '@/lib/api'

export type { SearchHit, SearchKind, SearchQuery }

/** The server's answer: hits, or `indexing` while it builds its index from the files. */
export type SearchAnswer = { indexing: boolean; hits: SearchHit[] }

/** Hits for a query, ranked by the server; none asked for without one. Asked again every half second while indexing. */
export function useSearch(query: SearchQuery | undefined) {
  const params = query ? searchParams(query).toString() : ''
  const enabled = query !== undefined
  return useQuery({
    queryKey: ['search', params],
    queryFn: () => request<SearchAnswer>(`/search?${params}`),
    enabled,
    // The previous hits stay while the next ones load, so the list doesn't flicker as you type.
    placeholderData: enabled ? keepPreviousData : undefined,
    refetchInterval: (state) => (state.state.data?.indexing ? 500 : false),
    retry: retryUnanswered,
  })
}

/** As many hits of one kind as the server gives, for a section's search box. */
const SECTION_LIMIT = 200

/**
 * A section's search box: the hits of its kind for the typed text, by id. `found` is undefined while nothing is
 * typed (the section isn't narrowed) and while the first answer is on its way.
 */
export function useSectionSearch(kind: SearchKind, text: string | undefined) {
  const typed = text?.trim() ? text : undefined
  const search = useSearch(typed ? { text: typed, kinds: [kind], limit: SECTION_LIMIT } : undefined)
  const data = typed ? search.data : undefined
  const hits = useMemo(() => (data && !data.indexing ? new Map(data.hits.map((hit) => [hit.id, hit])) : undefined), [data])
  const found = useMemo(() => (hits ? new Set(hits.keys()) : undefined), [hits])
  return { found, hits, indexing: data?.indexing === true, error: typed ? search.error : null }
}
