// PROTOTYPE (#17): Notes and Dev logs editor (Milkdown Crepe) with the MR / Jira picker and token highlighting. Throw away.
//
// References stay plain-text tokens in the Markdown (`pay/api!812`, `PAY-1432`): picking or pasting a URL inserts the
// token, and the editor decorates tokens and @mentions in place, with a status dot and a hover card.
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import { cn } from '@/lib/utils'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { Plugin } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PEOPLE } from './data'
import { dotClass, parseToken, parseUrl, refItems, refQuery, refToken, resolve, RefCard, RefPickerList, TOKEN_RE, type Ref, type Resolved } from './refs'

type Picker = { x: number; y: number; from: number; to: number; items: Resolved[]; sel: number }
type Hover = { x: number; y: number; r: Ref }

// Tokens and @mentions get a chip look inside the editor (they stay plain text in the file).
const tokenDecorations = $prose(
  () =>
    new Plugin({
      props: {
        decorations(state) {
          const decos: Decoration[] = []
          state.doc.descendants((node, pos) => {
            if (!node.isText || !node.text || node.marks.some((m) => m.type.name === 'link' || m.type.name === 'inlineCode')) return
            for (const m of node.text.matchAll(new RegExp(`${TOKEN_RE.source}|@([a-z0-9-]+)`, 'g'))) {
              const isMention = m[0].startsWith('@')
              if (isMention && !PEOPLE[m[0].slice(1)]) continue
              const end = pos + m.index! + m[0].length
              const ref = !isMention && parseToken(m[0])
              // Keep the status dot while editing.
              if (ref)
                decos.push(
                  Decoration.widget(end, () => Object.assign(document.createElement('span'), { className: dotClass(resolve(ref)) + ' ml-0.5 align-middle' }), { side: -1 }),
                )
              decos.push(Decoration.inline(pos + m.index!, end, { class: isMention ? 'ostraka-mention' : 'ostraka-token', 'data-token': m[0] }))
            }
          })
          return DecorationSet.create(state.doc, decos)
        },
      },
    }),
)

export function RichEditor({ value, onChange, readonly, className }: { value: string; onChange?: (md: string) => void; readonly?: boolean; className?: string }) {
  const root = useRef<HTMLDivElement>(null)
  const [picker, setPicker] = useState<Picker | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const pickerRef = useRef(picker)
  pickerRef.current = picker
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const viewRef = useRef<EditorView | null>(null)
  const hideT = useRef(0)
  const refreshRef = useRef<(v: EditorView) => void>(() => {})

  const insert = (r: Resolved, from: number, to: number) => {
    const view = viewRef.current!
    view.dispatch(view.state.tr.insertText(refToken(r.ref) + ' ', from, to))
    setPicker(null)
    view.focus()
  }
  const insertRef = useRef(insert)
  insertRef.current = insert

  useEffect(() => {
    const crepe = new Crepe({ root: root.current!, defaultValue: value, features: { [Crepe.Feature.Latex]: false } })
    crepe.editor.use(tokenDecorations)
    // Re-check the text before the caret after every transaction (typing, paste, clicks).
    crepe.editor.use($prose(() => new Plugin({ view: () => ({ update: (v) => refreshRef.current(v) }) })))
    crepe.on((l) => l.markdownUpdated((_, md) => changeRef.current?.(md)))

    const cleanups: (() => void)[] = []
    const ready = crepe.create().then(() => {
      crepe.setReadonly(!!readonly)
      const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
      viewRef.current = view
      const dom = view.dom

      refreshRef.current = (view: EditorView) => {
        if (!view.hasFocus()) return
        const { $from, empty } = view.state.selection
        if (!empty || $from.marks().some((m) => m.type.name === 'link' || m.type.name === 'inlineCode')) return setPicker(null)
        const q = refQuery($from.parent.textBetween(0, $from.parentOffset, undefined, '￼'))
        if (!q) return setPicker(null)
        const c = view.coordsAtPos($from.pos)
        setPicker({ x: c.left, y: c.bottom + 4, from: $from.pos - q.q.length, to: $from.pos, items: refItems(q), sel: 0 })
      }

      const onKey = (e: KeyboardEvent) => {
        const p = pickerRef.current
        if (!p) return
        const stop = () => (e.preventDefault(), e.stopPropagation())
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          stop()
          const n = Math.min(p.items.length, 8) || 1
          setPicker({ ...p, sel: (p.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n })
        } else if ((e.key === 'Enter' || e.key === 'Tab') && p.items[p.sel]) {
          stop()
          insertRef.current(p.items[p.sel], p.from, p.to)
        } else if (e.key === 'Escape') {
          stop()
          setPicker(null)
        }
      }
      const onPaste = (e: ClipboardEvent) => {
        const r = parseUrl(e.clipboardData?.getData('text/plain') ?? '')
        if (!r) return
        e.preventDefault()
        e.stopPropagation()
        const { from, to } = view.state.selection
        insertRef.current(resolve(r), from, to)
      }
      const onOver = (e: MouseEvent) => {
        const el = (e.target as HTMLElement).closest('.ostraka-token') as HTMLElement | null
        const r = el && parseToken(el.dataset.token ?? '')
        if (!el || !r) return
        window.clearTimeout(hideT.current)
        const rect = el.getBoundingClientRect()
        setHover({ x: rect.left, y: rect.top, r })
      }
      const onOut = () => {
        window.clearTimeout(hideT.current)
        hideT.current = window.setTimeout(() => setHover(null), 250)
      }
      const onBlur = () => setPicker(null)
      const listeners: [string, EventListener, boolean?][] = [
        ['keydown', onKey as EventListener, true],
        ['paste', onPaste as EventListener, true],
        ['mouseover', onOver as EventListener],
        ['mouseout', onOut],
        ['blur', onBlur],
      ]
      for (const [t, f, c] of listeners) dom.addEventListener(t, f, c)
      cleanups.push(() => listeners.forEach(([t, f, c]) => dom.removeEventListener(t, f, c)))
    })
    return () => {
      ready.then(() => {
        cleanups.forEach((f) => f())
        crepe.destroy()
      })
    }
    // Remount per document (callers key this component); value is only the initial content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readonly])

  return (
    <>
      <div ref={root} className={cn('ostraka-md', readonly && 'is-readonly', className)} />
      {picker &&
        createPortal(
          <div className="fixed z-50" style={{ left: Math.min(picker.x, window.innerWidth - 360), top: picker.y }}>
            <RefPickerList items={picker.items} sel={picker.sel} onPick={(r) => insert(r, picker.from, picker.to)} />
          </div>,
          document.body,
        )}
      {hover &&
        createPortal(
          <div
            className="fixed z-50 w-72 -translate-y-full rounded-lg border bg-popover p-2.5 text-popover-foreground shadow-md"
            style={{ left: Math.min(hover.x, window.innerWidth - 300), top: hover.y - 6 }}
            onMouseEnter={() => window.clearTimeout(hideT.current)}
            onMouseLeave={() => setHover(null)}
          >
            <RefCard r={resolve(hover.r)} />
          </div>,
          document.body,
        )}
    </>
  )
}
