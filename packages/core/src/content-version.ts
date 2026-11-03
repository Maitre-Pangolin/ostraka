// Optimistic concurrency for content shared with agents: a change made from a loaded copy names the version it
// loaded, and is refused if the content changed since. A version is a hash of one item's current content: a
// Markdown file's text, or one Todo inside todos.json, so a change to another Todo never makes a copy stale.
import { createHash } from 'node:crypto'

/** The version of some content: a short hash of its exact text. */
export function contentVersion(text: string): string {
  return createHash('sha256').update(text).digest('base64url').slice(0, 16)
}

/** The content changed since the copy a change was made from was loaded (by an agent, the CLI or another tab). */
export class StaleVersionError extends Error {}

/** Refuses a change made from an older copy. `loaded` is the version the change was made from; none skips the check. */
export function assertCurrentVersion(loaded: string | undefined, current: string, what: string): void {
  if (loaded !== undefined && loaded !== current) throw new StaleVersionError(`${what} changed since it was loaded.`)
}
