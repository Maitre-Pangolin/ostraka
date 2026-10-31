// PROTOTYPE (#17): Milkdown editor with the MR / Jira picker, link hover cards and token decorations. Throw away.
//
// refMode 'link'  → picking inserts a Markdown link on the item's title: [Retry failed payments](https://…/812)
// refMode 'token' → picking inserts the plain token: pay/api!812
// Both: a pasted MR / Jira URL converts the same way; ⌘K on a selection attaches a link to that text.
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import { cn } from '@/lib/utils'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { Plugin, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { Unlink } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MRS, PEOPLE, SPRINT } from './data'
import { parseToken, parseUrl, refItems, refQuery, refToken, refUrl, resolve, RefCard, RefPickerList, TOKEN_RE, type Ref, type Resolved } from './refs'

type Picker = { x: number; y: number; from: number; to: number; items: Resolved[]; sel: number; wrap: boolean }
type Hover = { x: number; y: number; r: Ref; link?: HTMLAnchorElement }

const allItems = () => [
  ...MRS.map((m) => resolve({ kind: 'mr', project: m.project, iid: m.iid })),
  ...SPRINT.mine.filter((i) => i.category !== 'done').map((i) => resolve({ kind: 'jira', key: i.key })),
]

// Plain-text tokens and @mentions get a chip look inside the editor (they stay plain text in the file).
const tokenDecorations = (tokens: boolean) =>
  $prose(
    () =>
      new Plugin({
        props: {
          decorations(state) {
            const decos: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text || node.marks.some((m) => m.type.name === 'link' || m.type.name === 'inlineCode')) return
              const re = new RegExp(`${tokens ? TOKEN_RE.source + '|' : ''}@([a-z0-9-]+)`, 'g')
              for (const m of node.text.matchAll(re)) {
                const isMention = m[0].startsWith('@')
                if (isMention && !PEOPLE[m[0].slice(1)]) continue
                decos.push(
                  Decoration.inline(pos + m.index!, pos + m.index! + m[0].length, {
                    class: isMention ? 'ostraka-mention' : 'ostraka-token',
                    'data-token': m[0],
                  }),
                )
              }
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
  )

export function RichEditor({
  value,
  onChange,
  readonly,
  refMode,
  inline,
  compact,
  placeholder,
  autoFocus,
  onEnter,
  onBlur,
  className,
}: {
  value: string
  onChange?: (md: string) => void
  readonly?: boolean
  refMode: 'link' | 'token'
  inline?: boolean // single line (a Todo title): ↵ calls onEnter instead of splitting
  compact?: boolean // a Todo description: no block handles, images or tables
  placeholder?: string
  autoFocus?: boolean
  onEnter?: (md: string) => void
  onBlur?: (md: string) => void // gets the live Markdown (markdownUpdated is debounced)
  className?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const [picker, setPicker] = useState<Picker | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const pickerRef = useRef(picker)
  pickerRef.current = picker
  const cb = useRef({ onChange, onEnter, onBlur })
  cb.current = { onChange, onEnter, onBlur }
  const viewRef = useRef<EditorView | null>(null)
  const hideT = useRef(0)
  const refreshRef = useRef<(v: EditorView) => void>(() => {})

  const insert = (r: Resolved, p: Picker) => {
    const view = viewRef.current!
    const { schema } = view.state
    const tr = view.state.tr
    if (refMode === 'link') {
      const link = schema.marks.link.create({ href: refUrl(r.ref) })
      if (p.wrap) tr.addMark(p.from, p.to, link)
      else {
        tr.replaceWith(p.from, p.to, [schema.text(r.title, [link]), schema.text(' ')])
        tr.setSelection(TextSelection.create(tr.doc, p.from + r.title.length + 1))
      }
    } else {
      tr.insertText(refToken(r.ref) + ' ', p.from, p.to)
    }
    tr.setStoredMarks([])
    view.dispatch(tr)
    setPicker(null)
    view.focus()
  }
  const insertRef = useRef(insert)
  insertRef.current = insert

  useEffect(() => {
    const off = { [Crepe.Feature.Latex]: false }
    const features = inline
      ? {
          ...off,
          [Crepe.Feature.BlockEdit]: false,
          [Crepe.Feature.Toolbar]: false,
          [Crepe.Feature.LinkTooltip]: false,
          [Crepe.Feature.ImageBlock]: false,
          [Crepe.Feature.Table]: false,
          [Crepe.Feature.CodeMirror]: false,
          [Crepe.Feature.ListItem]: false,
        }
      : compact
        ? { ...off, [Crepe.Feature.BlockEdit]: false, [Crepe.Feature.ImageBlock]: false, [Crepe.Feature.Table]: false }
        : off
    const crepe = new Crepe({
      root: root.current!,
      defaultValue: value,
      features,
      featureConfigs: { [Crepe.Feature.Placeholder]: { text: placeholder ?? 'Write…', mode: 'doc' } },
    })
    crepe.editor.use(tokenDecorations(refMode === 'token'))
    // Re-check the text before the caret after every transaction (typing, paste, clicks).
    crepe.editor.use($prose(() => new Plugin({ view: () => ({ update: (v) => refreshRef.current(v) }) })))
    crepe.on((l) => l.markdownUpdated((_, md) => cb.current.onChange?.(md.trim())))

    const cleanups: (() => void)[] = []
    const ready = crepe.create().then(() => {
      crepe.setReadonly(!!readonly)
      const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
      viewRef.current = view
      const dom = view.dom
      if (autoFocus) {
        view.focus()
        view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
      }

      refreshRef.current = (view: EditorView) => {
        if (!view.hasFocus()) return
        const { $from, empty } = view.state.selection
        const p = pickerRef.current
        if (p?.wrap) return
        if (!empty || $from.marks().some((m) => m.type.name === 'link' || m.type.name === 'inlineCode')) return setPicker(null)
        const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
        const q = refQuery(before)
        if (!q) return setPicker(null)
        const c = view.coordsAtPos($from.pos)
        setPicker({ x: c.left, y: c.bottom + 4, from: $from.pos - q.q.length, to: $from.pos, items: refItems(q), sel: 0, wrap: false })
      }

      const onKey = (e: KeyboardEvent) => {
        const p = pickerRef.current
        if (p) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            e.stopPropagation()
            const n = Math.min(p.items.length, 8) || 1
            setPicker({ ...p, sel: (p.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n })
            return
          }
          if ((e.key === 'Enter' || e.key === 'Tab') && p.items[p.sel]) {
            e.preventDefault()
            e.stopPropagation()
            insertRef.current(p.items[p.sel], p)
            return
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            setPicker(null)
            return
          }
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'k' && !view.state.selection.empty && refMode === 'link') {
          e.preventDefault()
          e.stopPropagation()
          const { from, to } = view.state.selection
          const c = view.coordsAtPos(to)
          setPicker({ x: c.left, y: c.bottom + 4, from, to, items: allItems(), sel: 0, wrap: true })
          return
        }
        if (inline && e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          cb.current.onEnter?.(crepe.getMarkdown().trim())
          return
        }
        if (inline && e.key === 'Escape') (view.dom as HTMLElement).blur()
      }
      const onPaste = (e: ClipboardEvent) => {
        const text = e.clipboardData?.getData('text/plain') ?? ''
        const r = parseUrl(text)
        if (!r) return
        e.preventDefault()
        e.stopPropagation()
        const { from, to, empty } = view.state.selection
        insertRef.current(resolve(r), { x: 0, y: 0, from, to, items: [], sel: 0, wrap: !empty && refMode === 'link' })
      }
      // Hover cards on reference links and tokens.
      const onOver = (e: MouseEvent) => {
        const el = (e.target as HTMLElement).closest('a, .ostraka-token') as HTMLElement | null
        if (!el || !dom.contains(el)) return
        const r = el instanceof HTMLAnchorElement ? parseUrl(el.href) : parseToken(el.dataset.token ?? '')
        if (!r) return
        window.clearTimeout(hideT.current)
        const rect = el.getBoundingClientRect()
        setHover({ x: rect.left, y: rect.top, r, link: el instanceof HTMLAnchorElement ? el : undefined })
      }
      const onOut = () => {
        window.clearTimeout(hideT.current)
        hideT.current = window.setTimeout(() => setHover(null), 250)
      }
      const onBlurDom = () => {
        setPicker(null)
        cb.current.onBlur?.(crepe.getMarkdown().trim())
      }
      dom.addEventListener('keydown', onKey, true)
      dom.addEventListener('paste', onPaste, true)
      dom.addEventListener('mouseover', onOver)
      dom.addEventListener('mouseout', onOut)
      dom.addEventListener('blur', onBlurDom)
      cleanups.push(() => {
        dom.removeEventListener('keydown', onKey, true)
        dom.removeEventListener('paste', onPaste, true)
        dom.removeEventListener('mouseover', onOver)
        dom.removeEventListener('mouseout', onOut)
        dom.removeEventListener('blur', onBlurDom)
      })
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

  const unlink = (a: HTMLAnchorElement) => {
    const view = viewRef.current!
    const from = view.posAtDOM(a, 0)
    view.dispatch(view.state.tr.removeMark(from, from + (a.textContent?.length ?? 0), view.state.schema.marks.link))
    setHover(null)
  }

  return (
    <>
      <div ref={root} onClick={(e) => e.stopPropagation()} className={cn('ostraka-md', inline && 'ostraka-inline', compact && 'ostraka-compact', readonly && 'is-readonly', className)} />
      {picker &&
        createPortal(
          <div className="fixed z-50" style={{ left: Math.min(picker.x, window.innerWidth - 336), top: picker.y }}>
            <RefPickerList
              items={picker.items}
              sel={picker.sel}
              onPick={(r) => insert(r, picker)}
              header={picker.wrap ? <div className="px-2 pb-1 text-[11px] text-muted-foreground">Link the selected text to…</div> : undefined}
            />
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
            {hover.link && !readonly && (
              <button type="button" onClick={() => unlink(hover.link!)} className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                <Unlink className="size-3" /> Unlink (keep the text)
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
