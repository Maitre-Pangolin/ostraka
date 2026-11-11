// A content file's history over the server API, as TanStack Query hooks. The list's key starts with the file's
// kind, so live updates refetch it with the file; one version's text never changes, so it is fetched once.
import type { FileSnapshot, FileVersion, Restore } from '@ostraka/core/history-schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { forgetOwnChanges, post, request } from '../lib/api' // Relative, so the root test run resolves it.

export type { FileSnapshot, Restore }

/** The content kind a file belongs to, as live updates name it: `notes/<id>.md` is 'notes', `todos.json` 'todos'. */
export const kindOf = (path: string) => (path.includes('/') ? path.slice(0, path.indexOf('/')) : path.slice(0, path.indexOf('.')))

const query = (path: string) => `?path=${encodeURIComponent(path)}`

/** The Snapshots that changed one content file, newest first. */
export function useFileHistory(path: string) {
  return useQuery({
    queryKey: [kindOf(path), 'history', path],
    queryFn: () => request<FileSnapshot[]>(`/history${query(path)}`),
  })
}

/** The file's text as one Snapshot held it. */
export function useFileVersion(path: string, commit: string | undefined) {
  return useQuery({
    queryKey: ['snapshot-version', path, commit],
    queryFn: () => request<FileVersion>(`/history/${commit!}${query(path)}`),
    enabled: commit !== undefined,
    staleTime: Infinity,
  })
}

const restoreListeners = new Set<(path: string) => void>()

/**
 * Tells a view that shows a file when a restore of it starts, from the panel or its Undo toast. A restore may bring
 * back a version the view saved itself earlier, which it would otherwise take for the echo of its own save.
 */
export function onFileRestore(listener: (path: string) => void): () => void {
  restoreListeners.add(listener)
  return () => void restoreListeners.delete(listener)
}

/** Sends a restore: the file as the Snapshot `commit` held it, written and committed as a new Snapshot. */
export function restoreFile(path: string, commit: string) {
  forgetOwnChanges()
  for (const listener of restoreListeners) listener(path)
  return post<Restore>('/history/restore', { path, commit })
}

/**
 * Restores the file as a Snapshot held it, then refetches its kind. Undone by restoring the answer's `before`: `undo`
 * works after the panel has gone (from an Undo toast).
 */
export function useRestoreFile(path: string) {
  const queryClient = useQueryClient()
  const refetch = () => queryClient.invalidateQueries({ queryKey: [kindOf(path)] })
  const restore = useMutation({ mutationFn: (commit: string) => restoreFile(path, commit), onSettled: refetch })
  const undo = (before: FileSnapshot) => void restoreFile(path, before.commit).finally(refetch)
  return { restore, undo }
}
