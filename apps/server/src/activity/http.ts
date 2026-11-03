// Outgoing calls to Activity sources. Error messages name the host and the status, never a header (the token).

export type Fetch = typeof globalThis.fetch

/** An Activity source answered with an error status. */
export class SourceHttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Calls `url` and returns its JSON body; `what` names the source in error messages. */
export async function getJson<T>(fetch: Fetch, url: string, what: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (error) {
    const cause = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error)
    throw new Error(`Could not reach ${new URL(url).host}: ${cause}`, { cause: error })
  }
  if (!res.ok) {
    await res.body?.cancel()
    throw new SourceHttpError(res.status, failure(what, res.status))
  }
  return (await res.json()) as T
}

function failure(what: string, status: number): string {
  if (status === 401) return `${what} refused the token (401). Check its Keychain item.`
  if (status === 403) return `${what} denied access (403). Check the token's scopes.`
  if (status === 429) return `${what} is rate limiting (429).`
  return `${what} answered ${status}.`
}
