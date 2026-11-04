import { isBrokenSketch, type SketchMode, type SketchesView as ViewState } from '@ostraka/core/sketch-schema'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { ArrowLeft, Code, Columns2, Eye, Plus, TriangleAlert } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ApiError, isStale } from '@/lib/api'
import { onFileRestore } from '@/history/api'
import { FileHistory, HistoryButton } from '@/history/file-history'
import { useAfter } from '@/lib/use-after'
import { cn } from '@/lib/utils'
import { SaveStatus, TagAdder, type SaveState } from '@/notes/notes-view'
import { useRememberOpened } from '@/search/recent'
import { EmptyState } from '@/shell/shell'
import { TagDot, TagPill } from '@/todos/properties'
import { saveSketch, useCreateSketch, useSketch, useSketches, useUpdateSketch, type Sketch, type SketchListing } from './api'
import { useMermaid } from './use-mermaid'

// CodeMirror loads with the first open Sketch, Mermaid with the first diagram; neither with the app.
const MermaidEditor = lazy(() => import('./mermaid-editor').then((module) => ({ default: module.MermaidEditor })))

const focusRing = 'outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

/** How long typing pauses before the Sketch is saved. */
const SAVE_AFTER_MS = 600

/**
 * The Sketches view: it opens on the list, with the open Sketch beside it from `@3xl` and one at a time below. The
 * open Sketch and its mode (preview, split, code) live in the URL.
 */
export function SketchesView() {
  const view = useSearch({ from: '/sketches' })
  const navigate = useNavigate({ from: '/sketches' })
  const setView = (next: ViewState) => void navigate({ search: next, replace: true })
  const open = (sketch: string | undefined) => setView({ ...view, sketch })
  return (
    <div className="flex h-full min-h-0">
      <section
        aria-label="Sketches"
        className={cn('min-h-0 w-full shrink-0 flex-col overflow-y-auto border-r @3xl:flex @3xl:w-72', view.sketch ? 'hidden' : 'flex')}
      >
        <SketchesList openId={view.sketch} onOpen={open} />
      </section>
      <section className={cn('min-h-0 min-w-0 flex-1 flex-col', view.sketch ? 'flex' : 'hidden @3xl:flex')}>
        {view.sketch ? (
          <>
            <button
              type="button"
              onClick={() => open(undefined)}
              className={cn(
                'text-muted-foreground hover:text-foreground flex h-8 shrink-0 items-center gap-1 border-b px-2 text-xs @3xl:hidden',
                focusRing,
              )}
            >
              <ArrowLeft className="size-3.5" /> All Sketches
            </button>
            <SketchDetail
              key={view.sketch}
              id={view.sketch}
              mode={view.mode ?? 'split'}
              onMode={(mode) => setView({ ...view, mode: mode === 'split' ? undefined : mode })}
            />
          </>
        ) : (
          <EmptyState>Pick a Sketch on the left, or start one.</EmptyState>
        )}
      </section>
    </div>
  )
}

function SketchesList({ openId, onOpen }: { openId: string | undefined; onOpen: (id: string) => void }) {
  const sketches = useSketches()
  const create = useCreateSketch()
  const slow = useAfter(300, sketches.isPending)
  const start = () => create.mutate({ title: 'Untitled' }, { onSuccess: (sketch) => onOpen(sketch.id) })
  return (
    <>
      <div className="bg-background sticky top-0 z-10 flex h-10 shrink-0 items-center gap-1.5 border-b px-2">
        <h2 className="px-1 text-sm font-medium">Sketches</h2>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={start} disabled={create.isPending}>
          <Plus /> New Sketch
        </Button>
      </div>
      {create.error && <p className="text-destructive px-3 py-1.5 text-xs">{create.error.message}</p>}
      {sketches.error && <p className="text-destructive px-3 py-2 text-sm">{sketches.error.message}</p>}
      {slow && <SkeletonRows />}
      {sketches.data && !sketches.data.length && <EmptyState>No Sketches yet. Start one to draw a diagram.</EmptyState>}
      <ul className="flex flex-col">
        {sketches.data?.map((sketch) => (
          <li key={sketch.id}>
            <SketchRow sketch={sketch} active={sketch.id === openId} onOpen={() => onOpen(sketch.id)} />
          </li>
        ))}
      </ul>
    </>
  )
}

