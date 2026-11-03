// Live updates: the server streams `{kind, id?}` whenever a content file changes, whoever changed it (this app,
// the CLI, an agent). Each event invalidates the queries of that kind, so the cache refetches; there is no
// second client store. Query keys therefore start with the content kind: `['todos', …]`, `['notes', id]`.
// The work overview's sources arrive the same way, as `{ kind: 'activity', id: source }`.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

type LiveChange = { kind: string; id?: string }

/** This window, as the server knows it: the work overview polls faster while any window is visible. */
const CLIENT = crypto.randomUUID()

/** Tells the server whether this window shows the app. It owns the polling schedule; the window only reports. */
function reportVisibility() {
  void fetch('/api/activity/visibility', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client: CLIENT, visible: document.visibilityState === 'visible' }),
    // Still sent when the window is closing.
    keepalive: true,
  }).catch(() => {})
}

/** Keeps every content query current while the app is open. Mounted once, inside the QueryClientProvider. */
export function LiveUpdates() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const events = new EventSource(`/api/events?client=${CLIENT}`)
    events.addEventListener('message', (event) => {
      const { kind } = JSON.parse(event.data as string) as LiveChange
      void queryClient.invalidateQueries({ queryKey: [kind] })
      // Tags are gathered from every kind's content, and search covers every kind.
      if (kind !== 'activity') {
        void queryClient.invalidateQueries({ queryKey: ['tags'] })
        void queryClient.invalidateQueries({ queryKey: ['search'] })
      }
    })
    // `ready` starts every connection, the first and each reconnect: changes made while the stream was down
    // (or before it was up) were never sent, so everything shown is refetched. The server knows this window
    // only from its stream, so it reports its visibility again.
    events.addEventListener('ready', () => {
      reportVisibility()
      void queryClient.invalidateQueries()
    })
    document.addEventListener('visibilitychange', reportVisibility)
    return () => {
      document.removeEventListener('visibilitychange', reportVisibility)
      events.close()
    }
  }, [queryClient])

  return null
}
