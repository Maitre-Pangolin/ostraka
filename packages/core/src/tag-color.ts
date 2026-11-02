// Tag colours. Pure and free of Node and zod, so the web app can colour a Tag the same way the server does.

/** The colours a Tag can have, in the order of the app's `tag-1`…`tag-8` tokens. */
export const TAG_COLORS = ['orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'red'] as const

export type TagColor = (typeof TAG_COLORS)[number]

/** A Tag in use, with its colour. */
export type Tag = { name: string; color: TagColor }

/** The colour of a Tag `tags.yml` gives none: the one its name hashes to, so it stays put. */
export const defaultTagColor = (name: string): TagColor =>
  TAG_COLORS[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % TAG_COLORS.length]!
