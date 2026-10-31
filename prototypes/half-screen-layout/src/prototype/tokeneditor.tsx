// PROTOTYPE (#17, variant A round 2): plain-text field where references and @mentions are atomic chips while editing.
//
// Storage is unchanged: plain text with tokens (`pay/api!812`, `PAY-1432`, `@lea-martin`). Only the editing changes:
// - a reference is one atom (icon, number, status dot), so typing next to it can't break it; Backspace removes it whole;
// - `!812 ` / `PAY-1432 ` / `@lea-martin ` typed in full become chips on space or punctuation (no need to pick);
// - the picker (`!`, `KEY-`, `@`, `#`, `*`, `^`) and URL paste work as before.
import { cn } from '@/lib/utils'
import { baseKeymap, splitBlock } from '@milkdown/kit/prose/commands'
import { history, redo, undo } from '@milkdown/kit/prose/history'
import { keymap } from '@milkdown/kit/prose/keymap'
import { Schema, type Node as PMNode } from '@milkdown/kit/prose/model'
import { EditorState, Plugin, TextSelection } from '@milkdown/kit/prose/state'
import { EditorView } from '@milkdown/kit/prose/view'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MRS, PEOPLE } from './data'
import { parseProp, type Prop } from './logic'
import { dotClass, parseToken, parseUrl, refShort, refToken, RefCard, resolve, TOKEN_RE, type Ref } from './refs'
import { useStore } from './store'
import { SuggestionList, suggestFor } from './todos'

