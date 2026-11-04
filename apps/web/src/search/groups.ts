// How ⌘K lays out the server's ranked hits.
import type { SearchHit, SearchKind } from '@ostraka/core/search-types'

/** One kind's hits, kinds in the order of their best hit. The server's ranking is kept within each. */
export function groupHits(hits: SearchHit[]): { kind: SearchKind; hits: SearchHit[] }[] {
  const groups = new Map<SearchKind, SearchHit[]>()
  for (const hit of hits) groups.set(hit.kind, [...(groups.get(hit.kind) ?? []), hit])
  return [...groups].map(([kind, kindHits]) => ({ kind, hits: kindHits }))
}
