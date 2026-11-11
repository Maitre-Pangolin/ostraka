// Saving one content file open in an editor (a Note, a Sketch, a Dev log) as it is edited. Nothing is written on
// opening. An edit saves after a pause, on leaving and when the window closes, from the version the editor was loaded
// with. A change made elsewhere reloads the editor when no edit is waiting; with one waiting, the save is refused
// (412), the error says so and the newer content shows. Imports relatively, so the root test run resolves it.
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { onFileRestore } from '../history/api'
import { isStale } from './api'

/** How long typing pauses before the file is saved. */
export const SAVE_AFTER_MS = 600

/** The quiet status in the file's header: Editing, Saving…, Saved. */
export type SaveState = 'saved' | 'editing' | 'saving'

/** What the editor shows: the text it was loaded with, from which version. A new `count` remounts the editor. */
export type Loaded = { text: string; version: string; count: number }

export type AutosaveOptions<Item extends { version: string }, Change> = {
  /** The file's path in the content folder (`notes/<id>.md`): a restore of it reloads the editor. */
  path: string
  query: Pick<UseQueryResult<Item, Error>, 'data' | 'refetch'>
  update: Pick<UseMutationResult<Item, Error, Change & { version: string }>, 'mutate' | 'isPending'>
  /** The text the editor edits, in the file: its body, its Mermaid text. */
  textOf: (item: Item) => string
  /** The change that saves edited text: `{ body }`, `{ mermaid }`. */
  changeOf: (text: string) => Change
  /** Saves at once as the window closes (a `keepalive` request): it has to start now, not after the mutation queue's next tick. */
  saveOnClose: (change: Change, version: string) => void
  /** Hands over an edit the editor still holds (Milkdown's own pause) before what is waiting is read. */
  beforeFlush?: () => void
  onState: (state: SaveState) => void
  /** A refused or failed save's message, or undefined once a save went through. */
  onError: (error: string | undefined) => void
}

export type Autosave<Change> = {
  /** Undefined until the file has loaded. */
  loaded: Loaded | undefined
  /** The editor's text changed: saved once typing pauses. */
  onEdit(text: string): void
  /** Saves what is waiting now: before the history opens, so it and a restore start from it. */
  flush(): void
  /** Saves another change to the file (its title, Tags), after what is waiting. */
  change(change: Change): void
}

export function useAutosave<Item extends { version: string }, Change>(options: AutosaveOptions<Item, Change>): Autosave<Change> {
  const { path, query, update, textOf, changeOf, saveOnClose, beforeFlush, onState, onError } = options
  const [loaded, setLoaded] = useState<Loaded>()
  const pending = useRef<string | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Versions this view wrote: the refetch after its own save is not a change made elsewhere.
  const own = useRef(new Set<string>())
  // A restore of this file started: its result reloads the editor even at a version seen before.
  const restored = useRef(false)

  // Read when the file loads; a new function each render changes nothing, so it is no reason to load again.
  const textOfRef = useRef(textOf)
  useEffect(() => {
    textOfRef.current = textOf
  })

  const item = query.data
  useEffect(() => {
    if (!item || (own.current.has(item.version) && !restored.current)) return
    // A change made elsewhere: shown at once, unless an edit is waiting (its save is refused and then shows it).
    if (pending.current !== undefined || update.isPending) return
    const reload = restored.current
    restored.current = false
    setLoaded((current) =>
      current?.version === item.version && !reload
        ? current
        : { text: textOfRef.current(item), version: item.version, count: (current?.count ?? 0) + 1 },
    )
  }, [item, update.isPending])

  const save = (change: Change) => {
    if (!loaded) return
    onState('saving')
    update.mutate(
      { ...change, version: loaded.version },
      {
        onSuccess: (saved) => {
          own.current.add(saved.version)
          // Saved over whatever a restore left (or a restore that changed nothing): no reload is due.
          restored.current = false
          onError(undefined)
          onState(pending.current === undefined ? 'saved' : 'editing')
        },
        onError: async (failed) => {
          pending.current = undefined
          onState('saved')
          onError(isStale(failed) ? `${failed.message} Showing the newer version.` : failed.message)
          if (!isStale(failed)) return
          const { data: newer } = await query.refetch()
          if (newer) setLoaded((current) => ({ text: textOf(newer), version: newer.version, count: (current?.count ?? 0) + 1 }))
        },
      },
    )
  }

  const flush = () => {
    beforeFlush?.()
    clearTimeout(timer.current)
    const text = pending.current
    if (text === undefined) return
    pending.current = undefined
    save(changeOf(text))
  }
  const flushOnClose = () => {
    beforeFlush?.()
    clearTimeout(timer.current)
    const text = pending.current
    if (text === undefined || !loaded) return
    pending.current = undefined
    saveOnClose(changeOf(text), loaded.version)
  }
  const flushRef = useRef({ flush, flushOnClose })
  useEffect(() => {
    flushRef.current = { flush, flushOnClose }
  })
  // A restore may bring back a version this view saved or loaded earlier: the restored file is shown regardless.
  useEffect(
    () =>
      onFileRestore((restoredPath) => {
        if (restoredPath !== path) return
        own.current.clear()
        restored.current = true
      }),
    [path],
  )
  // Leaving the file (another one opened, the view or the window closed) saves what is waiting.
  useEffect(() => {
    const leave = () => flushRef.current.flushOnClose()
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('pagehide', leave)
      flushRef.current.flush()
    }
  }, [])

  return {
    loaded,
    onEdit(text) {
      pending.current = text
      onState('editing')
      clearTimeout(timer.current)
      timer.current = setTimeout(() => flushRef.current.flush(), SAVE_AFTER_MS)
    },
    flush: () => flushRef.current.flush(),
    change(change) {
      flush()
      save(change)
    },
  }
}
