// The Sketch text editor: CodeMirror on the Mermaid text, styled with the app's tokens. Loads with the first open
// Sketch, not with the app.
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { useEffect, useRef } from 'react'

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--foreground)', fontSize: '13px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--foreground)', paddingBlock: '8px' },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--muted-foreground)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in oklch, var(--muted) 60%, transparent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 25%, transparent) !important',
  },
})

/**
 * Edits `text`, which is read once: give the component a new `key` to show other text. `onEdit` gets the text on
 * each change the user makes, never on opening. Tab indents; Esc then Tab moves focus on, as in CodeMirror.
 */
export function MermaidEditor({ text, onEdit, label }: { text: string; onEdit: (text: string) => void; label: string }) {
  const root = useRef<HTMLDivElement>(null)
  const onEditRef = useRef(onEdit)
  useEffect(() => {
    onEditRef.current = onEdit
  })

  useEffect(() => {
    const view = new EditorView({
      parent: root.current!,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onEditRef.current(update.state.doc.toString())
          }),
        ],
      }),
    })
    return () => view.destroy()
  }, [text, label])

  return <div ref={root} className="h-full min-h-0" />
}
