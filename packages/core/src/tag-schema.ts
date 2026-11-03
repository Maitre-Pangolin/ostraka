// The `tags.yml` format: colours and settings per Tag. Tags themselves come from use, never from this file.
import { z } from 'zod'
import { TAG_COLORS } from './tag-color.ts'

export const TagSettingsSchema = z.strictObject({ color: z.enum(TAG_COLORS).optional() })

/** `tags.yml`: Tag name → its settings. */
export const TagsFileSchema = z.record(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Tags are lowercase and hyphenated'), TagSettingsSchema)

export type TagSettings = z.infer<typeof TagSettingsSchema>
export type TagsFile = z.infer<typeof TagsFileSchema>
