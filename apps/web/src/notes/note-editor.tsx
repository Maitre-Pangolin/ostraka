// The Notes editor as a React component: Crepe (toolbar on selection, `/` menu, Markdown shortcuts) styled with
// the app's tokens in index.css, Mermaid blocks drawn in place.
import '@milkdown/crepe/theme/common/style.css'
import { useEffect, useRef, type RefObject } from 'react'
import { renderMermaidPreview } from './mermaid-preview'
import { createNoteEditor } from './note-editor-setup'

export type NoteEditorHandle = { flush(): void }

/**
 * Edits `markdown` (a body without its header), which is read once: give the component a new `key` to show other
 * text. `onEdit` gets the body each time the user changes it, never on opening, so an unedited Note is never saved.
 */
export function NoteEditor({
  markdown,
  onEdit,
  handle,
}: {
  markdown: string
  onEdit: (markdown: string) => void
  /** `flush()` passes on an edit Milkdown has not reported yet (it reports after a short pause): for leaving the page. */
  handle?: RefObject<NoteEditorHandle | null>
}) {
  const root = useRef<HTMLDivElement>(null)
  const onEditRef = useRef(onEdit)
  useEffect(() => {
    onEditRef.current = onEdit
  })

  useEffect(() => {
    const editor = createNoteEditor({ root: root.current!, markdown, renderPreview: renderMermaidPreview })
    // What the file holds as far as this editor knows: what it serialized on opening, then each edit passed on.
    let last: string | undefined
    const report = (next: string) => {
      if (last === undefined || next === last) return
      last = next
      onEditRef.current(next)
    }
    editor.on((listener) => listener.markdownUpdated((_ctx, next) => report(next)))
    const ready = editor.create().then(() => {
      last = editor.getMarkdown()
      if (handle) handle.current = { flush: () => report(editor.getMarkdown()) }
    })
    return () => {
      if (handle) handle.current = null
      void ready.then(() => editor.destroy())
    }
  }, [markdown, handle])

  return <div ref={root} className="ostraka-md min-h-full" />
}
