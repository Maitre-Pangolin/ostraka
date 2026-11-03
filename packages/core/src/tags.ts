import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { z } from 'zod'
import { contentPath } from './content-path.ts'
import type { ContentRootOptions } from './content-root.ts'
import { TagsFileSchema, type TagsFile } from './tag-schema.ts'

export class TagsFileError extends Error {}

/** Reads and validates `tags.yml`; an absent or empty file means no settings. */
export async function readTagsFile(options: ContentRootOptions = {}): Promise<TagsFile> {
  const file = await contentPath('tags', options)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  let raw: unknown
  try {
    raw = parse(text) ?? {}
  } catch (error) {
    throw new TagsFileError(`Invalid ${file}: ${(error as Error).message}`)
  }
  const result = TagsFileSchema.safeParse(raw)
  if (!result.success) throw new TagsFileError(`Invalid ${file}:\n${z.prettifyError(result.error)}`)
  return result.data
}
