// Todos over the server API, as TanStack Query hooks. The server sorts; the cache holds its answer as is.
import type { NewTodo, Todo, TodoChange } from '@ostraka/core/todo-schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { patch, post, request } from '@/lib/api'

export type { Todo, TodoChange }

const OPEN_TODOS = ['todos', 'open'] as const
const TAGS = ['tags'] as const

export function useOpenTodos() {
  return useQuery({ queryKey: OPEN_TODOS, queryFn: () => request<Todo[]>('/todos') })
}

/** The Tags in use, for `#` suggestions. */
export function useTags() {
  return useQuery({ queryKey: TAGS, queryFn: () => request<string[]>('/tags') })
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
    mutationFn: ({ id, change }: { id: string; change: TodoChange }) => patch<Todo>(`/todos/${id}`, change),
    onMutate: async ({ id, change }) => {
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

/** Marking done is immediate: the Todo leaves the list before the server answers, and comes back if it fails. */
export function useCompleteTodo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => post<Todo>(`/todos/${id}/done`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: OPEN_TODOS })
      const before = queryClient.getQueryData<Todo[]>(OPEN_TODOS)
      queryClient.setQueryData<Todo[]>(OPEN_TODOS, (todos) => todos?.filter((todo) => todo.id !== id))
      return { before }
    },
    onError: (_error, _id, context) => queryClient.setQueryData(OPEN_TODOS, context?.before),
    onSettled: () => queryClient.invalidateQueries({ queryKey: OPEN_TODOS }),
  })
}

/** Undo of done: the Todo is open again and the list refetches to put it back in its place. */
export function useReopenTodo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => post<Todo>(`/todos/${id}/reopen`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: OPEN_TODOS }),
  })
}
