// Dev logs over the server API, as TanStack Query hooks. Keys start with 'devlogs', so live updates refetch them.
import type { BrokenDevlog, Devlog, DevlogChange, DevlogListing, MonthlySummary } from '@ostraka/core/devlog-schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { patch, request } from '@/lib/api'
import { useFinishedTodos, useOpenTodos } from '@/todos/api'

export type { BrokenDevlog, Devlog, DevlogListing, MonthlySummary }

const DEVLOGS = ['devlogs'] as const

/** Every day and monthly summary, newest first, without bodies; a broken file with its error. */
export function useDevlogs() {
  return useQuery({ queryKey: ['devlogs', 'list'], queryFn: () => request<DevlogListing[]>('/devlogs') })
}

/** The days from `from` to `to` with their bodies, newest first. */
export function useDevlogDays(range: { from: string; to: string } | undefined) {
  return useQuery({
    queryKey: ['devlogs', 'days', range?.from, range?.to],
    queryFn: () => request<(Devlog | BrokenDevlog)[]>(`/devlogs/days?from=${range!.from}&to=${range!.to}`),
    enabled: range !== undefined,
  })
}

/** One day or monthly summary with its body. A broken one answers its error. */
export function useDevlog(id: string | undefined) {
  return useQuery({
    queryKey: ['devlogs', 'one', id],
    queryFn: () => request<Devlog | MonthlySummary>(`/devlogs/${encodeURIComponent(id!)}`),
    enabled: id !== undefined,
  })
}

/** Sends a new body; `keepalive` lets it finish while the page closes. Starts the request at once. */
export const saveDevlog = (id: string, change: DevlogChange, version: string, keepalive?: boolean) =>
  patch<Devlog | MonthlySummary>(`/devlogs/${encodeURIComponent(id)}`, change, { version, keepalive })

/**
 * Saves a body edited from the copy it was loaded with (`version`); refused with 412 if the file changed elsewhere
 * since. Saves of one file go one after the other, each from the version the one before left.
 */
export function useUpdateDevlog(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    scope: { id: `devlog-${id}` },
    mutationFn: ({ version, ...change }: DevlogChange & { version: string }) => saveDevlog(id, change, version),
    onSuccess: (log) => queryClient.setQueryData(['devlogs', 'one', id], log),
    onSettled: () => queryClient.invalidateQueries({ queryKey: DEVLOGS }),
  })
}

/** Todo and Sub-todo titles by id, open and finished, for the Todo links in Dev logs. */
export function useTodoTitles(): { titles: Map<string, { title: string; finished: boolean }>; ready: boolean } {
  const open = useOpenTodos()
  const finished = useFinishedTodos()
  const titles = useMemo(() => {
    const map = new Map<string, { title: string; finished: boolean }>()
    for (const todo of [...(open.data ?? []), ...(finished.data ?? [])]) {
      for (const item of [todo, ...todo.subTodos]) map.set(item.id, { title: item.title, finished: item.status !== 'open' })
    }
    return map
  }, [open.data, finished.data])
  return { titles, ready: open.isSuccess && finished.isSuccess }
}
