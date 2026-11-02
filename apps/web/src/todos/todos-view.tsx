import { CornerDownLeft } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { useAfter } from '@/lib/use-after'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/shell/shell'
import { useAddTodo, useCompleteTodo, useOpenTodos, useReopenTodo, type Todo } from './api'

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

/** Type a title, ↵ adds it. The field clears at once so the next Todo can follow; a failed add puts the text back. */
function QuickEntry() {
  const [title, setTitle] = useState('')
  const add = useAddTodo()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const typed = title.trim()
    if (!typed) return
    setTitle('')
    add.mutate({ title: typed }, { onError: () => setTitle((current) => current || typed) })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1">
      <div className="bg-card focus-within:border-ring focus-within:ring-ring/50 flex h-9 items-center gap-2 rounded-lg border px-2.5 focus-within:ring-3">
        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="New Todo"
          placeholder="Add a Todo"
          className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        {title.trim() && <CornerDownLeft aria-hidden className="text-muted-foreground size-3.5 shrink-0" />}
      </div>
      {add.error && <p className="text-destructive px-1 text-xs">Couldn’t add the Todo: {add.error.message}</p>}
    </form>
  )
}

function OpenTodos() {
  const { data: todos, error, isPending } = useOpenTodos()
  const complete = useCompleteTodo()
  const reopen = useReopenTodo()
  const showSkeleton = useAfter(300, isPending)

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

  const changeError = complete.error ?? reopen.error
  return (
    <>
      {changeError && <p className="text-destructive px-1 text-xs">{changeError.message}</p>}
      <ul className="flex flex-col">
        {todos.map((todo) => (
          <TodoRow key={todo.id} todo={todo} onDone={() => markDone(todo)} />
        ))}
      </ul>
    </>
  )
}

const PRIORITY_RING: Record<Todo['priority'], string> = {
  high: 'border-prio-high',
  medium: 'border-prio-med',
  low: 'border-prio-low',
  none: '',
}

function TodoRow({ todo, onDone }: { todo: Todo; onDone: () => void }) {
  return (
    <li className="hover:bg-muted/70 flex min-h-8 items-center gap-2 rounded-md px-1.5">
      <Checkbox
        checked={false}
        onCheckedChange={onDone}
        aria-label={`Mark “${todo.title}” done`}
        className={cn('rounded-full', PRIORITY_RING[todo.priority])}
      />
      <span className="min-w-0 flex-1 truncate text-sm">{todo.title}</span>
    </li>
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