const changedOn = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

function SketchRow({ sketch, active, onOpen }: { sketch: SketchListing; active: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active || undefined}
      className={cn(
        'hover:bg-muted/60 flex w-full min-w-0 flex-col gap-0.5 border-b px-3 py-2 text-left',
        focusRing,
        active && 'bg-accent',
      )}
    >
      {isBrokenSketch(sketch) ? (
        <>
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <TriangleAlert aria-hidden className="text-destructive size-3.5 shrink-0" />
            <span className="truncate font-mono">sketches/{sketch.id}.md</span>
          </span>
          <span className="text-destructive line-clamp-2 text-xs">{sketch.error}</span>
        </>
      ) : (
        <>
          <span className="truncate text-sm font-medium">{sketch.title}</span>
          <span className="text-muted-foreground flex min-w-0 items-center gap-1 overflow-hidden text-[11px]">
            <span className="shrink-0">{changedOn(sketch.modifiedAt)}</span>
            {sketch.tags.map((tag) => (
              <span key={tag} className="contents">
                <TagPill tag={tag} className="hidden h-4 text-[10px] @md:inline-flex" />
                <TagDot tag={tag} className="@md:hidden" />
              </span>
            ))}
          </span>
        </>
      )}
    </button>
  )
}

/**
 * One open Sketch: its title and Tags, then the Mermaid text and its live preview. Typing saves after a pause,
 * from the version the editor was loaded with; a save is refused if the file changed elsewhere since, and the newer
 * text is shown instead. A change made elsewhere (an agent) while nothing is waiting to be saved shows at once.
 * Text that doesn't draw is still saved: the error shows in place of the diagram, over the last one that drew.
 */
