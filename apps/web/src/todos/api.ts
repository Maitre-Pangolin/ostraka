// Todos over the server API, as TanStack Query hooks. The server sorts; the cache holds its answer as is.
import type { DropTodo, NewTodo, Todo as StoredTodo, TodoChange } from '@ostraka/core/todo-schema'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { patch, post, remove, request } from '@/lib/api'

/** A Todo as the server answers it, with the version a change made from this copy sends back. */
export type Todo = StoredTodo & { version: string }
export type { TodoChange }

const TODOS = ['todos'] as const
const OPEN_TODOS = ['todos', 'open'] as const
const FINISHED_TODOS = ['todos', 'finished'] as const
const TAGS = ['tags'] as const

export function useOpenTodos() {
  return useQuery({ queryKey: OPEN_TODOS, queryFn: () => request<Todo[]>('/todos') })
}

/** The Tags in use, for `#` suggestions. */
export function useTags() {
  return useQuery({ queryKey: TAGS, queryFn: () => request<string[]>('/tags') })
}

/** Done and Dropped Todos, newest-finished first. */
export function useFinishedTodos() {
  return useQuery({ queryKey: FINISHED_TODOS, queryFn: () => request<Todo[]>('/todos/finished') })
}

export function useAddTodo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (todo: NewTodo) => post<Todo>('/todos', todo),
    onSettled: () =>
      Promise.all([queryClient.invalidateQueries({ queryKey: OPEN_TODOS }), queryClient.invalidateQueries({ queryKey: TAGS })]),
  })
}

/** The cached Todo with a change applied as the server will (tokens still in the text are left to the server). */
function changed(todo: Todo, change: TodoChange): Todo {
  const { due, ...rest } = change
  const next: Todo = { ...todo, ...rest }
  if (due === null) delete next.due
  else if (due !== undefined) next.due = due
  if (next.description !== undefined && !next.description.trim()) delete next.description
  return next
}

/** Changing a Todo is immediate: the row shows the change before the server answers, and goes back if it fails. */
export function useUpdateTodo() {
  const queryClient = useQueryClient()
  return useMutation({
    // One edit at a time, so each goes on from the version the one before it left.
    scope: { id: 'todo-edits' },
    mutationFn: ({ todo: { id, version }, change }: { todo: Todo; change: TodoChange }) => patch<Todo>(`/todos/${id}`, change, { version }),
    onMutate: async ({ todo: { id }, change }) => {
      await queryClient.cancelQueries({ queryKey: OPEN_TODOS })
      const before = queryClient.getQueryData<Todo[]>(OPEN_TODOS)
      queryClient.setQueryData<Todo[]>(OPEN_TODOS, (todos) => todos?.map((todo) => (todo.id === id ? changed(todo, change) : todo)))
      return { before }
    },
    onError: (_error, _change, context) => queryClient.setQueryData(OPEN_TODOS, context?.before),
    onSettled: () =>
      Promise.all([queryClient.invalidateQueries({ queryKey: OPEN_TODOS }), queryClient.invalidateQueries({ queryKey: TAGS })]),
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
    mutationFn: ({ id, version }: Todo) => remove<Todo>(`/todos/${id}`, { version }),
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
