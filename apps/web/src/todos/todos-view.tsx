import { Ban, ChevronRight, CornerDownLeft, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverDescription, PopoverTrigger } from '@/components/ui/popover'
import { useAfter } from '@/lib/use-after'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/shell/shell'
import {
  useAddTodo,
  useCompleteTodo,
  useDeleteTodo,
  useDropTodo,
  useFinishedTodos,
  useOpenTodos,
  useReopenTodo,
  useRestoreTodo,
  type Todo,
} from './api'

/** The Todos view: quick entry on top, open Todos below in their automatic order, Done & Dropped collapsed last. */
export function TodosView() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2 p-3">
      <h1 className="sr-only">Todos</h1>
      <QuickEntry />
      <section aria-label="Open Todos">
        <OpenTodos />
      </section>
      <FinishedTodos />
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

const UNDO_TOAST = { duration: 5000 } as const

function OpenTodos() {
  const { data: todos, error, isPending } = useOpenTodos()
  const complete = useCompleteTodo()
  const drop = useDropTodo()
  const remove = useDeleteTodo()
  const reopen = useReopenTodo()
  const restore = useRestoreTodo()
  const showSkeleton = useAfter(300, isPending)

  if (error) return <p className="text-destructive px-1 text-sm break-words">Couldn’t load Todos: {error.message}</p>
  if (isPending) return showSkeleton ? <SkeletonRows /> : null
  if (!todos.length) return <EmptyState>No open Todos. Type one above and press ↵ to add it.</EmptyState>

  const markDone = (todo: Todo) => {
    complete.mutate(todo.id)
    toast('Todo done', { ...UNDO_TOAST, description: todo.title, action: { label: 'Undo', onClick: () => reopen.mutate(todo.id) } })
  }
  const markDropped = (todo: Todo, reason: string) => {
    drop.mutate({ id: todo.id, reason })
    toast('Todo Dropped', { ...UNDO_TOAST, description: todo.title, action: { label: 'Undo', onClick: () => reopen.mutate(todo.id) } })
  }
  const deleteForGood = (todo: Todo) => {
    remove.mutate(todo.id)
    toast('Todo deleted', { ...UNDO_TOAST, description: todo.title, action: { label: 'Undo', onClick: () => restore.mutate(todo) } })
  }

  const changeError = complete.error ?? drop.error ?? remove.error ?? reopen.error ?? restore.error
  return (
    <>
      {changeError && <p className="text-destructive px-1 text-xs">{changeError.message}</p>}
      <ul className="flex flex-col">
        {todos.map((todo) => (
          <TodoRow
            key={todo.id}
            todo={todo}
            onDone={() => markDone(todo)}
            onDrop={(reason) => markDropped(todo, reason)}
            onDelete={() => deleteForGood(todo)}
          />
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

type TodoRowProps = { todo: Todo; onDone: () => void; onDrop: (reason: string) => void; onDelete: () => void }

function TodoRow({ todo, onDone, onDrop, onDelete }: TodoRowProps) {
  return (
    <li className="group/row hover:bg-muted/70 flex min-h-8 items-center gap-2 rounded-md px-1.5">
      <Checkbox
        checked={false}
        onCheckedChange={onDone}
        aria-label={`Mark “${todo.title}” done`}
        className={cn('rounded-full', PRIORITY_RING[todo.priority])}
      />
      <span className="min-w-0 flex-1 truncate text-sm">{todo.title}</span>
      <DropOrDelete todo={todo} onDrop={onDrop} onDelete={onDelete} />
    </li>
  )
}

/** The row's Drop or delete Popover: an optional reason, ↵ or Drop to Drop it, Delete to remove a mistake. */
function DropOrDelete({ todo, onDrop, onDelete }: { todo: Todo; onDrop: (reason: string) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')

  const act = (action: () => void) => {
    action()
    setOpen(false)
    setReason('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Drop or delete “${todo.title}”`}
        className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 aria-expanded:bg-muted grid size-6 shrink-0 place-items-center rounded-md opacity-0 outline-none group-hover/row:opacity-100 focus-visible:opacity-100 focus-visible:ring-3 aria-expanded:opacity-100"
      >
        <Ban className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-2">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            act(() => onDrop(reason))
          }}
          className="flex flex-col gap-2"
        >
          <PopoverDescription className="text-xs">Drop keeps it in Done & Dropped. Delete removes it for good.</PopoverDescription>
          <Input
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-label="Reason for dropping"
            placeholder="Reason (optional)"
          />
          <div className="flex gap-1.5">
            <Button type="submit" size="sm" variant="secondary" className="flex-1">
              <Ban /> Drop
            </Button>
            <Button type="button" size="sm" variant="destructive" onClick={() => act(onDelete)}>
              <Trash2 /> Delete
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

/** Done and Dropped Todos, kept forever: collapsed under the open list, newest-finished first when shown. */
function FinishedTodos() {
  const [expanded, setExpanded] = useState(false)
  const { data: todos, error } = useFinishedTodos()
  const reopen = useReopenTodo()

  if (error) return <p className="text-destructive px-1 text-sm break-words">Couldn’t load Done & Dropped: {error.message}</p>
  if (!todos?.length) return null

  return (
    <section aria-label="Done & Dropped" className="flex flex-col pt-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex h-7 items-center gap-1 self-start rounded-md px-1 text-xs font-medium outline-none focus-visible:ring-3"
      >
        <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
        Done & Dropped
        <span className="tabular-nums">{todos.length}</span>
      </button>
      {expanded && (
        <>
          {reopen.error && <p className="text-destructive px-1 text-xs">{reopen.error.message}</p>}
          <ul className="flex flex-col">
            {todos.map((todo) => (
              <FinishedRow key={todo.id} todo={todo} onReopen={() => reopen.mutate(todo.id)} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

const finishedDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

function FinishedRow({ todo, onReopen }: { todo: Todo; onReopen: () => void }) {
  const dropped = todo.status === 'dropped'
  return (
    <li className="hover:bg-muted/70 flex min-h-8 items-center gap-2 rounded-md px-1.5">
      {dropped ? (
        <button
          type="button"
          onClick={onReopen}
          aria-label={`Reopen “${todo.title}”`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 grid size-4 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-3"
        >
          <Ban className="size-4" />
        </button>
      ) : (
        <Checkbox checked onCheckedChange={onReopen} aria-label={`Reopen “${todo.title}”`} className="rounded-full" />
      )}
      <span className="text-muted-foreground decoration-muted-foreground/50 min-w-0 flex-1 truncate text-sm line-through">
        {todo.title}
      </span>
      {dropped && (
        <span className="text-muted-foreground hidden max-w-[40%] truncate text-xs @md:block" title={todo.dropReason}>
          {todo.dropReason ? `Dropped: ${todo.dropReason}` : 'Dropped'}
        </span>
      )}
      {todo.finishedAt && (
        <time dateTime={todo.finishedAt} className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {finishedDay(todo.finishedAt)}
        </time>
      )}
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
