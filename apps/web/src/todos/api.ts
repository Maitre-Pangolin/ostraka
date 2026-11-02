// Todos over the server API, as TanStack Query hooks. The server sorts; the cache holds its answer as is.
import type { NewTodo, Todo } from '@ostraka/core/todo-schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { post, request } from '@/lib/api'

export type { Todo }

const OPEN_TODOS = ['todos', 'open'] as const

export function useOpenTodos() {
  return useQuery({ queryKey: OPEN_TODOS, queryFn: () => request<Todo[]>('/todos') })
}

export function useAddTodo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (todo: NewTodo) => post<Todo>('/todos', todo),
    onSettled: () => queryClient.invalidateQueries({ queryKey: OPEN_TODOS }),
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
