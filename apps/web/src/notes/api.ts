// Notes over the server API, as TanStack Query hooks. Keys start with 'notes', so live updates refetch them.
import { IDEA_TAG, type NewNote, type Note, type NoteChange, type NoteListing } from '@ostraka/core/note-schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { patch, post, request } from '@/lib/api'
import { saveNewPeople } from '@/people/new-people'

export type { Note, NoteListing }

const NOTES = ['notes'] as const
const TAGS = ['tags'] as const

/** Every Note (a broken one with its error), most recently changed first; `ideas` keeps only the Ideas. */
export function useNotes({ ideas }: { ideas: boolean }) {
  return useQuery({
    queryKey: ['notes', 'list', ideas ? IDEA_TAG : 'all'],
    queryFn: () => request<NoteListing[]>(ideas ? `/notes?tag=${IDEA_TAG}` : '/notes'),
  })
}

/** One Note with its body. A broken one answers its error. */
export function useNote(id: string | undefined) {
  return useQuery({
    queryKey: ['notes', 'one', id],
    queryFn: () => request<Note>(`/notes/${encodeURIComponent(id!)}`),
    enabled: id !== undefined,
  })
}

export function useCreateNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (note: NewNote) => post<Note>('/notes', note),
    onSuccess: (note) => queryClient.setQueryData(['notes', 'one', note.id], note),
    onSettled: () => Promise.all([queryClient.invalidateQueries({ queryKey: NOTES }), queryClient.invalidateQueries({ queryKey: TAGS })]),
  })
}

/**
 * Sends a change to a Note, after writing the new Persons it mentions; `keepalive` lets it finish while the page
 * closes.
 */
export async function saveNote(id: string, change: NoteChange, version: string, keepalive?: boolean) {
  await saveNewPeople(change.body)
  return patch<Note>(`/notes/${encodeURIComponent(id)}`, change, { version, keepalive })
}

/**
 * Saves a Note's body or Tags from the copy it was made from (`version`); refused with 412 if the file changed
 * elsewhere since. Saves of one Note go one after the other, each from the version the one before left.
 */
export function useUpdateNote(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    scope: { id: `note-${id}` },
    mutationFn: ({ version, ...change }: NoteChange & { version: string }) => saveNote(id, change, version),
    onSuccess: (note) => queryClient.setQueryData(['notes', 'one', id], note),
    onSettled: (_note, _error, change) =>
      Promise.all([queryClient.invalidateQueries({ queryKey: NOTES }), change.tags && queryClient.invalidateQueries({ queryKey: TAGS })]),
  })
}
