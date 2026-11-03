// Sketches over the server API, as TanStack Query hooks. Keys start with 'sketches', so live updates refetch them.
import type { NewSketch, Sketch, SketchChange, SketchListing } from '@ostraka/core/sketch-schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { patch, post, request } from '@/lib/api'

export type { Sketch, SketchListing }

const SKETCHES = ['sketches'] as const
const TAGS = ['tags'] as const

/** Every Sketch (a broken one with its error), most recently changed first. */
export function useSketches() {
  return useQuery({ queryKey: ['sketches', 'list'], queryFn: () => request<SketchListing[]>('/sketches') })
}

/** One Sketch with its Mermaid text. A broken one answers its error. */
export function useSketch(id: string) {
  return useQuery({ queryKey: ['sketches', 'one', id], queryFn: () => request<Sketch>(`/sketches/${encodeURIComponent(id)}`) })
}

export function useCreateSketch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (sketch: NewSketch) => post<Sketch>('/sketches', sketch),
    onSuccess: (sketch) => queryClient.setQueryData(['sketches', 'one', sketch.id], sketch),
    onSettled: () =>
      Promise.all([queryClient.invalidateQueries({ queryKey: SKETCHES }), queryClient.invalidateQueries({ queryKey: TAGS })]),
  })
}

/** Sends a change to a Sketch; `keepalive` lets it finish while the page closes. Starts the request at once. */
export const saveSketch = (id: string, change: SketchChange, version: string, keepalive?: boolean) =>
  patch<Sketch>(`/sketches/${encodeURIComponent(id)}`, change, { version, keepalive })

/**
 * Saves a Sketch's Mermaid text, title or Tags from the copy it was made from (`version`); refused with 412 if the
 * file changed elsewhere since. Saves of one Sketch go one after the other, each from the version the one before left.
 */
export function useUpdateSketch(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    scope: { id: `sketch-${id}` },
    mutationFn: ({ version, ...change }: SketchChange & { version: string }) => saveSketch(id, change, version),
    onSuccess: (sketch) => queryClient.setQueryData(['sketches', 'one', id], sketch),
    onSettled: (_sketch, _error, change) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: SKETCHES }),
        change.tags && queryClient.invalidateQueries({ queryKey: TAGS }),
      ]),
  })
}
