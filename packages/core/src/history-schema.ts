// A content file's history: the Snapshots that changed it, and a restore of one of them. Imports only zod, so the
// web app can share these types.
import { z } from 'zod'

/** A Snapshot in a file's history: its commit, message, and when it was made (ISO 8601 with offset). */
export type FileSnapshot = { commit: string; message: string; date: string }

/** One version of a file: its text exactly as a Snapshot held it. */
export type FileVersion = { path: string; commit: string; text: string }

/**
 * What a restore did: the Snapshot it made (none when the file already was that version), and the Snapshot of the
 * content folder just before it; restoring `before` undoes the restore.
 */
export type Restore = { restored: FileSnapshot | undefined; before: FileSnapshot | undefined }

/** A restore asked for: a content file (relative to the content folder, `/` separators) and a Snapshot's commit. */
export const RestoreFileSchema = z.strictObject({
  path: z.string().min(1, 'path is required'),
  commit: z.string().min(1, 'commit is required'),
})
export type RestoreFile = z.infer<typeof RestoreFileSchema>
