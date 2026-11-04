import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { isMap, isScalar, parseDocument } from 'yaml'
import { z } from 'zod'
import { contentPath } from './content-path.ts'
import type { ContentRootOptions } from './content-root.ts'
import { withFileLock, writeFileAtomic, type LockOptions } from './locked-file.ts'
import { TagsFileSchema, type TagSettings, type TagsFile } from './tag-schema.ts'

export class TagsFileError extends Error {}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function validate(file: string, raw: unknown): TagsFile {
  const result = TagsFileSchema.safeParse(raw)
  if (!result.success) throw new TagsFileError(`Invalid ${file}:\n${z.prettifyError(result.error)}`)
  return result.data
}

/** Reads and validates `tags.yml`; an absent or empty file means no settings. */
export async function readTagsFile(options: ContentRootOptions = {}): Promise<TagsFile> {
  const file = await contentPath('tags', options)
  const text = await readText(file)
  if (text === undefined) return {}
  const doc = parseDocument(text)
  if (doc.errors.length) throw new TagsFileError(`Invalid ${file}: ${doc.errors[0]!.message}`)
  return validate(file, doc.toJS() ?? {})
}

/**
 * Changes some Tags' settings in `tags.yml` under its lock: each Tag named gets the settings given, or loses its
 * entry when they are undefined or empty. Other entries and comments stay as they are; a broken file is refused.
 */
export async function changeTagSettings(
  changes: Record<string, TagSettings | undefined>,
  options: ContentRootOptions & { lock?: LockOptions } = {},
): Promise<TagsFile> {
  const file = await contentPath('tags', options)
  await mkdir(dirname(file), { recursive: true })
  return withFileLock(
    file,
    async () => {
      const text = (await readText(file)) ?? ''
      const doc = parseDocument(text)
      if (doc.errors.length) throw new TagsFileError(`Invalid ${file}: ${doc.errors[0]!.message}`)
      validate(file, doc.toJS() ?? {})
      for (const [name, settings] of Object.entries(changes)) {
        const keep = settings && Object.values(settings).some((value) => value !== undefined)
        if (keep) doc.set(name, doc.createNode(settings))
        else removeEntry(doc, name)
      }
      const next = isMap(doc.contents) && doc.contents.items.length === 0 && !doc.commentBefore && !doc.comment ? '' : String(doc)
      const written = validate(file, parseDocument(next).toJS() ?? {})
      if (next !== text) await writeFileAtomic(file, next)
      return written
    },
    options.lock,
  )
}

/** Removes a Tag's entry. A comment above the first entry heads the file, so it moves to the entry after it. */
function removeEntry(doc: ReturnType<typeof parseDocument>, name: string) {
  if (!isMap(doc.contents)) return
  const items = doc.contents.items
  const index = items.findIndex((pair) => (isScalar(pair.key) ? pair.key.value : pair.key) === name)
  if (index === -1) return
  const heading = index === 0 && isScalar(items[0]!.key) ? items[0]!.key.commentBefore : undefined
  items.splice(index, 1)
  const next = items[0]
  if (!heading) return
  if (!next) {
    doc.commentBefore = heading
    return
  }
  // An entry set in this same change has a plain key, with nowhere to hold a comment yet.
  const key = isScalar(next.key) ? next.key : doc.createNode(next.key)
  key.commentBefore = [heading, key.commentBefore].filter(Boolean).join('\n')
  next.key = key
}
