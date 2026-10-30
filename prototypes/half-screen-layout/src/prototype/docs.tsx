// PROTOTYPE: Notes (Milkdown Crepe), Dev logs (rendered Markdown) and Sketches (Mermaid) views for #10. Throw away.
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Crepe } from '@milkdown/crepe'
import { ArrowLeft, CalendarPlus, Check, Code, Columns2, Eye, Pencil, Plus, Search } from 'lucide-react'
import mermaid from 'mermaid'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DEVLOGS, MISSING_DEVLOGS, SKETCHES, TODAY, type Doc } from './data'
import { useStore } from './store'
import { TagPill } from './todos'

// ---------------------------------------------------------------- Markdown editor (Milkdown Crepe)

export function MarkdownEditor({ value, readonly, onChange }: { value: string; readonly?: boolean; onChange?: (md: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  useEffect(() => {
    const crepe = new Crepe({ root: ref.current!, defaultValue: value, features: { [Crepe.Feature.Latex]: false } })
    crepe.on((l) => l.markdownUpdated((_, md) => changeRef.current?.(md)))
    const ready = crepe.create().then(() => crepe.setReadonly(!!readonly))
    return () => {
      ready.then(() => crepe.destroy())
    }
    // Remount per document (callers key this component); value is only the initial content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readonly])
  return <div ref={ref} className={cn('ostraka-md', readonly && 'is-readonly')} />
}

// ---------------------------------------------------------------- list + detail layout

function ListDetail({ list, detail, hasSelection, onBack }: { list: ReactNode; detail: ReactNode; hasSelection: boolean; onBack: () => void }) {
  return (
    <div className="flex h-full min-h-0">
      <div className={cn('min-h-0 w-full shrink-0 flex-col overflow-y-auto border-r @3xl:flex @3xl:w-64', hasSelection ? 'hidden' : 'flex')}>{list}</div>
      <div className={cn('min-h-0 min-w-0 flex-1 flex-col', hasSelection ? 'flex' : 'hidden @3xl:flex')}>
        {hasSelection ? (
          <>
            <button type="button" onClick={onBack} className="flex h-8 shrink-0 items-center gap-1 border-b px-2 text-xs text-muted-foreground hover:text-foreground @3xl:hidden">
              <ArrowLeft className="size-3.5" /> Back
            </button>
            {detail}
          </>
        ) : (
          <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Pick something on the left.</div>
        )}
      </div>
    </div>
  )
}

function ListHeader({ children }: { children: ReactNode }) {
  return <div className="sticky top-0 z-10 flex h-10 shrink-0 items-center gap-1.5 border-b bg-background px-2">{children}</div>
}

function DocRow({ doc, active, onClick, meta }: { doc: Doc; active: boolean; onClick: () => void; meta?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn('flex flex-col gap-0.5 border-b px-3 py-2 text-left hover:bg-muted/60', active && 'bg-accent')}>
      <span className="truncate text-sm font-medium">{doc.title}</span>
      <span className="flex items-center gap-1 overflow-hidden text-[11px] text-muted-foreground">
        {meta ?? doc.updated.slice(5)}
        {doc.tags.map((t) => (
          <TagPill key={t} tag={t} className="h-4 text-[10px]" />
        ))}
      </span>
    </button>
  )
}

const fmtDay = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

// ---------------------------------------------------------------- Notes

export function NotesView() {
  const { notes, setNotes } = useStore()
  const [sel, setSel] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [saved, setSaved] = useState(true)
  const note = notes.find((n) => n.id === sel)
  const shown = notes.filter((n) => (n.title + n.tags.join(' ')).toLowerCase().includes(q.toLowerCase()))
  const create = () => {
    const id = `n${Date.now()}`
    setNotes((ns) => [{ id, title: 'Untitled', tags: [], updated: TODAY, body: '# Untitled\n\n' }, ...ns])
    setSel(id)
  }
  return (
    <ListDetail
      hasSelection={!!note}
      onBack={() => setSel(null)}
      list={
        <>
          <ListHeader>
            <Search className="size-3.5 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Notes" className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none" />
            <Button size="icon-sm" variant="ghost" onClick={create} title="New Note">
              <Plus />
            </Button>
          </ListHeader>
          {shown.map((n) => (
            <DocRow key={n.id} doc={n} active={n.id === sel} onClick={() => setSel(n.id)} />
          ))}
        </>
      }
      detail={
        note && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-1.5 border-b px-3">
              {note.tags.map((t) => (
                <TagPill key={t} tag={t} />
              ))}
              <span className="flex-1" />
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                {saved ? <Check className="size-3" /> : <Pencil className="size-3" />}
                {saved ? 'Saved' : 'Editing'} · notes/{note.updated}-{note.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}.md
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <MarkdownEditor
                key={note.id}
                value={note.body}
                onChange={(md) => {
                  setSaved(false)
                  const title = md.match(/^#\s+(.+)$/m)?.[1] ?? note.title
                  setNotes((ns) => ns.map((n) => (n.id === note.id ? { ...n, body: md, title, updated: TODAY } : n)))
                  window.clearTimeout((window as unknown as { _t: number })._t)
                  ;(window as unknown as { _t: number })._t = window.setTimeout(() => setSaved(true), 600)
                }}
              />
            </div>
          </div>
        )
      }
    />
  )
}

// ---------------------------------------------------------------- Dev logs

export function DevLogsView() {
  const [sel, setSel] = useState<string | null>(DEVLOGS[0].id)
  const [range, setRange] = useState<'day' | 'week'>('day')
  const [editing, setEditing] = useState(false)
  const log = DEVLOGS.find((d) => d.id === sel)
  const rows = [...DEVLOGS.map((d) => ({ id: d.id, doc: d })), ...MISSING_DEVLOGS.map((id) => ({ id, doc: null }))].sort((a, b) => b.id.localeCompare(a.id))
  const weekMd = DEVLOGS.map((d) => `# ${d.title}\n\n${d.body.replace(/^## /gm, '### ')}`).join('\n\n')
  return (
    <ListDetail
      hasSelection={!!log || range === 'week'}
      onBack={() => (setSel(null), setRange('day'))}
      list={
        <>
          <ListHeader>
            <div className="flex rounded-md bg-muted p-0.5 text-xs">
              {(['day', 'week'] as const).map((r) => (
                <button key={r} type="button" onClick={() => setRange(r)} className={cn('rounded px-2 py-0.5 capitalize text-muted-foreground', range === r && 'bg-background text-foreground shadow-sm')}>
                  {r}
                </button>
              ))}
            </div>
            <span className="flex-1" />
            <span className="text-[11px] text-muted-foreground">Oct 2026</span>
          </ListHeader>
          {rows.map(({ id, doc }) =>
            doc ? (
              <DocRow key={id} doc={doc} active={range === 'day' && id === sel} onClick={() => (setSel(id), setRange('day'), setEditing(false))} meta={fmtDay(id).split(' ')[0]} />
            ) : (
              <div key={id} className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
                <CalendarPlus className="size-3.5" />
                <span className="flex-1">{fmtDay(id)}: no Dev log</span>
                <span className="rounded bg-muted px-1 font-mono text-[10px]">/devlog</span>
              </div>
            ),
          )}
        </>
      }
      detail={
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-1.5 border-b px-3">
            <span className="truncate text-sm font-medium">{range === 'week' ? 'Week of 26 October' : log?.title}</span>
            {range === 'day' && log?.tags.map((t) => <TagPill key={t} tag={t} />)}
            <span className="flex-1" />
            {range === 'day' && (
              <Button size="xs" variant="ghost" onClick={() => setEditing(!editing)}>
                {editing ? <Eye /> : <Pencil />} {editing ? 'View' : 'Edit'}
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {range === 'week' ? (
              <MarkdownEditor key="week" value={weekMd} readonly />
            ) : (
              log && <MarkdownEditor key={log.id + editing} value={log.body} readonly={!editing} />
            )}
          </div>
        </div>
      }
    />
  )
}

// ---------------------------------------------------------------- Sketches (Mermaid)

let renderSeq = 0

function MermaidPreview({ code, dark }: { code: string; dark: boolean }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'neutral', fontFamily: 'Geist Variable, sans-serif' })
    const t = setTimeout(() => {
      mermaid
        .render(`mmd-${++renderSeq}`, code)
        .then((r) => alive && (setSvg(r.svg), setError('')))
        .catch((e) => alive && setError(String(e?.message ?? e).split('\n')[0]))
    }, 250)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [code, dark])
  return (
    <div className="relative flex min-h-40 flex-1 items-center justify-center overflow-auto p-3">
      <div className={cn('w-full max-w-2xl [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-full!', error && 'opacity-40')} dangerouslySetInnerHTML={{ __html: svg }} />
      {error && <div className="absolute inset-x-2 bottom-2 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">{error}</div>}
    </div>
  )
}

export function SketchesView({ dark }: { dark: boolean }) {
  const [sketches, setSketches] = useState(SKETCHES)
  const [sel, setSel] = useState<string | null>(SKETCHES[0].id)
  const [mode, setMode] = useState<'split' | 'preview' | 'code'>('split')
  const sk = sketches.find((s) => s.id === sel)
  return (
    <ListDetail
      hasSelection={!!sk}
      onBack={() => setSel(null)}
      list={
        <>
          <ListHeader>
            <span className="flex-1 px-1 text-xs text-muted-foreground">Mermaid in Markdown</span>
            <Button
              size="icon-sm"
              variant="ghost"
              title="New Sketch"
              onClick={() => {
                const id = `s${Date.now()}`
                setSketches((s) => [{ id, title: 'Untitled sketch', tags: [], updated: TODAY, body: 'flowchart LR\n  A --> B' }, ...s])
                setSel(id)
              }}
            >
              <Plus />
            </Button>
          </ListHeader>
          {sketches.map((s) => (
            <DocRow key={s.id} doc={s} active={s.id === sel} onClick={() => setSel(s.id)} meta={s.body.split(/\s/)[0]} />
          ))}
        </>
      }
      detail={
        sk && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-1.5 border-b px-3">
              <span className="truncate text-sm font-medium">{sk.title}</span>
              <span className="flex-1" />
              <div className="flex rounded-md bg-muted p-0.5">
                {([
                  ['preview', Eye],
                  ['split', Columns2],
                  ['code', Code],
                ] as const).map(([m, Icon]) => (
                  <button key={m} type="button" title={m} onClick={() => setMode(m)} className={cn('rounded px-1.5 py-0.5 text-muted-foreground', mode === m && 'bg-background text-foreground shadow-sm')}>
                    <Icon className="size-3.5" />
                  </button>
                ))}
              </div>
            </div>
            <div className={cn('flex min-h-0 flex-1', mode === 'split' && 'flex-col @3xl:flex-row')}>
              {mode !== 'code' && <MermaidPreview code={sk.body} dark={dark} />}
              {mode !== 'preview' && (
                <textarea
                  value={sk.body}
                  onChange={(e) => setSketches((ss) => ss.map((s) => (s.id === sk.id ? { ...s, body: e.target.value } : s)))}
                  spellCheck={false}
                  className={cn(
                    'min-h-40 flex-1 resize-none bg-muted/30 p-3 font-mono text-xs leading-relaxed outline-none',
                    mode === 'split' && 'border-t @3xl:border-l @3xl:border-t-0',
                  )}
                />
              )}
            </div>
          </div>
        )
      }
    />
  )
}