function SketchDetail({ id, mode, onMode }: { id: string; mode: SketchMode; onMode: (mode: SketchMode) => void }) {
  const query = useSketch(id)
  useRememberOpened('sketch', id, query.data?.title)
  const update = useUpdateSketch(id)
  // What the editor shows: the text it was loaded with, from which version; a new `loaded` remounts it.
  const [loaded, setLoaded] = useState<{ text: string; version: string; count: number }>()
  // The text as typed, for the preview.
  const [text, setText] = useState('')
  const [state, setState] = useState<SaveState>('saved')
  const [error, setError] = useState<string>()
  const pending = useRef<string | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Versions this view wrote: the refetch after its own save is not a change made elsewhere.
  const own = useRef(new Set<string>())
  const drawing = useMermaid(text)

  const [historyOpen, setHistoryOpen] = useState(false)
  // A restore of this Sketch started: its result reloads the editor even at a version seen before.
  const restored = useRef(false)

  const load = useCallback((sketch: Sketch, reload = false) => {
    setLoaded((current) =>
      current?.version === sketch.version && !reload
        ? current
        : { text: sketch.mermaid, version: sketch.version, count: (current?.count ?? 0) + 1 },
    )
    setText(sketch.mermaid)
  }, [])

  const sketch = query.data
  useEffect(() => {
    if (!sketch || (own.current.has(sketch.version) && !restored.current)) return
    // A change made elsewhere: shown at once, unless an edit is waiting (its save is refused and then shows it).
    if (pending.current !== undefined || update.isPending) return
    const reload = restored.current
    restored.current = false
    load(sketch, reload)
  }, [sketch, update.isPending, load])

  // A restore may bring back a version this view saved or loaded earlier: the restored file is shown regardless.
  useEffect(
    () =>
      onFileRestore((path) => {
        if (path !== `sketches/${id}.md`) return
        own.current.clear()
        restored.current = true
      }),
    [id],
  )

  const save = (change: { mermaid?: string; title?: string; tags?: string[] }) => {
    if (!loaded) return
    setState('saving')
    update.mutate(
      { ...change, version: loaded.version },
      {
        onSuccess: (saved: Sketch) => {
          own.current.add(saved.version)
          // Saved over whatever a restore left (or a restore that changed nothing): no reload is due.
          restored.current = false
          setError(undefined)
          setState(pending.current === undefined ? 'saved' : 'editing')
        },
        onError: async (failed) => {
          pending.current = undefined
          setState('saved')
          setError(isStale(failed) ? `${failed.message} Showing the newer version.` : failed.message)
          if (!isStale(failed)) return
          const { data: newer } = await query.refetch()
          if (newer) load(newer)
        },
      },
    )
  }

  const flush = () => {
    clearTimeout(timer.current)
    const mermaid = pending.current
    if (mermaid === undefined) return
    pending.current = undefined
    save({ mermaid })
  }
  // The window closing: the request has to start now, not after the mutation queue's next tick.
  const flushOnClose = () => {
    clearTimeout(timer.current)
    const mermaid = pending.current
    if (mermaid === undefined || !loaded) return
    pending.current = undefined
    void saveSketch(id, { mermaid }, loaded.version, true)
  }
  const flushRef = useRef({ flush, flushOnClose })
  useEffect(() => {
    flushRef.current = { flush, flushOnClose }
  })
  // Leaving the Sketch (another one opened, the view or the window closed) saves what is waiting.
  useEffect(() => {
    const leave = () => flushRef.current.flushOnClose()
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('pagehide', leave)
      flushRef.current.flush()
    }
  }, [])

  const onEdit = (next: string) => {
    setText(next)
    pending.current = next
    setState('editing')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => flushRef.current.flush(), SAVE_AFTER_MS)
  }

  if (query.error) {
    return (
      <div className="flex flex-col gap-1 p-3 text-sm">
        <p className="text-destructive">{query.error.message}</p>
        {query.error instanceof ApiError && query.error.status === 409 && (
          <p className="text-muted-foreground">
            Fix <span className="font-mono">sketches/{id}.md</span>; the Sketch opens here once it reads.
          </p>
        )}
      </div>
    )
  }
  if (!sketch || !loaded) return null

  const change = (header: { title?: string; tags?: string[] }) => {
    flush()
    save(header)
  }

  return (
    <div className="@container/sketch flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b px-2">
        <TitleField key={sketch.title} title={sketch.title} onRename={(title) => change({ title })} />
        <ModeSwitch mode={mode} onMode={onMode} />
        <SaveStatus state={state} />
        <HistoryButton
          open={historyOpen}
          onClick={() => {
            // What is waiting is saved first, so the history and a restore start from it.
            if (!historyOpen) flush()
            setHistoryOpen(!historyOpen)
          }}
        />
      </div>
      <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1">
        {sketch.tags.map((tag) => (
          <TagPill key={tag} tag={tag} onRemove={() => change({ tags: sketch.tags.filter((other) => other !== tag) })} />
        ))}
        <TagAdder tags={sketch.tags} onAdd={(tag) => change({ tags: [...sketch.tags, tag] })} />
        <span className="flex-1" />
        <span className="text-muted-foreground hidden truncate font-mono text-[11px] @md:inline">sketches/{id}.md</span>
      </div>
      {historyOpen && (
        <FileHistory path={`sketches/${id}.md`} onClose={() => setHistoryOpen(false)} onRestored={() => setHistoryOpen(false)} />
      )}
      {error && !historyOpen && <p className="text-destructive border-b px-3 py-1.5 text-xs">{error}</p>}
      {/* Hidden, not unmounted, behind the history: the editor keeps its text and undo history. */}
      <div className={cn('flex min-h-0 flex-1 flex-col', mode === 'split' && '@2xl/sketch:flex-row', historyOpen && 'hidden')}>
        {/* Both panes stay mounted, so switching modes keeps the text, its undo history and the diagram. */}
        <div
          className={cn(
            'min-h-0 flex-1 flex-col overflow-hidden',
            mode === 'preview' ? 'hidden' : 'flex',
            mode === 'split' && 'border-b @2xl/sketch:border-r @2xl/sketch:border-b-0',
          )}
        >
          <div className="min-h-0 flex-1 overflow-auto">
            <Suspense>
              <MermaidEditor key={loaded.count} text={loaded.text} onEdit={onEdit} label={`Mermaid text of ${sketch.title}`} />
            </Suspense>
          </div>
          {mode === 'code' && drawing.error && <DrawError className="border-t">{drawing.error}</DrawError>}
        </div>
        <div className={cn('min-h-0 flex-1 flex-col overflow-auto', mode === 'code' ? 'hidden' : 'flex')}>
          {drawing.error && <DrawError className="border-b">{drawing.error}</DrawError>}
          {drawing.svg ? (
            <div
              aria-label={`Diagram of ${sketch.title}`}
              role="img"
              className={cn('p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full', drawing.error && 'opacity-40')}
              dangerouslySetInnerHTML={{ __html: drawing.svg }}
            />
          ) : (
            !text.trim() && <EmptyState>Type Mermaid text to draw a diagram.</EmptyState>
          )}
        </div>
      </div>
    </div>
  )
}

