// Search for the app and the CLI: the server's index, rebuilt from the files on start and kept current from the
// content watcher, and `GET /api/search`.
import {
  openSearchIndex,
  parseSearchParams,
  resolveContentRoot,
  searchContent,
  type ContentRootOptions,
  type SearchHit,
  type SearchQuery,
} from '@ostraka/core'
import { Hono } from 'hono'
import { contentEvents, type ContentEvents } from './content-events.ts'

export type Search = {
  /** Hits for a query, or undefined while the index is still being built. */
  search(query: SearchQuery): Promise<SearchHit[] | undefined>
  /** Stops following changes and closes the index. */
  stop(): Promise<void>
}

export type SearchOptions = {
  content: ContentRootOptions
  /** The index file (`searchIndexPath()` in production, outside the content folder); in memory without one. */
  file?: string
  /** Changes to the content folder; the server shares its watcher. */
  events?: ContentEvents
  /** Awaited before the first build: lets tests see the index while it is being built. */
  beforeRebuild?: () => Promise<void>
}

/**
 * Opens an empty index, follows content changes, then builds it from the files in the background. Changes seen
 * during the build are read in after it, in order.
 */
export async function startSearch({ content, file, events = contentEvents(content), beforeRebuild }: SearchOptions): Promise<Search> {
  const index = await openSearchIndex({ file, content })
  const unsubscribe = await events.subscribe((change) => {
    index.refresh(change).catch(() => {}) // A file that can't be read is left out; the next change reads it again.
  })
  let built = false
  const building = (async () => {
    await beforeRebuild?.()
    await index.rebuild()
    built = true
  })()
  building.catch(() => {})
  return {
    async search(query) {
      if (!built) return undefined
      // A change already seen is in the index before answering, so a live update's refetch finds it.
      await index.idle().catch(() => {})
      return index.search(query)
    },
    async stop() {
      unsubscribe()
      await building.catch(() => {})
      await index.idle().catch(() => {})
      index.close()
    },
  }
}

/** Without a running index: a throwaway one, built in memory for each query. */
export const throwawaySearch = (content: ContentRootOptions): Pick<Search, 'search'> => ({
  search: (query) => searchContent(query, content),
})

/** Says which content folder the hits come from, so the CLI only uses a server that serves its own. */
export const CONTENT_ROOT_HEADER = 'x-ostraka-content-root'

export function searchRoutes(search: Pick<Search, 'search'>, content: ContentRootOptions) {
  return new Hono().get('/', async (c) => {
    c.header(CONTENT_ROOT_HEADER, encodeURIComponent(await resolveContentRoot(content)))
    let query: SearchQuery
    try {
      query = parseSearchParams(new URL(c.req.url).searchParams)
    } catch (error) {
      const issues = (error as { issues?: { message: string }[] }).issues
      const message = issues ? issues.map((issue) => issue.message).join('; ') : String(error)
      return c.json({ error: message }, 400)
    }
    try {
      const hits = await search.search(query)
      return c.json(hits ? { indexing: false, hits } : { indexing: true, hits: [] })
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
    }
  })
}
