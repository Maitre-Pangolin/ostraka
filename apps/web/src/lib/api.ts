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

const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, {
    method,
    ...(body !== undefined && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })

export const post = <T>(path: string, body?: unknown) => send<T>('POST', path, body)
export const patch = <T>(path: string, body: unknown) => send<T>('PATCH', path, body)

/** TanStack Query retry policy: retry a dropped connection a couple of times, never an answer such as a broken file. */
export const retryUnanswered = (failures: number, error: Error) => !(error instanceof ApiError) && failures < 2
