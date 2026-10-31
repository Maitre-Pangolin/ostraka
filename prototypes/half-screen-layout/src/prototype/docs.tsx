// PROTOTYPE: Notes (Milkdown Crepe), Dev logs (rendered Markdown) and Sketches (Mermaid) views for #10. Throw away.
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ArrowLeft, CalendarPlus, Check, ChevronRight, Code, Columns2, Eye, Pencil, Plus, RefreshCw, Search, Sparkles } from 'lucide-react'
import mermaid from 'mermaid'
import { useEffect, useState, type ReactNode } from 'react'
import { DEVLOGS, MISSING_DEVLOGS, MONTHLY_DEVLOGS, SKETCHES, TODAY, type Doc } from './data'
import { RichEditor } from './linking'
import { VARIANT } from './variant'
import { useStore } from './store'
import { TagPill } from './todos'

// ---------------------------------------------------------------- Markdown editor (Milkdown Crepe)

// #17: Notes and Dev logs get the same MR / Jira picker; variant A inserts tokens, B and C insert Markdown links.
export function MarkdownEditor({ value, readonly, onChange }: { value: string; readonly?: boolean; onChange?: (md: string) => void }) {
  return <RichEditor value={value} readonly={readonly} onChange={onChange} refMode={VARIANT === 'A' ? 'token' : 'link'} />
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

type LogSel = { kind: 'day' | 'week' | 'month'; id: string }

const weekOf = (iso: string) => {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

export function DevLogsView() {
  const [sel, setSel] = useState<LogSel | null>(null)
  const [editing, setEditing] = useState(false)
  const pick = (s: LogSel) => (setSel(s), setEditing(false))
  const days = [...DEVLOGS.map((d) => ({ id: d.id, doc: d as Doc | null })), ...MISSING_DEVLOGS.map((id) => ({ id, doc: null }))].sort((a, b) => b.id.localeCompare(a.id))
  const weeks = [...new Set(days.map((d) => weekOf(d.id)))]
  const month = MONTHLY_DEVLOGS[0]
  const weekMd = (w: string) =>
    DEVLOGS.filter((d) => weekOf(d.id) === w)
      .map((d) => `# ${d.title}\n\n${d.body.replace(/^## /gm, '### ')}`)
      .join('\n\n')
  const doc =
    sel?.kind === 'day' ? DEVLOGS.find((d) => d.id === sel.id) : sel?.kind === 'month' ? MONTHLY_DEVLOGS.find((m) => m.id === sel.id) : undefined
  const isSel = (s: LogSel) => sel?.kind === s.kind && sel.id === s.id
  return (
    <ListDetail
      hasSelection={!!sel}
      onBack={() => setSel(null)}
      list={
        <>
          <button
            type="button"
            onClick={() => pick({ kind: 'month', id: month.id })}
            className={cn('sticky top-0 z-10 flex h-10 shrink-0 items-center gap-2 border-b bg-background px-3 text-left hover:bg-muted/60', isSel({ kind: 'month', id: month.id }) && 'bg-accent')}
          >
            <span className="text-sm font-semibold">{month.title}</span>
            <span className="flex items-center gap-1 rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
              <Sparkles className="size-3" /> summary
            </span>
            <span className="flex-1" />
            <span className="text-[11px] text-muted-foreground">{DEVLOGS.length} logs</span>
          </button>
          {weeks.map((w) => (
            <div key={w}>
              <button
                type="button"
                onClick={() => pick({ kind: 'week', id: w })}
                className={cn('flex w-full items-center gap-1 bg-muted/40 px-3 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground', isSel({ kind: 'week', id: w }) && 'bg-accent text-foreground')}
              >
                Week of {fmtDay(w).split(' ').slice(1).join(' ')}
                <ChevronRight className="ml-auto size-3" />
              </button>
              {days
                .filter((d) => weekOf(d.id) === w)
                .map(({ id, doc }) =>
                  doc ? (
                    <DocRow key={id} doc={doc} active={isSel({ kind: 'day', id })} onClick={() => pick({ kind: 'day', id })} meta={fmtDay(id).split(' ')[0]} />
                  ) : (
                    <div key={id} className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
                      <CalendarPlus className="size-3.5" />
                      <span className="flex-1">{fmtDay(id)}: no Dev log</span>
                      <span className="rounded bg-muted px-1 font-mono text-[10px]">/devlog</span>
                    </div>
                  ),
                )}
            </div>
          ))}
        </>
      }
      detail={
        sel && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-1.5 border-b px-3">
              <span className="truncate text-sm font-medium">{sel.kind === 'week' ? `Week of ${fmtDay(sel.id).split(' ').slice(1).join(' ')}` : doc?.title}</span>
              {doc?.tags.map((t) => <TagPill key={t} tag={t} />)}
              <span className="flex-1" />
              {sel.kind === 'month' && <span className="hidden text-[11px] text-muted-foreground @md:inline">devlogs/{sel.id}.md · from {DEVLOGS.length} daily logs</span>}
              {sel.kind !== 'week' && (
                <Button size="xs" variant="ghost" onClick={() => setEditing(!editing)}>
                  {editing ? <Eye /> : <Pencil />} {editing ? 'View' : 'Edit'}
                </Button>
              )}
              {sel.kind === 'month' && (
                <Button size="xs" variant="ghost" title="Regenerate with /devlog-month">
                  <RefreshCw />
                </Button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {sel.kind === 'week' ? (
                <MarkdownEditor key={'w' + sel.id} value={weekMd(sel.id)} readonly />
              ) : (
                doc && <MarkdownEditor key={doc.id + editing} value={doc.body} readonly={!editing} />
              )}
            </div>
          </div>
        )
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
  const [sel, setSel] = useState<string | null>(null)
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
