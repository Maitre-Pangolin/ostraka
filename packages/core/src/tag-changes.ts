// Keeping the shared Tag vocabulary clean: how much each Tag is used, and renaming, merging, deleting and colouring
// one. Tags come from use, so a change to a Tag rewrites every Todo, Note, Dev log and Sketch holding it: the Todos
// in one write of `todos.json`, each Markdown file's `tags:` line under its lock, then its entry in `tags.yml`.
import { z } from 'zod'
import { listDevlogs } from './devlogs.ts'
import { markdownFiles, MarkdownFileNotFoundError, type MarkdownKind } from './markdown-files.ts'
import { listNotes } from './notes.ts'
import { listSketches } from './sketches.ts'
import { defaultTagColor, type Tag, type TagColor } from './tag-color.ts'
import { changeTagSettings, readTagsFile } from './tags.ts'
import { normalizeTag } from './todo-tokens.ts'
import { allTodoItems, retagTodos, type TodoOptions } from './todos.ts'

/** The kinds of content that hold Tags. */
export const TAGGED_KINDS = ['todos', 'notes', 'devlogs', 'sketches'] as const
export type TaggedKind = (typeof TAGGED_KINDS)[number]

/** How many items of each kind: use a Tag, or were rewritten by a change to one. A Sub-todo counts as a Todo. */
export type TagCounts = Record<TaggedKind, number>

/** A Tag in use, with how many items of each kind hold it. */
export type TagUsage = Tag & { uses: TagCounts }

/** The name isn't a Tag: Tags are lowercase letters, digits and hyphens. */
export class TagNameError extends Error {}
/** No Todo, Note, Dev log or Sketch uses the Tag. */
export class TagNotFoundError extends Error {}
/** A rename to a Tag already in use: that is a merge. */
export class TagExistsError extends Error {}

const noCounts = (): TagCounts => ({ todos: 0, notes: 0, devlogs: 0, sketches: 0 })

type Tagged = { id: string; tags: string[] }

/** The Tags of every tagged item, by kind. Files with a broken header hold none and are never rewritten. */
async function taggedItems(options: TodoOptions): Promise<Record<TaggedKind, Tagged[]>> {
  const [todos, notes, devlogs, sketches] = await Promise.all([
    allTodoItems(options),
    listNotes(options),
    listDevlogs(options),
    listSketches(options),
  ])
  const tagged = (items: object[]) => items.filter((item): item is Tagged => 'tags' in item)
  return { todos, notes: tagged(notes), devlogs: tagged(devlogs), sketches: tagged(sketches) }
}

/** Every Tag in use, sorted, with its colour (as `listTags` gives it) and how many items of each kind use it. */
export async function tagUsage(options: TodoOptions = {}): Promise<TagUsage[]> {
  const [items, settings] = await Promise.all([taggedItems(options), readTagsFile(options)])
  const usage = new Map<string, TagCounts>()
  for (const kind of TAGGED_KINDS) {
    for (const item of items[kind]) {
      for (const name of new Set(item.tags)) {
        const uses = usage.get(name) ?? noCounts()
        uses[kind]++
        usage.set(name, uses)
      }
    }
  }
  return [...usage.keys()]
    .toSorted()
    .map((name) => ({ name, color: settings[name]?.color ?? defaultTagColor(name), uses: usage.get(name)! }))
}

/** A Tag as typed (`#Code review` reads `code-review`), or a TagNameError. */
function tagName(typed: string): string {
  const name = normalizeTag(typed.trim().replace(/^#/, ''))
  if (name === undefined) throw new TagNameError(`“${typed}” isn’t a Tag: use lowercase letters, digits and hyphens`)
  return name
}

/** Any Markdown file's header, read only far enough to rewrite its `tags:` line. */
const MARKDOWN = {
  notes: markdownFiles('notes', z.looseObject({})),
  devlogs: markdownFiles('devlogs', z.looseObject({})),
  sketches: markdownFiles('sketches', z.looseObject({})),
} satisfies Record<MarkdownKind, unknown>

/**
 * Replaces Tag `from` with `to` everywhere, or removes it when `to` is undefined. An item holding both keeps one, in
 * the first one's place. Says how many items of each kind changed.
 */
async function rewriteTag(from: string, to: string | undefined, options: TodoOptions): Promise<TagCounts> {
  const retag = (tags: string[]) => [...new Set(tags.flatMap((tag) => (tag === from ? (to === undefined ? [] : [to]) : [tag])))]
  const items = await taggedItems(options)
  const changed = noCounts()
  changed.todos = await retagTodos(retag, options)
  for (const kind of ['notes', 'devlogs', 'sketches'] as const) {
    for (const { id } of items[kind].filter((item) => item.tags.includes(from))) {
      try {
        await MARKDOWN[kind].update(
          id,
          ({ header }) => {
            const tags = Array.isArray(header.tags) ? (header.tags as string[]) : []
            return tags.includes(from) ? { header: { tags: retag(tags) } } : {}
          },
          options,
        )
        changed[kind]++
      } catch (error) {
        if (!(error instanceof MarkdownFileNotFoundError)) throw error // Removed meanwhile: nothing left to rewrite.
      }
    }
  }
  return changed
}

async function assertInUse(name: string, options: TodoOptions): Promise<TagUsage[]> {
  const usage = await tagUsage(options)
  if (!usage.some((tag) => tag.name === name)) throw new TagNotFoundError(`No Todo, Note, Dev log or Sketch uses the Tag ${name}`)
  return usage
}

/**
 * Renames a Tag on every Todo, Sub-todo, Note, Dev log and Sketch, and carries its colour over. Refused when the
 * new name is already in use: that is a merge.
 */
export async function renameTag(from: string, typed: string, options: TodoOptions = {}): Promise<TagCounts> {
  const to = tagName(typed)
  const usage = await assertInUse(from, options)
  if (to === from) return noCounts()
  if (usage.some((tag) => tag.name === to)) throw new TagExistsError(`The Tag ${to} is already in use: merge ${from} into it instead`)
  const settings = (await readTagsFile(options))[from]
  const changed = await rewriteTag(from, to, options)
  await changeTagSettings({ [from]: undefined, [to]: settings }, options)
  return changed
}

/**
 * Merges a Tag into another on every Todo, Sub-todo, Note, Dev log and Sketch: an item holding both keeps the other
 * once. The Tag merged into keeps its colour; the merged one's entry in `tags.yml` goes.
 */
export async function mergeTag(from: string, typed: string, options: TodoOptions = {}): Promise<TagCounts> {
  const into = tagName(typed)
  if (into === from) throw new TagNameError(`A Tag can’t be merged into itself`)
  await assertInUse(from, options)
  const changed = await rewriteTag(from, into, options)
  await changeTagSettings({ [from]: undefined }, options)
  return changed
}

/** Removes a Tag from every Todo, Sub-todo, Note, Dev log and Sketch, and its entry in `tags.yml`. */
export async function deleteTag(name: string, options: TodoOptions = {}): Promise<TagCounts> {
  await assertInUse(name, options)
  const changed = await rewriteTag(name, undefined, options)
  await changeTagSettings({ [name]: undefined }, options)
  return changed
}

/** Saves a Tag's colour to `tags.yml`; without one, the Tag goes back to the colour its name hashes to. */
export async function setTagColor(typed: string, color: TagColor | undefined, options: TodoOptions = {}): Promise<void> {
  const name = tagName(typed)
  const settings = (await readTagsFile(options))[name]
  await changeTagSettings({ [name]: { ...settings, color } }, options)
}
