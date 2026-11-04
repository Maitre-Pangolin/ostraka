// Calls to the running `ostraka serve` on 127.0.0.1:4747, only when it serves the same content folder as this command.
import { CONTENT_ROOT_HEADER, HOSTNAME, PORT } from '@ostraka/server'
import type { Io } from './main.ts'

export type ServerAnswer =
  /** The server serving this content folder answered (any status). */
  | { kind: 'answered'; res: Response }
  /** No server is listening, or it did not answer in time. */
  | { kind: 'down' }
  /** A server answered for another content folder (`root` is the one it serves, if it said). */
  | { kind: 'elsewhere'; root: string | undefined }

/** Sends `path` (under `/api`) to the running server and says who answered. */
export async function askServer(path: string, root: string, io: Io, init: RequestInit & { timeoutMs: number }): Promise<ServerAnswer> {
  const fetch = io.fetch ?? globalThis.fetch
  const { timeoutMs, ...request } = init
  let res: Response
  try {
    res = await fetch(`http://${HOSTNAME}:${PORT}/api${path}`, { ...request, signal: AbortSignal.timeout(timeoutMs) })
  } catch {
    return { kind: 'down' }
  }
  const served = res.headers.get(CONTENT_ROOT_HEADER)
  const servedRoot = served === null ? undefined : decodeURIComponent(served)
  return servedRoot === root ? { kind: 'answered', res } : { kind: 'elsewhere', root: servedRoot }
}
