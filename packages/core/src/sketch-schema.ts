// The Sketch format: `sketches/<id>.md`, a YAML header (title, Tags) then a Markdown body holding one Mermaid block.
// Imports only zod, so the web app can share these types.
import { z } from 'zod'

/** Flat, lowercase and hyphenated, as on Todos and Notes. */
const tag = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Tags are lowercase and hyphenated')
const title = z.string().trim().min(1, 'A Sketch needs a title')

/** A Sketch's header: a title, and Tags as `tags: [...]`. Other keys are kept as they are. */
export const SketchHeaderSchema = z.looseObject({ title, tags: z.array(tag).default([]) })
export type SketchHeader = z.infer<typeof SketchHeaderSchema>

/** What starting a Sketch takes: its title and Tags. */
export const NewSketchSchema = z.strictObject({ title, tags: z.array(tag).optional() })
export type NewSketch = z.infer<typeof NewSketchSchema>

/** A change to a Sketch: its Mermaid text, title, Tags, or any of them. */
export const SketchChangeSchema = z.strictObject({ mermaid: z.string().optional(), title: title.optional(), tags: z.array(tag).optional() })
export type SketchChange = z.infer<typeof SketchChangeSchema>

/** A Sketch as read: `version` is a hash of the whole file, `modifiedAt` its last change on disk. */
export type Sketch = {
  id: string
  version: string
  modifiedAt: string
  title: string
  tags: string[]
  /** The text of the file's Mermaid block, without its fences. */
  mermaid: string
}

/** A Sketch in the list: everything but its Mermaid text. Title and Tags are what search indexes a Sketch by. */
export type SketchSummary = Omit<Sketch, 'mermaid'>

/** A Sketch file whose header can't be read, or that has no Mermaid block: listed with the reason, never hidden. */
export type BrokenSketch = { id: string; version: string; modifiedAt: string; error: string }

export type SketchListing = SketchSummary | BrokenSketch

/** How the open Sketch is shown: the diagram only, the text beside it, or the text only. */
export const SKETCH_MODES = ['preview', 'split', 'code'] as const
export type SketchMode = (typeof SKETCH_MODES)[number]
export const DEFAULT_SKETCH_MODE: SketchMode = 'split'

/** The Sketches view's state in the URL: the open Sketch, and how it is shown. */
export type SketchesView = { sketch?: string; mode?: SketchMode }

/** Router search params → the Sketches view's state, leaving out empty and default values. */
export function parseSketchesView(search: Record<string, unknown>): SketchesView {
  const mode = SKETCH_MODES.find((candidate) => candidate === search.mode && candidate !== DEFAULT_SKETCH_MODE)
  return {
    ...(typeof search.sketch === 'string' && search.sketch !== '' && { sketch: search.sketch }),
    ...(mode && { mode }),
  }
}

export const isBrokenSketch = (sketch: SketchListing | Sketch | BrokenSketch): sketch is BrokenSketch => 'error' in sketch
