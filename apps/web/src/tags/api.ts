// Tag management over the server API. A rename, merge or delete rewrites Todos, Notes, Dev logs and Sketches, so
// every content query refetches once it settles (live updates would bring the same changes a moment later).
import type { Tag, TagColor, TagCounts, TagUsage } from '@ostraka/core/tag-color'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { post, remove, request } from '@/lib/api'

export type { TagColor, TagCounts, TagUsage }

const USAGE = ['tags', 'usage'] as const

/** Every Tag in use, sorted by name, with its colour and usage. */
export function useTagUsage() {
  return useQuery({ queryKey: USAGE, queryFn: () => request<TagUsage[]>('/tags/usage') })
}

function useTagChange<T>(mutationFn: (input: T) => Promise<TagCounts>) {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn, onSettled: () => queryClient.invalidateQueries() })
}

const path = (name: string) => `/tags/${encodeURIComponent(name)}`

/** Renames a Tag on everything using it, carrying its colour over. */
export const useRenameTag = () =>
  useTagChange(({ name, to }: { name: string; to: string }) => post<TagCounts>(`${path(name)}/rename`, { to }))

/** Merges a Tag into another on everything using it; the other keeps its colour. */
export const useMergeTag = () =>
  useTagChange(({ name, into }: { name: string; into: string }) => post<TagCounts>(`${path(name)}/merge`, { into }))

/** Removes a Tag from everything using it. */
export const useDeleteTag = () => useTagChange((name: string) => remove<TagCounts>(path(name)))

/** Saves a Tag's colour to `tags.yml` (null goes back to the colour its name hashes to). Shown at once. */
export function useSetTagColor() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ name, color }: { name: string; color: TagColor | null }) =>
      request<void>(`${path(name)}/color`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ color }),
      }),
    onMutate: async ({ name, color }) => {
      if (color === null) return
      await queryClient.cancelQueries({ queryKey: ['tags'] })
      const before = queryClient.getQueriesData<Tag[]>({ queryKey: ['tags'] })
      for (const [key, tags] of before) {
        queryClient.setQueryData(
          key,
          tags?.map((tag) => (tag.name === name ? { ...tag, color } : tag)),
        )
      }
      return { before }
    },
    onError: (_error, _input, context) => {
      for (const [key, tags] of context?.before ?? []) queryClient.setQueryData(key, tags)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tags'] }),
  })
}
