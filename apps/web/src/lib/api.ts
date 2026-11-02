// Calls to the server API under /api, which answers JSON and `{ error }` on failure.

/** The server answered with an error: retrying won't change its answer. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new ApiError(res.status, body.error ?? `${res.status} ${res.statusText}`)
  return body
}

/**
 * A change to an existing item passes the `version` of the copy it was made from, as `If-Match`: the server refuses
 * it (412) if the item changed since, and `isStale` tells that apart. Live updates have already refetched the newer copy.
 */
export const ifMatch = (version: string): HeadersInit => ({ 'if-match': `"${version}"` })

export const post = <T>(path: string, body?: unknown, { version }: { version?: string } = {}) =>
  request<T>(path, {
    method: 'POST',
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(version !== undefined && ifMatch(version)),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })

/** The change was refused because the item changed elsewhere (an agent, the CLI, another tab) since it was loaded. */
export const isStale = (error: Error) => error instanceof ApiError && error.status === 412

/** TanStack Query retry policy: retry a dropped connection a couple of times, never an answer such as a broken file. */
export const retryUnanswered = (failures: number, error: Error) => !(error instanceof ApiError) && failures < 2
