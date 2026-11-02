import { join } from 'node:path'
import { resolveContentRoot, type ContentRootOptions } from './content-root.ts'

const LOCATIONS = {
  todos: 'todos.json',
  notes: 'notes',
  devlogs: 'devlogs',
  sketches: 'sketches',
  people: 'people.json',
} as const

export type ContentKind = keyof typeof LOCATIONS

export const CONTENT_KINDS = Object.keys(LOCATIONS) as ContentKind[]

export function isContentKind(value: string): value is ContentKind {
  return Object.hasOwn(LOCATIONS, value)
}

/** Where a kind of content lives: a file for todos and people, a folder for the Markdown kinds. */
export async function contentPath(kind: ContentKind, options?: ContentRootOptions): Promise<string> {
  return join(await resolveContentRoot(options), LOCATIONS[kind])
}
