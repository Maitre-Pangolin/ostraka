// Search over the server API. The key starts with 'search', which live updates refetch on any content change.
import { searchParams, type SearchHit, type SearchKind } from '@ostraka/core/search-types'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { request, retryUnanswered } from '@/lib/api'

export type { SearchHit, SearchKind }

/** The server's answer: hits, or `indexing` while it builds its index from the files. */
export type SearchAnswer = { indexing: boolean; hits: SearchHit[] }

/** Hits for the typed text, ranked by the server; asked again every half second while it is still indexing. */
export function useSearch(text: string) {
  const enabled = text.trim() !== ''
  return useQuery({
    queryKey: ['search', text],
    queryFn: () => request<SearchAnswer>(`/search?${searchParams({ text })}`),
    enabled,
    // The previous hits stay while the next ones load, so the list doesn't flicker as you type.
    placeholderData: enabled ? keepPreviousData : undefined,
    refetchInterval: (query) => (query.state.data?.indexing ? 500 : false),
    retry: retryUnanswered,
  })
}