/** Why the current text doesn't draw: one line, in place, while the text stays as typed. */
function DrawError({ className, children }: { className?: string; children: string }) {
  return (
    <p role="status" className={cn('text-destructive shrink-0 px-3 py-1.5 text-xs', className)}>
      {children}
    </p>
  )
}

/** The Sketch's title, edited in place: ↵ or leaving the field renames it, Esc puts it back. */
function TitleField({ title, onRename }: { title: string; onRename: (title: string) => void }) {
  const [draft, setDraft] = useState(title)
  const commit = () => {
    const next = draft.trim()
    if (next && next !== title) onRename(next)
    else setDraft(title)
  }
  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(title)
          requestAnimationFrame(() => (event.target as HTMLInputElement).blur())
        }
      }}
      aria-label="Sketch title"
      className={cn('hover:bg-muted/60 h-7 min-w-0 flex-1 truncate rounded-md bg-transparent px-1.5 text-sm font-medium', focusRing)}
    />
  )
}

const MODES: { mode: SketchMode; label: string; icon: typeof Eye }[] = [
  { mode: 'preview', label: 'Preview', icon: Eye },
  { mode: 'split', label: 'Split', icon: Columns2 },
  { mode: 'code', label: 'Code', icon: Code },
]

/** Preview, split or code: icons with a Tooltip below `@md`, labelled from it. */
function ModeSwitch({ mode, onMode }: { mode: SketchMode; onMode: (mode: SketchMode) => void }) {
  return (
    <div role="group" aria-label="Show" className="bg-muted flex shrink-0 rounded-md p-0.5 text-xs">
      {MODES.map(({ mode: option, label, icon: Icon }) => (
        <Tooltip key={option}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-pressed={mode === option}
                aria-label={label}
                onClick={() => onMode(option)}
                className={cn(
                  'text-muted-foreground flex items-center gap-1 rounded px-1.5 leading-6',
                  focusRing,
                  mode === option && 'bg-background text-foreground shadow-sm',
                )}
              />
            }
          >
            <Icon aria-hidden className="size-3.5" />
            <span className="hidden @md:inline">{label}</span>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

function SkeletonRows() {
  return (
    <ul aria-label="Loading Sketches" className="flex flex-col">
      {[60, 45, 70].map((width) => (
        <li key={width} className="flex flex-col gap-1.5 border-b px-3 py-2">
          <span className="bg-muted h-3 rounded" style={{ width: `${width}%` }} />
          <span className="bg-muted h-2 w-1/4 rounded" />
        </li>
      ))}
    </ul>
  )
}
