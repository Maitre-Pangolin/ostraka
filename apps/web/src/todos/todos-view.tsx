import { useState } from 'react'
import { toast } from 'sonner'
import { useAfter } from '@/lib/use-after'
import { EmptyState } from '@/shell/shell'
import { useCompleteTodo, useOpenTodos, useReopenTodo, useTags, useUpdateTodo, type Todo } from './api'
import { useToday } from './due'
import { QuickEntry } from './quick-entry'
import { TodoRow } from './todo-row'

/** The Todos view: quick entry on top, open Todos below in their automatic order. */
export function TodosView() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2 p-3">
      <h1 className="sr-only">Todos</h1>
      <QuickEntry />
      <section aria-label="Open Todos">
        <OpenTodos />
      </section>
    </div>
  )
}

function OpenTodos() {
  const { data: todos, error, isPending } = useOpenTodos()
  const tags = useTags().data ?? []
  const complete = useCompleteTodo()
  const reopen = useReopenTodo()
  const update = useUpdateTodo()
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set())
  const showSkeleton = useAfter(300, isPending)
  const today = useToday()

  if (error) return <p className="text-destructive px-1 text-sm break-words">Couldn’t load Todos: {error.message}</p>
  if (isPending) return showSkeleton ? <SkeletonRows /> : null
  if (!todos.length) return <EmptyState>No open Todos. Type one above and press ↵ to add it.</EmptyState>

  const markDone = (todo: Todo) => {
    complete.mutate(todo.id)
    toast('Todo done', {
      description: todo.title,
      duration: 5000,
      action: { label: 'Undo', onClick: () => reopen.mutate(todo.id) },
    })
  }

  const toggle = (id: string) =>
    setOpenIds((ids) => {
      const next = new Set(ids)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const changeError = complete.error ?? reopen.error ?? update.error
  return (
    <>
      {changeError && <p className="text-destructive px-1 text-xs">{changeError.message}</p>}
      <ul className="flex flex-col">
        {todos.map((todo) => (
          <TodoRow
            key={todo.id}
            todo={todo}
            open={openIds.has(todo.id)}
            onToggle={() => toggle(todo.id)}
            onDone={() => markDone(todo)}
            onChange={(change) => update.mutate({ id: todo.id, change })}
            tags={tags}
            today={today}
          />
        ))}
      </ul>
    </>
  )
}

function SkeletonRows() {
  return (
    <ul aria-label="Loading Todos" className="flex flex-col">
      {[60, 45, 70].map((width) => (
        <li key={width} className="flex min-h-8 items-center gap-2 px-1.5">
          <span className="bg-muted size-4 rounded-full" />
          <span className="bg-muted h-3 rounded" style={{ width: `${width}%` }} />
        </li>
      ))}
    </ul>
  )
}
