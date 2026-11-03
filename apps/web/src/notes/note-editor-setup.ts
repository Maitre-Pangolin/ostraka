// The Notes editor: Milkdown Crepe writing core's house style, so a Note already in it serializes back unchanged.
// Kept free of React and CSS so the round-trip test runs it as the app does.
import { HOUSE_STYLE } from '@ostraka/core/markdown'
import { Crepe } from '@milkdown/crepe'
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'

export type NoteEditor = Crepe

/** Shows a code block's rendered preview: `apply` takes the preview, `null` for none (plain code). */
export type RenderPreview = (language: string, code: string, apply: (preview: HTMLElement | string | null) => void) => void

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
    featureConfigs: renderPreview ? { [Crepe.Feature.CodeMirror]: { renderPreview } } : {},
  })
  crepe.editor.config((ctx) => ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, ...HOUSE_STYLE })))
  return crepe
}
