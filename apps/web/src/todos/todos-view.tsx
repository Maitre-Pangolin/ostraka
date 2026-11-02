import { Ban, ChevronRight, ChevronsDownUp, ChevronsUpDown, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverDescription, PopoverTrigger } from '@/components/ui/popover'
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
  type SubTodo,
  type Todo,
} from './api'
import { useToday } from './due'
import { QuickEntry } from './quick-entry'
import { SubTodos } from './sub-todos'
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

type Finish = { status: 'done' | 'dropped'; reason?: string }

/** Finishing a parent with open Sub-todos waits for this confirmation. */
type PendingFinish = Finish & { todo: Todo; openSubTodos: number }

const toggled = (ids: ReadonlySet<string>, id: string, on?: boolean) => {
  const next = new Set(ids)
  if (on ?? !next.has(id)) next.add(id)
  else next.delete(id)
  return next
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
  // Parents whose last open Sub-todo was just finished: they offer to be marked done.
  const [offers, setOffers] = useState<ReadonlySet<string>>(new Set())
  const [pending, setPending] = useState<PendingFinish | null>(null)
  const showSkeleton = useAfter(300, isPending)
  const today = useToday()

  if (error) return <p className="text-destructive px-1 text-sm break-words">Couldn’t load Todos: {error.message}</p>
  if (isPending) return showSkeleton ? <SkeletonRows /> : null
  if (!todos.length) return <EmptyState>No open Todos. Type one above and press ↵ to add it.</EmptyState>

  /** Done or Drop at once, with Undo. Finishing the last open Sub-todo makes its parent offer to be marked done. */
  const finishNow = (item: SubTodo, { status, reason }: Finish, parent?: Todo) => {
    if (status === 'done') complete.mutate(item.id)
    else drop.mutate({ id: item.id, reason })
    const what = `${parent ? 'Sub-todo' : 'Todo'} ${status === 'done' ? 'done' : 'Dropped'}`
    toast(what, { ...UNDO_TOAST, description: item.title, action: { label: 'Undo', onClick: () => reopen.mutate(item.id) } })
    if (parent?.subTodos.every((sub) => sub.id === item.id || sub.status !== 'open')) setOffers((ids) => toggled(ids, parent.id, true))
  }
  /** A parent with open Sub-todos asks first, since they are finished with it. */
  const finish = (item: SubTodo | Todo, how: Finish, parent?: Todo) => {
    const openSubTodos = 'subTodos' in item ? item.subTodos.filter((sub) => sub.status === 'open').length : 0
    if ('subTodos' in item && openSubTodos > 0) setPending({ ...how, todo: item, openSubTodos })
    else finishNow(item, how, parent)
  }
  const deleteForGood = (item: SubTodo | Todo, parent?: Todo) => {
    remove.mutate(item.id)
    toast(parent ? 'Sub-todo deleted' : 'Todo deleted', {
      ...UNDO_TOAST,
      description: item.title,
      action: { label: 'Undo', onClick: () => restore.mutate({ todo: item, parentId: parent?.id }) },
    })
  }

  const row = (item: SubTodo | Todo, parent?: Todo, warning?: string, children?: ReactNode) => (
    <TodoRow
      key={item.id}
      todo={item}
      open={openIds.has(item.id)}
      onToggle={() => setOpenIds((ids) => toggled(ids, item.id))}
      onDone={() => finish(item, { status: 'done' }, parent)}
      onChange={(change) => update.mutate({ id: item.id, change })}
      tags={tags}
      today={today}
      warning={warning}
      actions={
        <DropOrDelete
          todo={item}
          onDrop={(reason) => finish(item, { status: 'dropped', reason }, parent)}
          onDelete={() => deleteForGood(item, parent)}
        />
      }
    >
      {children}
    </TodoRow>
  )

  const dismissOffer = (id: string) => setOffers((ids) => toggled(ids, id, false))
  const changeError = complete.error ?? drop.error ?? remove.error ?? reopen.error ?? restore.error ?? update.error
  return (
    <>
      <div className="flex items-center justify-end">
        <Button
          size="xs"
          variant="ghost"
          className="text-muted-foreground"
          onClick={() => setOpenIds(openIds.size ? new Set() : new Set(todos.map((todo) => todo.id)))}
        >
          {openIds.size ? <ChevronsDownUp /> : <ChevronsUpDown />}
          {openIds.size ? 'Collapse all' : 'Expand all'}
        </Button>
      </div>
      {changeError && <p className="text-destructive px-1 text-xs">{changeError.message}</p>}
      <ul className="flex flex-col">
        {todos.map((todo) =>
          row(
            todo,
            undefined,
            undefined,
            <SubTodos
              parent={todo}
              tags={tags}
              today={today}
              renderOpen={(sub, warning) => row(sub, todo, warning)}
              onReopen={(sub) => reopen.mutate(sub.id)}
              offer={
                offers.has(todo.id)
                  ? {
                      onAccept: () => {
                        dismissOffer(todo.id)
                        finishNow(todo, { status: 'done' })
                      },
                      onDismiss: () => dismissOffer(todo.id),
                    }
                  : undefined
              }
            />,
          ),
        )}
      </ul>
      <FinishParentDialog
        pending={pending}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) finishNow(pending.todo, pending)
          setPending(null)
        }}
      />
    </>
  )
}

/** Confirms finishing a parent together with its open Sub-todos. */
function FinishParentDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingFinish | null
  onCancel: () => void
  onConfirm: () => void
}) {
  // Kept while the Dialog closes, so its text doesn't vanish mid-animation.
  const [shown, setShown] = useState(pending)
  if (pending && pending !== shown) setShown(pending)
  const done = shown?.status === 'done'
  const count = shown?.openSubTodos ?? 0
  const subTodos = count === 1 ? '1 open Sub-todo' : `${count} open Sub-todos`
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{done ? 'Mark done with its Sub-todos?' : 'Drop with its Sub-todos?'}</DialogTitle>
          <DialogDescription>
            “{shown?.todo.title}” has {subTodos}, {done ? 'to be marked done' : 'to be Dropped'} with it. Undo reopens them together.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button autoFocus onClick={onConfirm}>
            {done ? 'Mark all done' : 'Drop all'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The row's Drop or delete Popover: an optional reason, ↵ or Drop to Drop it, Delete to remove a mistake. */
function DropOrDelete({ todo, onDrop, onDelete }: { todo: SubTodo; onDrop: (reason: string) => void; onDelete: () => void }) {
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
