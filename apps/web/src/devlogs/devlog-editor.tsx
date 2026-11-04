// Editing a Dev log or monthly summary in the Notes editor, once Edit is pressed. Saves as Notes do: after a pause,
// on leaving and when the window closes, from the version the editor was loaded with; a stale save is refused and
// the newer content shown.
import { lazy, Suspense, useImperativeHandle, useRef, type RefObject } from 'react'
import { useAutosave, type SaveState } from '@/lib/use-autosave'
import type { NoteEditorHandle } from '@/notes/note-editor'
import { saveDevlog, useDevlog, useUpdateDevlog, type Devlog, type MonthlySummary } from './api'

// Milkdown loads with the first edit, not with the app.
const NoteEditor = lazy(() => import('@/notes/note-editor').then((module) => ({ default: module.NoteEditor })))

/** `flush()` saves what is waiting now: before the history opens, so it and a restore start from it. */
export type DevlogEditorHandle = { flush(): void }

/**
 * The editor over one file's body. `onState` reports the save state for the header, `onError` a refused or failed
 * save. Nothing is saved until the user edits.
 */
export function DevlogEditor({
  id,
  onState,
  onError,
  handle,
}: {
  id: string
  onState: (state: SaveState) => void
  onError: (error: string | undefined) => void
  handle?: RefObject<DevlogEditorHandle | null>
}) {
  const editor = useRef<NoteEditorHandle | null>(null)
  const autosave = useAutosave({
    path: `devlogs/${id}.md`,
    query: useDevlog(id),
    update: useUpdateDevlog(id),
    textOf: (log: Devlog | MonthlySummary) => log.body,
    changeOf: (body) => ({ body }),
    saveOnClose: (change, version) => void saveDevlog(id, change, version, true),
    beforeFlush: () => editor.current?.flush(),
    onState,
    onError,
  })
  useImperativeHandle(handle, () => ({ flush: autosave.flush }))

  const { loaded } = autosave
  if (!loaded) return null
  return (
    <Suspense>
      <NoteEditor key={loaded.count} markdown={loaded.text} onEdit={autosave.onEdit} handle={editor} />
    </Suspense>
  )
}
