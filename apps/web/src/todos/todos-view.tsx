import { Ban, ChevronRight, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverDescription, PopoverTrigger } from '@/components/ui/popover'
import { isStale } from '@/lib/api'
import { useAfter } from '@/lib/use-after'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/shell/shell'
import {
  useCompleteTodo,
  useDeleteTodo,
  useDropTodo,
  useFinishedTodos,
  useOpenTodos,
  useReopenTodo,
  useRestoreTodo,
  useTags,
  useUpdateTodo,
  type Todo,
} from './api'
import { useToday } from './due'
import { QuickEntry } from './quick-entry'
import { TodoRow } from './todo-row'

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

const UNDO_TOAST = { duration: 5000 } as const

/**
 * A change made at once, with an Undo toast. Undo works from the Todo the server answered, so it carries the new
 * version. A failed change (say, the Todo changed elsewhere) shows in place instead, and its toast goes.
 */
function withUndo(what: string, todo: Todo, change: Promise<Todo>, undo: (changed: Todo) => void) {
  let changed: Promise<Todo | undefined> = Promise.resolve(undefined)
  const toastId = toast(what, {
    ...UNDO_TOAST,
    description: todo.title,
    action: { label: 'Undo', onClick: () => void changed.then((result) => result && undo(result)) },
  })
  changed = change.catch(() => {
    toast.dismiss(toastId)
    return undefined
  })
}

function OpenTodos() {
  const { data: todos, error, isPending } = useOpenTodos()
  const tags = useTags().data ?? []
  const complete = useCompleteTodo()
  const drop = useDropTodo()
  const remove = useDeleteTodo()
  const reopen = useReopenTodo()
  const restore = useRestoreTodo()
  const update = useUpdateTodo()
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set())
  const showSkeleton = useAfter(300, isPending)
  const today = useToday()

  if (error) return <p className="text-destructive px-1 text-sm break-words">Couldn’t load Todos: {error.message}</p>
  if (isPending) return showSkeleton ? <SkeletonRows /> : null
  if (!todos.length) return <EmptyState>No open Todos. Type one above and press ↵ to add it.</EmptyState>

  const markDone = (todo: Todo) => {
    withUndo('Todo done', todo, complete.mutateAsync(todo), (done) => reopen.mutate(done))
  }
  const markDropped = (todo: Todo, reason: string) => {
    withUndo('Todo Dropped', todo, drop.mutateAsync({ todo, reason }), (dropped) => reopen.mutate(dropped))
  }
  const deleteForGood = (todo: Todo) => {
    withUndo('Todo deleted', todo, remove.mutateAsync(todo), (deleted) => restore.mutate(deleted))
  }

  const toggle = (id: string) =>
    setOpenIds((ids) => {
      const next = new Set(ids)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const changeError = complete.error ?? drop.error ?? remove.error ?? reopen.error ?? restore.error ?? update.error
  return (
    <>
      {changeError && (
        <p className="text-destructive px-1 text-xs">
          {changeError.message}
          {isStale(changeError) && ' Showing the newer version.'}
        </p>
      )}
      <ul className="flex flex-col">
        {todos.map((todo) => (
          <TodoRow
            key={todo.id}
            todo={todo}
            open={openIds.has(todo.id)}
            onToggle={() => toggle(todo.id)}
            onDone={() => markDone(todo)}
            onChange={(change) => update.mutate({ todo, change })}
            tags={tags}
            today={today}
            actions={<DropOrDelete todo={todo} onDrop={(reason) => markDropped(todo, reason)} onDelete={() => deleteForGood(todo)} />}
          />
        ))}
      </ul>
    </>
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
          {reopen.error && (
            <p className="text-destructive px-1 text-xs">
              {reopen.error.message}
              {isStale(reopen.error) && ' Showing the newer version.'}
            </p>
          )}
          <ul className="flex flex-col">
            {todos.map((todo) => (
              <FinishedRow key={todo.id} todo={todo} onReopen={() => reopen.mutate(todo)} />
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
