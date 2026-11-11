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

// The app's own changes move an item from one version to the next. A later change made from a copy older than
// them goes on from where they left it, so the app never conflicts with itself before its cache refetches.
const ownChanges = new Map<string, string>()
const afterOwnChanges = (version: string) => {
  while (ownChanges.has(version)) version = ownChanges.get(version)!
  return version
}

/**
 * A restore can bring a file back to a version the app moved on from: a later change made from that version must
 * name it, not where the app's own changes once led. Called as a restore starts.
 */
export const forgetOwnChanges = () => ownChanges.clear()

/** `keepalive` lets the request finish while the page closes (a save on leaving). */
type Send = { version?: string; keepalive?: boolean }

async function send<T>(method: string, path: string, body?: unknown, { version, keepalive }: Send = {}): Promise<T> {
  const from = version === undefined ? undefined : afterOwnChanges(version)
  const answer = await request<T>(path, {
    method,
    ...(keepalive && { keepalive }),
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(from !== undefined && ifMatch(from)),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })
  const to = (answer as { version?: unknown }).version
  if (from !== undefined && typeof to === 'string' && to !== from) ownChanges.set(from, to)
  return answer
}

export const post = <T>(path: string, body?: unknown, options?: Send) => send<T>('POST', path, body, options)
export const patch = <T>(path: string, body: unknown, options?: Send) => send<T>('PATCH', path, body, options)
export const remove = <T>(path: string, options?: Send) => send<T>('DELETE', path, undefined, options)

/** The change was refused because the item changed elsewhere (an agent, the CLI, another tab) since it was loaded. */
export const isStale = (error: Error) => error instanceof ApiError && error.status === 412

/** TanStack Query retry policy: retry a dropped connection a couple of times, never an answer such as a broken file. */
export const retryUnanswered = (failures: number, error: Error) => !(error instanceof ApiError) && failures < 2
