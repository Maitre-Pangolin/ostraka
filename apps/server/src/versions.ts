// Optimistic concurrency over HTTP. Items carry the `version` they were read at; a change made from that copy sends
// it back as `If-Match`, and core refuses it if the item changed since (answered 412 with `{ error }`). A request
// without `If-Match` (the CLI, an agent) is not checked.
import type { Context } from 'hono'

/** The item with the version a change made from this copy sends back. */
export const withVersion = <T>(item: T, version: string): T & { version: string } => ({ ...item, version })

/** The version the request's change was made from, from `If-Match: "<version>"`; undefined for none or `*`. */
export function loadedVersion(c: Context): string | undefined {
  const header = c.req.header('if-match')?.trim()
  if (!header || header === '*') return undefined
  return header.replace(/^W\//, '').replace(/^"(.*)"$/, '$1')
}

/** An item posted back as the API answered it, without the `version` the API added. */
export function withoutVersion(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('version' in value)) return value
  const { version: _version, ...item } = value
  return item
}
