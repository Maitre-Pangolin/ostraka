// Todos over the server API, as TanStack Query hooks. The server sorts; the cache holds its answer as is.
import type { DropTodo, NewTodo, SubTodo, Todo, TodoChange } from '@ostraka/core/todo-schema'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { patch, post, request } from '@/lib/api'

export type { SubTodo, Todo, TodoChange }

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

const invalidateOpenAndTags = (queryClient: QueryClient) =>
  Promise.all([queryClient.invalidateQueries({ queryKey: OPEN_TODOS }), queryClient.invalidateQueries({ queryKey: TAGS })])

export function useAddTodo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (todo: NewTodo) => post<Todo>('/todos', todo),
    onSettled: () => invalidateOpenAndTags(queryClient),
  })
}

/** Adds a Sub-todo at the end of a Todo's Sub-todos. It inherits nothing from its parent. */
export function useAddSubTodo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ parentId, ...todo }: NewTodo & { parentId: string }) => post<SubTodo>(`/todos/${parentId}/sub-todos`, todo),
    onSettled: () => invalidateOpenAndTags(queryClient),
  })
}

/**
 * A cached list with one Todo or Sub-todo edited in place, wherever it sits; `null` takes it out. `top` says whether
 * it is a Todo rather than a Sub-todo.
 */
function editItem(todos: Todo[] | undefined, id: string, edit: (item: SubTodo, top: boolean) => SubTodo | null) {
  return todos?.flatMap((todo): Todo[] => {
    if (todo.id === id) {
      const next = edit(todo, true)
      return next ? [next as Todo] : []
    }
    if (!todo.subTodos.some((sub) => sub.id === id)) return [todo]
    return [{ ...todo, subTodos: todo.subTodos.flatMap((sub) => (sub.id === id ? (edit(sub, false) ?? []) : [sub])) }]
  })
}

/** The cached item with a change applied as the server will (tokens still in the text are left to the server). */
function changed(todo: SubTodo, change: TodoChange): SubTodo {
  const { due, ...rest } = change
  const next: SubTodo = { ...todo, ...rest }
  if (due === null) delete next.due
  else if (due !== undefined) next.due = due
  if (next.description !== undefined && !next.description.trim()) delete next.description
  return next
}

/**
 * Changing a Todo or Sub-todo is immediate: the row shows the change before the server answers, and goes back if it
 * fails.
 */
export function useUpdateTodo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, change }: { id: string; change: TodoChange }) => patch<SubTodo>(`/todos/${id}`, change),
    onMutate: async ({ id, change }) => {
      await queryClient.cancelQueries({ queryKey: OPEN_TODOS })
      const before = queryClient.getQueryData<Todo[]>(OPEN_TODOS)
      queryClient.setQueryData<Todo[]>(OPEN_TODOS, (todos) => editItem(todos, id, (item) => changed(item, change)))
      return { before }
    },
    onError: (_error, _change, context) => queryClient.setQueryData(OPEN_TODOS, context?.before),
    onSettled: () => invalidateOpenAndTags(queryClient),
  })
}

type Edit = (item: SubTodo, top: boolean) => SubTodo | null

/**
 * An immediate change: the listed lists show it before the server answers, and go back if it fails. Every list
 * refetches once it settles, so a Todo lands in its place in the other list.
 */
function immediate<T>(queryClient: QueryClient, lists: (readonly string[])[], idOf: (input: T) => string, edit: Edit) {
  return {
    onMutate: async (input: T) => {
      await queryClient.cancelQueries({ queryKey: TODOS })
      const before = lists.map((key) => [key, queryClient.getQueryData<Todo[]>(key)] as const)
      for (const key of lists) queryClient.setQueryData<Todo[]>(key, (todos) => editItem(todos, idOf(input), edit))
      return { before }
    },
    onError: (_error: Error, _input: T, context?: { before: (readonly [readonly string[], Todo[] | undefined])[] }) => {
      for (const [key, todos] of context?.before ?? []) queryClient.setQueryData(key, todos)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: TODOS }),
  }
}

/** A finished Todo leaves the open list; a finished Sub-todo stays under its parent, finished. */
const finishing =
  (status: 'done' | 'dropped'): Edit =>
  (item, top) =>
    top ? null : { ...item, status }

/** Mark done; a parent's open Sub-todos are marked done with it. */
export function useCompleteTodo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => post<SubTodo>(`/todos/${id}/done`),
    ...immediate(queryClient, [OPEN_TODOS], (id: string) => id, finishing('done')),
  })
}

/** Drop with an optional reason; a blank reason counts as skipped. A parent's open Sub-todos are Dropped with it. */
export function useDropTodo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: DropTodo & { id: string }) => post<SubTodo>(`/todos/${id}/drop`, input),
    ...immediate(queryClient, [OPEN_TODOS], ({ id }: { id: string }) => id, finishing('dropped')),
  })
}

/** Delete removes the Todo or Sub-todo for good; Undo puts it back through `useRestoreTodo`. */
export function useDeleteTodo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request<SubTodo>(`/todos/${id}`, { method: 'DELETE' }),
    ...immediate(
      queryClient,
      [OPEN_TODOS, FINISHED_TODOS],
      (id: string) => id,
      () => null,
    ),
  })
}

/**
 * Undo of done or Drop, and unchecking a finished Todo or Sub-todo: it is open again. A parent brings back the
 * Sub-todos it finished.
 */
export function useReopenTodo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => post<SubTodo>(`/todos/${id}/reopen`),
    ...immediate(
      queryClient,
      [OPEN_TODOS, FINISHED_TODOS],
      (id: string) => id,
      (item, top) => {
        if (top) return null
        const { finishedAt: _finishedAt, dropReason: _dropReason, ...open } = item
        return { ...open, status: 'open' }
      },
    ),
  })
}

/** Undo of delete: the Todo, or the Sub-todo under its parent, comes back exactly as it was. */
export function useRestoreTodo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ todo, parentId }: { todo: SubTodo; parentId?: string }) =>
      parentId ? post<SubTodo>(`/todos/${parentId}/sub-todos/restore`, todo) : post<Todo>('/todos/restore', todo),
    onSettled: () => queryClient.invalidateQueries({ queryKey: TODOS }),
  })
}
