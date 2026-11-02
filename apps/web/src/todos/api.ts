// Todos over the server API, as TanStack Query hooks. The server sorts; the cache holds its answer as is.
import type { DropTodo, NewTodo, Todo as StoredTodo } from '@ostraka/core/todo-schema'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ifMatch, post, request } from '@/lib/api'

/** A Todo as the server answers it, with the version a change made from this copy sends back. */
export type Todo = StoredTodo & { version: string }

const TODOS = ['todos'] as const
const OPEN_TODOS = ['todos', 'open'] as const
const FINISHED_TODOS = ['todos', 'finished'] as const

export function useOpenTodos() {
  return useQuery({ queryKey: OPEN_TODOS, queryFn: () => request<Todo[]>('/todos') })
}

/** Done and Dropped Todos, newest-finished first. */
export function useFinishedTodos() {
  return useQuery({ queryKey: FINISHED_TODOS, queryFn: () => request<Todo[]>('/todos/finished') })
}

export function useAddTodo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (todo: NewTodo) => post<Todo>('/todos', todo),
    onSettled: () => queryClient.invalidateQueries({ queryKey: OPEN_TODOS }),
  })
}

/**
 * An immediate change: the Todo leaves the listed lists before the server answers and comes back if it fails.
 * Every list refetches once it settles, so the Todo lands in its place in the other list.
 */
function immediate<T>(queryClient: QueryClient, lists: (readonly string[])[], idOf: (input: T) => string) {
  return {
    onMutate: async (input: T) => {
      await queryClient.cancelQueries({ queryKey: TODOS })
      const before = lists.map((key) => [key, queryClient.getQueryData<Todo[]>(key)] as const)
      for (const key of lists) queryClient.setQueryData<Todo[]>(key, (todos) => todos?.filter((todo) => todo.id !== idOf(input)))
      return { before }
    },
    onError: (_error: Error, _input: T, context?: { before: (readonly [readonly string[], Todo[] | undefined])[] }) => {
      for (const [key, todos] of context?.before ?? []) queryClient.setQueryData(key, todos)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: TODOS }),
  }
}

export function useCompleteTodo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, version }: Todo) => post<Todo>(`/todos/${id}/done`, undefined, { version }),
    ...immediate(queryClient, [OPEN_TODOS], (todo: Todo) => todo.id),
  })
}

/** Drop with an optional reason; a blank reason counts as skipped. */
export function useDropTodo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ todo: { id, version }, ...input }: DropTodo & { todo: Todo }) => post<Todo>(`/todos/${id}/drop`, input, { version }),
    ...immediate(queryClient, [OPEN_TODOS], ({ todo }: { todo: Todo }) => todo.id),
  })
}

/** Delete removes the Todo for good; Undo puts it back through `useRestoreTodo`. */
export function useDeleteTodo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, version }: Todo) => request<Todo>(`/todos/${id}`, { method: 'DELETE', headers: ifMatch(version) }),
    ...immediate(queryClient, [OPEN_TODOS, FINISHED_TODOS], (todo: Todo) => todo.id),
  })
}

/** Undo of done or Drop, and unchecking a finished Todo: it is open again. */
export function useReopenTodo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, version }: Todo) => post<Todo>(`/todos/${id}/reopen`, undefined, { version }),
    ...immediate(queryClient, [FINISHED_TODOS], (todo: Todo) => todo.id),
  })
}

/** Undo of delete: the Todo comes back exactly as it was. */
export function useRestoreTodo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (todo: Todo) => post<Todo>('/todos/restore', todo),
    onSettled: () => queryClient.invalidateQueries({ queryKey: TODOS }),
  })
}
