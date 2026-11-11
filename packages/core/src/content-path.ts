import { basename, extname, join, sep } from 'node:path'
import { resolveContentRoot, type ContentRootOptions } from './content-root.ts'

const LOCATIONS = {
  todos: 'todos.json',
  notes: 'notes',
  devlogs: 'devlogs',
  sketches: 'sketches',
  people: 'people.json',
  tags: 'tags.yml',
} as const

export type ContentKind = keyof typeof LOCATIONS

export const CONTENT_KINDS = Object.keys(LOCATIONS) as ContentKind[]

export function isContentKind(value: string): value is ContentKind {
  return Object.hasOwn(LOCATIONS, value)
}

/** Where a kind of content lives: a file for todos, people and Tag colours, a folder for the Markdown kinds. */
export async function contentPath(kind: ContentKind, options?: ContentRootOptions): Promise<string> {
  return join(await resolveContentRoot(options), LOCATIONS[kind])
}

/** A change to content: a whole kind (`todos.json`, `people.json`), or one item of a Markdown kind by its id. */
export type ContentChange = { kind: ContentKind; id?: string }

/**
 * Which content a path relative to the content root holds, or undefined for anything else (lock and temp files,
 * hidden files, the git folder). A Markdown kind's items are `<folder>/<id>.md`.
 */
export function contentChangeAt(relativePath: string): ContentChange | undefined {
  const [first, second, ...rest] = relativePath.split(sep)
  if (!first || rest.length) return undefined
  const kind = CONTENT_KINDS.find((candidate) => LOCATIONS[candidate] === first)
  if (!kind) return undefined
  const isFolder = !extname(first)
  if (second === undefined) return { kind }
  if (!isFolder || second.startsWith('.') || extname(second) !== '.md') return undefined
  return { kind, id: basename(second, '.md') }
}

/** The path does not name a content file: it leads out of the content folder, into its git folder, or to a folder. */
export class ContentPathError extends Error {}

/**
 * Checks that a path names one content file, relative to the content root with `/` separators (`todos.json`,
 * `notes/<id>.md`), and says which content it holds. Folders, lock and temp files and the git folder are refused.
 */
export function contentFileAt(path: string): ContentChange {
  const change = path.includes('\\') ? undefined : contentChangeAt(path.split('/').join(sep))
  if (!change || (change.id === undefined && !extname(path))) throw new ContentPathError(`Not a content file: ${path}`)
  return change
}
