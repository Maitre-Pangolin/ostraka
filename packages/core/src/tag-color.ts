// Tag colours. Pure and free of Node and zod, so the web app can colour a Tag the same way the server does.

/** The colours a Tag can have, in the order of the app's `tag-1`…`tag-8` tokens. */
export const TAG_COLORS = ['orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'red'] as const

export type TagColor = (typeof TAG_COLORS)[number]

/** A Tag in use, with its colour. */
export type Tag = { name: string; color: TagColor }

/** The kinds of content that hold Tags. */
export const TAGGED_KINDS = ['todos', 'notes', 'devlogs', 'sketches'] as const
export type TaggedKind = (typeof TAGGED_KINDS)[number]

/** How many items of each kind use a Tag, or were rewritten by a change to one. A Sub-todo counts as a Todo. */
export type TagCounts = Record<TaggedKind, number>

/** A Tag in use, with how many items of each kind hold it. */
export type TagUsage = Tag & { uses: TagCounts }

/** The colour of a Tag `tags.yml` gives none: the one its name hashes to, so it stays put. */
export const defaultTagColor = (name: string): TagColor =>
  TAG_COLORS[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % TAG_COLORS.length]!
