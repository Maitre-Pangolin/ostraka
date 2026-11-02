import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
})

/** GETs a JSON route under /api. A non-2xx answer throws with the server's `error` message when it sends one. */
export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: { accept: 'application/json' } })
  const body = (await res.json().catch(() => undefined)) as (T & { error?: string }) | undefined
  if (!res.ok) throw new Error(body?.error ?? `${res.status} ${res.statusText}`)
  return body as T
}
