// The Notes editor as a React component: Crepe (toolbar on selection, `/` menu, Markdown shortcuts) styled with
// the app's tokens in index.css, Mermaid blocks drawn in place. References are highlighted in place with their status
// dot and hover card, and suggested while typed (`!` for my open MRs, `KEY-` for my sprint tickets); they stay plain
// tokens in the Markdown.
import '@milkdown/crepe/theme/common/style.css'
import { suggestReferences, type ReferenceSuggestion } from '@ostraka/core/references'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { useReferenceIndex } from '@/references/api'
import { referenceHighlighter } from '@/references/highlight'
import { ReferenceHoverCard, ReferenceSuggestionLabel } from '@/references/reference-chip'
import { polledStatus, UNKNOWN_DOT } from '@/references/status'
import { renderMermaidPreview } from './mermaid-preview'
import { createNoteEditor } from './note-editor-setup'
import { refreshTokenHighlight, tokenHighlight } from './token-highlight'
import { pickSuggestion, tokenSuggest, type OpenSuggestions } from './token-suggest'

export type NoteEditorHandle = { flush(): void }

type Offered = { open: OpenSuggestions<ReferenceSuggestion>; view: EditorView }
type Hovered = { token: string; anchor: Element }

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
  const view = useRef<EditorView | null>(null)
  const index = useReferenceIndex()
  const [offered, setOffered] = useState<Offered>()
  const [selected, setSelected] = useState(0)
  const [dismissed, setDismissed] = useState<string>()
  const [hovered, setHovered] = useState<Hovered>()
  const hoverTimer = useRef(0)
  const listId = useId()

  const shown = offered && dismissed !== `${offered.open.from} ${offered.open.fragment}` ? offered : undefined
  const suggestions = shown?.open.suggestions.slice(0, 8) ?? []
  const active = Math.min(selected, suggestions.length - 1)

  // The editor is made once per text; its plugins read the latest state through this ref.
  const latest = useRef({ onEdit, index, shown, suggestions, active })
  useLayoutEffect(() => {
    latest.current = { onEdit, index, shown, suggestions, active }
  })

  // A status that changed (the top bar polled again) redraws the dots.
  const drawnWith = useRef(index)
  useEffect(() => {
    if (drawnWith.current === index) return
    drawnWith.current = index
    if (view.current) refreshTokenHighlight(view.current)
  })

  useEffect(() => {
    const dotOf = (token: string) => {
      const polled = latest.current.index.polled.get(token)
      return polled ? polledStatus(polled).dot : UNKNOWN_DOT
    }
    const editor = createNoteEditor({
      root: root.current!,
      markdown,
      renderPreview: renderMermaidPreview,
      plugins: [
        tokenHighlight(() => [referenceHighlighter(dotOf)]),
        tokenSuggest<ReferenceSuggestion>({
          suggest: (fragment) => suggestReferences(fragment, latest.current.index.candidates),
          onChange: (open, editorView) => {
            setOffered(open && { open, view: editorView })
            setSelected(0)
          },
        }),
      ],
    })
    // What the file holds as far as this editor knows: what it serialized on opening, then each edit passed on.
    let last: string | undefined
    const report = (next: string) => {
      if (last === undefined || next === last) return
      last = next
      latest.current.onEdit(next)
    }
    editor.on((listener) => listener.markdownUpdated((_ctx, next) => report(next)))
    const ready = editor.create().then(() => {
      last = editor.getMarkdown()
      view.current = editor.editor.action((ctx) => ctx.get(editorViewCtx))
      if (handle) handle.current = { flush: () => report(editor.getMarkdown()) }
    })
    return () => {
      view.current = null
      if (handle) handle.current = null
      void ready.then(() => editor.destroy())
    }
  }, [markdown, handle])

  // Keys reach the suggestions before the editor's own (↵ would split the paragraph, Tab indent a list).
  useEffect(() => {
    const element = root.current!
    const onKeyDown = (event: KeyboardEvent) => {
      const { shown: open, suggestions: offers, active: at } = latest.current
      if (!open || offers.length === 0 || event.isComposing) return
      const handled = () => {
        event.preventDefault()
        event.stopPropagation()
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        handled()
        setSelected((at + (event.key === 'ArrowDown' ? 1 : offers.length - 1)) % offers.length)
      } else if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
        handled()
        pickSuggestion(open.view, open.open, offers[at]!)
      } else if (event.key === 'Escape') {
        handled()
        setDismissed(`${open.open.from} ${open.open.fragment}`)
      }
    }
    element.addEventListener('keydown', onKeyDown, true)
    return () => element.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Hovering a highlighted Reference opens its card, as a chip's does.
  const hoverLater = (next: Hovered | undefined, delay: number) => {
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => setHovered(next), delay)
  }
  useEffect(() => () => window.clearTimeout(hoverTimer.current), [])

  // ARIA on ProseMirror's own element while suggestions show: a combobox whose listbox holds them.
  useLayoutEffect(() => {
    const dom = view.current?.dom
    if (!dom) return
    const attributes: Record<string, string | undefined> = {
      'aria-autocomplete': 'list',
      'aria-expanded': String(suggestions.length > 0),
      'aria-controls': suggestions.length ? listId : undefined,
      'aria-activedescendant': suggestions.length ? `${listId}-${active}` : undefined,
    }
    for (const [name, value] of Object.entries(attributes)) {
      if (value === undefined) dom.removeAttribute(name)
      else dom.setAttribute(name, value)
    }
  })

  const caret = shown?.view.coordsAtPos(shown.open.from)

  return (
    <>
      <div
        ref={root}
        className="ostraka-md min-h-full"
        onBlur={() => setOffered(undefined)}
        onMouseOver={(event) => {
          const target = (event.target as Element).closest<HTMLElement>('[data-reference]')
          if (target && target.dataset.reference !== hovered?.token) hoverLater({ token: target.dataset.reference!, anchor: target }, 300)
          else if (target) window.clearTimeout(hoverTimer.current)
        }}
        onMouseOut={(event) => {
          if ((event.target as Element).closest('[data-reference]')) hoverLater(undefined, 150)
        }}
      />
      {hovered && (
        <ReferenceHoverCard
          key={hovered.token}
          token={hovered.token}
          anchor={hovered.anchor}
          onOpenChange={(open) => !open && setHovered(undefined)}
          onHover={(inside) => (inside ? window.clearTimeout(hoverTimer.current) : hoverLater(undefined, 150))}
        />
      )}
      {shown &&
        caret &&
        suggestions.length > 0 &&
        createPortal(
          <ul
            id={listId}
            role="listbox"
            aria-label="Suggestions"
            style={{ left: Math.max(8, Math.min(caret.left, window.innerWidth - 328)), top: caret.bottom + 4 }}
            className="bg-popover text-popover-foreground ring-foreground/10 fixed z-50 w-80 max-w-[calc(100vw-1rem)] rounded-lg p-1 shadow-md ring-1"
          >
            {suggestions.map((suggestion, at) => (
              <li
                key={suggestion.token}
                id={`${listId}-${at}`}
                role="option"
                aria-selected={at === active}
                // Keep focus in the editor: pick on mouse down, before it would blur.
                onMouseDown={(event) => {
                  event.preventDefault()
                  pickSuggestion(shown.view, shown.open, suggestion)
                }}
                onMouseEnter={() => setSelected(at)}
                className={cn('flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-sm', at === active && 'bg-accent')}
              >
                <ReferenceSuggestionLabel suggestion={suggestion} />
                {at === active && <kbd className="text-muted-foreground ml-auto text-[10px]">Tab</kbd>}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  )
}