const schema = new Schema({
  nodes: {
    doc: { content: 'para+' },
    para: { content: 'inline*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
    text: { group: 'inline' },
    ref: { group: 'inline', inline: true, atom: true, attrs: { token: {} }, toDOM: (n) => ['span', { 'data-token': n.attrs.token }, n.attrs.token] },
    mention: { group: 'inline', inline: true, atom: true, attrs: { id: {} }, toDOM: (n) => ['span', { 'data-person': n.attrs.id }, '@' + n.attrs.id] },
  },
})

const PIECES = new RegExp(`${TOKEN_RE.source}|@([a-z0-9-]+)`, 'g')

function toDoc(text: string): PMNode {
  const paras = text.split('\n').map((line) => {
    const inl: PMNode[] = []
    let at = 0
    for (const m of line.matchAll(PIECES)) {
      const isMention = m[0].startsWith('@')
      if (isMention && !PEOPLE[m[0].slice(1)]) continue
      if (m.index! > at) inl.push(schema.text(line.slice(at, m.index)))
      inl.push(isMention ? schema.nodes.mention.create({ id: m[0].slice(1) }) : schema.nodes.ref.create({ token: m[0] }))
      at = m.index! + m[0].length
    }
    if (at < line.length) inl.push(schema.text(line.slice(at)))
    return schema.nodes.para.create(null, inl)
  })
  return schema.nodes.doc.create(null, paras)
}

// Back to plain text. Word characters touching a chip on either side get a space, so the token still parses next time.
function toText(doc: PMNode): string {
  const lines: string[] = []
  doc.forEach((para) => {
    let s = ''
    let prevAtom = false
    para.forEach((n) => {
      const piece = n.type.name === 'ref' ? n.attrs.token : n.type.name === 'mention' ? '@' + n.attrs.id : (n.text ?? '')
      if ((prevAtom && /^[\w@]/.test(piece)) || (!n.isText && /\w$/.test(s))) s += ' '
      s += piece
      prevAtom = !n.isText
    })
    lines.push(s)
  })
  return lines.join('\n')
}

function chipDOM(node: PMNode): HTMLElement {
  const el = document.createElement('span')
  if (node.type.name === 'mention') {
    el.className = 'tok-chip tok-mention'
    el.dataset.person = node.attrs.id
    el.textContent = PEOPLE[node.attrs.id]?.name ?? '@' + node.attrs.id
    return el
  }
  const r = parseToken(node.attrs.token)!
  el.className = cn('tok-chip tok-ref', r.kind === 'mr' ? 'tok-mr' : 'tok-jira')
  el.dataset.token = node.attrs.token
  const label = document.createElement('span')
  label.textContent = refShort(r)
  const dot = document.createElement('span')
  dot.className = dotClass(resolve(r))
  el.append(label, dot)
  return el
}

// `!812` counts as complete when exactly one open MR has that number.
function completeRef(word: string): string | null {
  if (parseToken(word)) return word
  const m = word.match(/^!(\d+)$/)
  if (!m) return null
  const hits = MRS.filter((x) => x.iid === +m[1])
  return hits.length === 1 ? `${hits[0].project}!${hits[0].iid}` : null
}

// A complete token followed by a space or punctuation becomes a chip, however the text arrived (typing, paste, IME).
const AUTO = /(^|[\s(])(!\d+|[a-z0-9-]+\/[a-z0-9-]+!\d+|[A-Z][A-Z0-9]+-\d+|@[a-z0-9-]+)(?=[\s,.;:)!?])/g
const autolink = new Plugin({
  appendTransaction(trs, _old, state) {
    if (!trs.some((t) => t.docChanged)) return null
    const tr = state.tr
    state.doc.descendants((node, pos) => {
      if (!node.isText) return
      for (const m of node.text!.matchAll(AUTO)) {
        const word = m[2]
        const token = completeRef(word)
        const person = word.startsWith('@') && PEOPLE[word.slice(1)] ? word.slice(1) : null
        if (!token && !person) continue
        const start = pos + m.index! + m[1].length
        const atom = token ? schema.nodes.ref.create({ token }) : schema.nodes.mention.create({ id: person })
        tr.replaceWith(tr.mapping.map(start), tr.mapping.map(start + word.length), atom)
      }
    })
    return tr.docChanged ? tr : null
  },
})

type Pop = { x: number; y: number; from: number; to: number; items: string[]; sel: number }
type Hover = { x: number; y: number; r?: Ref; person?: string }

export function TokenEditor({
  value,
  onChange,
  onEnter,
  onBlur,
  onProp,
  multiline,
  placeholder,
  autoFocus,
  className,
}: {
  value: string
  onChange?: (text: string) => void
  onEnter?: (e: { shiftKey: boolean }) => boolean | void // return true when handled; multiline fields fall back to a new line
  onBlur?: (text: string) => void
  onProp?: (p: Prop) => void // when set, completed `#tag` / `*prio` / `^date` leave the text and come here
  multiline?: boolean
  placeholder?: string
  autoFocus?: boolean
  className?: string
}) {
  const { tags } = useStore()
  const root = useRef<HTMLDivElement>(null)
  const [pop, setPop] = useState<Pop | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [empty, setEmpty] = useState(!value)
  const popRef = useRef(pop)
  popRef.current = pop
  const cb = useRef({ onChange, onEnter, onBlur, tags, onProp })
  cb.current = { onChange, onEnter, onBlur, tags, onProp }
  const viewRef = useRef<EditorView | null>(null)
  const hideT = useRef(0)

  const pick = (s: string, p: Pop) => {
    const view = viewRef.current!
    const tr = view.state.tr
    const tok = parseToken(s)
    const node = tok ? schema.nodes.ref.create({ token: s }) : s.startsWith('@') && PEOPLE[s.slice(1)] ? schema.nodes.mention.create({ id: s.slice(1) }) : null
    if (node) tr.replaceWith(p.from, p.to, [node, schema.text(' ')])
    else tr.insertText(s + ' ', p.from, p.to)
    view.dispatch(tr)
    setPop(null)
    view.focus()
  }
  const pickRef = useRef(pick)
  pickRef.current = pick

  useEffect(() => {
    const refresh = (view: EditorView) => {
      const { $from, empty } = view.state.selection
      if (!empty || !view.hasFocus()) return setPop(null)
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
      const last = before.split(/[\s￼]/).pop() ?? ''
      const items = last ? suggestFor(last, cb.current.tags) : []
      if (!items.length) return setPop(null)
      const c = view.coordsAtPos($from.pos)
      const prev = popRef.current
      setPop({ x: c.left, y: c.bottom + 4, from: $from.pos - last.length, to: $from.pos, items, sel: prev && prev.from === $from.pos - last.length ? Math.min(prev.sel, items.length - 1) : 0 })
    }

    // A completed property token followed by a space leaves the text and becomes a property (title fields only).
    const extractProps = new Plugin({
      appendTransaction(trs, _old, state) {
        if (!cb.current.onProp || !trs.some((t) => t.docChanged)) return null
        const tr = state.tr
        const found: Prop[] = []
        state.doc.descendants((node, pos) => {
          if (!node.isText) return
          for (const m of node.text!.matchAll(/(^|\s)([#*^][\w-]+)(?=\s)/g)) {
            const prop = parseProp(m[2])
            if (!prop) continue
            const start = pos + m.index! + m[1].length
            // Drop the token and one surrounding space so the text doesn't collect double spaces.
            const end = start + m[2].length + 1
            tr.delete(tr.mapping.map(start), tr.mapping.map(end))
            found.push(prop)
          }
        })
        if (!found.length) return null
        queueMicrotask(() => found.forEach((p) => cb.current.onProp?.(p)))
        return tr
      },
    })

    const view = new EditorView(root.current!, {
      state: EditorState.create({
        doc: toDoc(value),
        plugins: [
          autolink,
          extractProps,
          history(),
          keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo }),
          keymap({
            Enter: () => {
              const p = popRef.current
              if (p) return pickRef.current(p.items[p.sel], p), true
              const handled = cb.current.onEnter?.({ shiftKey: false })
              return !!handled || !multiline
            },
            'Shift-Enter': (state, dispatch) => !!cb.current.onEnter?.({ shiftKey: true }) || !multiline || splitBlock(state, dispatch),
            Tab: () => {
              const p = popRef.current
              if (!p) return false
              pickRef.current(p.items[p.sel], p)
              return true
            },
            ArrowDown: () => {
              const p = popRef.current
              if (!p) return false
              setPop({ ...p, sel: (p.sel + 1) % Math.min(p.items.length, 8) })
              return true
            },
            ArrowUp: () => {
              const p = popRef.current
              if (!p) return false
              const n = Math.min(p.items.length, 8)
              setPop({ ...p, sel: (p.sel + n - 1) % n })
              return true
            },
            Escape: (_s, _d, v) => {
              if (popRef.current) return setPop(null), true
              ;(v?.dom as HTMLElement | undefined)?.blur()
              return true
            },
          }),
          keymap(baseKeymap),
        ],
      }),
      nodeViews: { ref: (n) => ({ dom: chipDOM(n) }), mention: (n) => ({ dom: chipDOM(n) }) },
      handlePaste: (v, e) => {
        const r = parseUrl(e.clipboardData?.getData('text/plain') ?? '')
        if (!r) return false
        const { from, to } = v.state.selection
        v.dispatch(v.state.tr.replaceWith(from, to, [schema.nodes.ref.create({ token: refToken(r) }), schema.text(' ')]))
        return true
      },
      handleDOMEvents: {
        blur: (v) => {
          setPop(null)
          cb.current.onBlur?.(toText(v.state.doc))
          return false
        },
        mouseover: (_v, e) => {
          const el = (e.target as HTMLElement).closest('.tok-chip') as HTMLElement | null
          if (!el) return false
          window.clearTimeout(hideT.current)
          const rect = el.getBoundingClientRect()
          setHover({ x: rect.left, y: rect.bottom + 4, r: el.dataset.token ? parseToken(el.dataset.token)! : undefined, person: el.dataset.person })
          return false
        },
        mouseout: () => {
          window.clearTimeout(hideT.current)
          hideT.current = window.setTimeout(() => setHover(null), 250)
          return false
        },
      },
      dispatchTransaction(tr) {
        const next = view.state.apply(tr)
        view.updateState(next)
        if (tr.docChanged) {
          const text = toText(next.doc)
          setEmpty(!text)
          cb.current.onChange?.(text)
        }
        refresh(view)
      },
    })
    viewRef.current = view
    if (autoFocus) {
      view.focus()
      view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
    }
    return () => view.destroy()
    // Uncontrolled: value is the initial content; callers key this component to reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={cn('relative', className)} onClick={(e) => e.stopPropagation()}>
      <div ref={root} className={cn('tok-editor', multiline && 'is-multiline')} />
      {empty && placeholder && <span className="tok-placeholder pointer-events-none absolute inset-0 truncate text-muted-foreground/80">{placeholder}</span>}
      {pop &&
        createPortal(
          <div className="fixed z-50 w-[22rem] max-w-[calc(100vw-2rem)]" style={{ left: Math.min(pop.x, window.innerWidth - 360), top: pop.y }}>
            <div className="relative">
              <SuggestionList items={pop.items} sel={pop.sel} onPick={(s) => pick(s, pop)} />
            </div>
          </div>,
          document.body,
        )}
      {hover &&
        createPortal(
          <div
            className="fixed z-50 w-72 rounded-lg border bg-popover p-2.5 text-popover-foreground shadow-md"
            style={{ left: Math.min(hover.x, window.innerWidth - 300), top: hover.y }}
            onMouseEnter={() => window.clearTimeout(hideT.current)}
            onMouseLeave={() => setHover(null)}
          >
            {hover.r && <RefCard r={resolve(hover.r)} />}
            {hover.person && PEOPLE[hover.person] && (
              <div className="flex flex-col gap-0.5 text-xs">
                <span className="text-sm font-medium">{PEOPLE[hover.person].name}</span>
                <span className="text-muted-foreground">
                  @{hover.person} · {PEOPLE[hover.person].email}
                </span>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
