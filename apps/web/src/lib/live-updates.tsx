// Live updates: the server streams `{kind, id?}` whenever a content file changes, whoever changed it (this app,
// the CLI, an agent). Each event invalidates the queries of that kind, so the cache refetches; there is no
// second client store. Query keys therefore start with the content kind: `['todos', …]`, `['notes', id]`.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

type ContentChange = { kind: string; id?: string }

/** Keeps every content query current while the app is open. Mounted once, inside the QueryClientProvider. */
export function LiveUpdates() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const events = new EventSource('/api/events')
    events.addEventListener('message', (event) => {
      const { kind } = JSON.parse(event.data as string) as ContentChange
      void queryClient.invalidateQueries({ queryKey: [kind] })
    })
    // `ready` starts every connection, the first and each reconnect: changes made while the stream was down
    // (or before it was up) were never sent, so everything shown is refetched.
    events.addEventListener('ready', () => void queryClient.invalidateQueries())
    return () => events.close()
  }, [queryClient])

  return null
}
