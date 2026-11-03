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
