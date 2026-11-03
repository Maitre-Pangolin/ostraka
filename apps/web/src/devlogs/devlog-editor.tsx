// Editing a Dev log or monthly summary in the Notes editor, once Edit is pressed. Saves as Notes do: after a pause,
// on leaving and when the window closes, from the version the editor was loaded with; a stale save is refused and
// the newer content shown.
import { Check, Pencil } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { isStale } from '@/lib/api'
import type { NoteEditorHandle } from '@/notes/note-editor'
import { saveDevlog, useDevlog, useUpdateDevlog, type Devlog, type MonthlySummary } from './api'

// Milkdown loads with the first edit, not with the app.
const NoteEditor = lazy(() => import('@/notes/note-editor').then((module) => ({ default: module.NoteEditor })))

/** How long typing pauses before the file is saved. */
const SAVE_AFTER_MS = 600

export type SaveState = 'saved' | 'editing' | 'saving'

/**
 * The editor over one file's body. `onState` reports the save state for the header, `onError` a refused or failed
 * save. Nothing is saved until the user edits.
 */
export function DevlogEditor({
  id,
  onState,
  onError,
}: {
  id: string
  onState: (state: SaveState) => void
  onError: (error: string | undefined) => void
}) {
  const query = useDevlog(id)
  const update = useUpdateDevlog(id)
  const [loaded, setLoaded] = useState<{ body: string; version: string; count: number }>()
  const pending = useRef<string | undefined>(undefined)
  const editor = useRef<NoteEditorHandle | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Versions this editor wrote: the refetch after its own save is not a change made elsewhere.
  const own = useRef(new Set<string>())

  const log = query.data
  useEffect(() => {
    if (!log || own.current.has(log.version)) return
    // A change made elsewhere: shown at once, unless an edit is waiting (its save is refused and then shows it).
    if (pending.current !== undefined || update.isPending) return
    setLoaded((current) =>
      current?.version === log.version ? current : { body: log.body, version: log.version, count: (current?.count ?? 0) + 1 },
    )
  }, [log, update.isPending])

  const save = (body: string) => {
    if (!loaded) return
    onState('saving')
    update.mutate(
      { body, version: loaded.version },
      {
        onSuccess: (saved: Devlog | MonthlySummary) => {
          own.current.add(saved.version)
          onError(undefined)
          onState(pending.current === undefined ? 'saved' : 'editing')
        },
        onError: async (failed) => {
          pending.current = undefined
          onState('saved')
          onError(isStale(failed) ? `${failed.message} Showing the newer version.` : failed.message)
          if (!isStale(failed)) return
          const { data: newer } = await query.refetch()
          if (newer) setLoaded((current) => ({ body: newer.body, version: newer.version, count: (current?.count ?? 0) + 1 }))
        },
      },
    )
  }

  const flush = () => {
    editor.current?.flush()
    clearTimeout(timer.current)
    const body = pending.current
    if (body === undefined) return
    pending.current = undefined
    save(body)
  }
  // The window closing: the request has to start now, not after the mutation queue's next tick.
  const flushOnClose = () => {
    editor.current?.flush()
    clearTimeout(timer.current)
    const body = pending.current
    if (body === undefined || !loaded) return
    pending.current = undefined
    void saveDevlog(id, { body }, loaded.version, true)
  }
  const flushRef = useRef({ flush, flushOnClose })
  useEffect(() => {
    flushRef.current = { flush, flushOnClose }
  })
  // Leaving the editor (View pressed, another day opened, the window closed) saves what is waiting.
  useEffect(() => {
    const leave = () => flushRef.current.flushOnClose()
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('pagehide', leave)
      flushRef.current.flush()
    }
  }, [])

  const onEdit = (body: string) => {
    pending.current = body
    onState('editing')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => flushRef.current.flush(), SAVE_AFTER_MS)
  }

  if (!loaded) return null
  return (
    <Suspense>
      <NoteEditor key={loaded.count} markdown={loaded.body} onEdit={onEdit} handle={editor} />
    </Suspense>
  )
}

/** The quiet save status in the header: Editing, Saving…, Saved. */
export function SaveStatus({ state }: { state: SaveState }) {
  const label = state === 'saved' ? 'Saved' : state === 'saving' ? 'Saving…' : 'Editing'
  return (
    <span role="status" className="text-muted-foreground flex shrink-0 items-center gap-1 text-[11px]">
      {state === 'saved' ? <Check aria-hidden className="size-3" /> : <Pencil aria-hidden className="size-3" />}
      <span className="hidden @md:inline">{label}</span>
      <span className="sr-only @md:hidden">{label}</span>
    </span>
  )
}
