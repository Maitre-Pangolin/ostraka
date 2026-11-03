// The Notes editor: Milkdown Crepe writing core's house style, so a Note already in it serializes back unchanged.
// Kept free of React and CSS so the round-trip test runs it as the app does.
import { HOUSE_STYLE } from '@ostraka/core/markdown'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { $prose } from '@milkdown/kit/utils'
import { mentionHighlight, setMentionNames, type MentionNames } from '../people/mention-highlight.ts'

export type NoteEditor = Crepe

/**
 * A code block's rendered preview: return `null` for none (plain code), or return nothing and pass the preview to
 * `apply` once it is ready.
 */
export type RenderPreview = (language: string, code: string, apply: (preview: HTMLElement | string | null) => void) => null | undefined

export type NoteEditorOptions = {
  root: HTMLElement
  /** The Note's body, without its YAML header. */
  markdown: string
  /** Renders some code blocks in place (Mermaid); by default none are. */
  renderPreview?: RenderPreview
}

export function createNoteEditor({ root, markdown, renderPreview }: NoteEditorOptions): NoteEditor {
  const crepe = new Crepe({
    root,
    defaultValue: markdown,
    features: {
      // Formulas and uploaded images have nowhere to live in a Note.
      [Crepe.Feature.Latex]: false,
      [Crepe.Feature.ImageBlock]: false,
    },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: { text: 'Write, or type / for headings, lists, code and diagrams', mode: 'doc' },
      // A diagram shows drawn, with its source one toggle away.
      ...(renderPreview && { [Crepe.Feature.CodeMirror]: { renderPreview, previewOnlyByDefault: true } }),
    },
  })
  crepe.editor.config((ctx) => ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, ...HOUSE_STYLE })))
  crepe.editor.use($prose(mentionHighlight))
  return crepe
}

/** Highlights Mentions of these Persons (name by id) in a created editor. */
export function setMentionPeople(editor: NoteEditor, names: MentionNames): void {
  editor.editor.action((ctx) => setMentionNames(ctx.get(editorViewCtx), names))
}
