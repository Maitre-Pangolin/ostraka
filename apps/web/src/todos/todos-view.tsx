import { filterTodos, isFiltering, type TodoFilter, type TodosView as ViewState } from '@ostraka/core/todo-filter'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Ban, ChevronRight, ChevronsDownUp, ChevronsUpDown, ListPlus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverDescription, PopoverTrigger } from '@/components/ui/popover'
import { FileHistory, HistoryButton } from '@/history/file-history'
import { isStale } from '@/lib/api'
import { useAfter } from '@/lib/use-after'
import { cn } from '@/lib/utils'
import { ReferenceText } from '@/references/reference-chip'
import { useSectionSearch } from '@/search/api'
import { useFindHighlight } from '@/search/find-highlight'
import { SectionSearch } from '@/search/section-search'
import { EmptyState } from '@/shell/shell'
import {
  useCompleteTodo,
  useDeleteTodo,
  useDropTodo,
  useFinishedTodos,
  useOpenTodos,
  useReopenTodo,
  useRestoreTodo,
  useTagNames,
  useUpdateTodo,
  type Todo,
  type TodoItem,
} from './api'
import { useToday } from './due'
import { expandAll, isExpandable } from './expansion'
import { TodoFilters } from './filters'
import { QuickEntry } from './quick-entry'
import { SubTodos } from './sub-todos'
import { DIMMED, SubTodoLines, TodoRow } from './todo-row'

/**
 * The Todos view: quick entry on top, the search box and the filters, open Todos below in their automatic order, Done
 * & Dropped collapsed last. The search and the filter narrow both lists and live in the URL, with the Todo opened at a
 * search match (`todo`): it opens expanded, in Done & Dropped if it is finished.
 */
export function TodosView() {
  const view = useSearch({ from: '/todos' })
  const navigate = useNavigate({ from: '/todos' })
  const { q, todo: target, ...filter } = view
  const setView = (next: ViewState) => void navigate({ search: next, replace: true })
  const setFilter = (next: TodoFilter) => setView({ ...next, q, todo: target })
  const search = useSectionSearch('todo', q)
  const lists = useFindHighlight(q)
  const [historyOpen, setHistoryOpen] = useState(false)
  if (historyOpen) {
    return (
      <div className="mx-auto flex h-full max-w-3xl flex-col p-3">
        <h1 className="sr-only">Todos</h1>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
          <FileHistory path="todos.json" onClose={() => setHistoryOpen(false)} onRestored={() => setHistoryOpen(false)} />
        </div>
      </div>
    )
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2 p-3">
      <h1 className="sr-only">Todos</h1>
      <QuickEntry />
      <div className="flex items-start gap-1.5">
        <SectionSearch value={q} onChange={(text) => setView({ ...view, q: text })} label="Search Todos" className="h-6 w-36 @md:w-48" />
        <div className="min-w-0 flex-1">
          <TodoFilters filter={filter} onChange={setFilter} />
        </div>
        <HistoryButton open={false} onClick={() => setHistoryOpen(true)} />
      </div>
      {search.indexing && <p className="text-muted-foreground px-1 text-xs">Indexing…</p>}
      {search.error && <p className="text-destructive px-1 text-xs">{search.error.message}</p>}
      <div ref={lists} className="flex flex-col gap-2">
        <section aria-label="Open Todos">
          <OpenTodos filter={filter} found={search.found} target={target} />
        </section>
        <FinishedTodos filter={filter} found={search.found} target={target} />
      </div>
    </div>
  )
}

const UNDO_TOAST = { duration: 5000 } as const

/**
 * A change made at once, with an Undo toast. Undo works from the item the server answered, so it carries the new
 * version. A failed change (say, the item changed elsewhere) shows in place instead, and its toast goes.
 */
function withUndo<T extends TodoItem>(what: string, item: TodoItem, change: Promise<T>, undo: (changed: T) => void) {
  let changed: Promise<T | undefined> = Promise.resolve(undefined)
  const toastId = toast(what, {
    ...UNDO_TOAST,
    description: item.title,
    action: { label: 'Undo', onClick: () => void changed.then((result) => result && undo(result)) },
  })
  changed = change.catch(() => {
    toast.dismiss(toastId)
    return undefined
  })
}

type Finish = { status: 'done' | 'dropped'; reason?: string }

/** Finishing a parent with open Sub-todos waits for this confirmation. */
type PendingFinish = Finish & { todo: Todo; openSubTodos: number }

const toggled = (ids: ReadonlySet<string>, id: string, on?: boolean) => {
  const next = new Set(ids)
  if (on ?? !next.has(id)) next.add(id)
  else next.delete(id)
  return next
}

/** Scrolls the row of the Todo opened at a search match into view once it shows, once for each Todo. */
function useScrollToTodo(target: string | undefined) {
  const done = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!target || done.current === target) return
    const frame = requestAnimationFrame(() => {
      const row = document.querySelector(`[data-todo="${CSS.escape(target)}"]`)
      if (!row) return
      done.current = target
      row.scrollIntoView({ block: 'center' })
    })
    return () => cancelAnimationFrame(frame)
  })
}

/** The Todo holding `id`: itself, or the parent of the Sub-todo it is. */
const holderOf = (todos: Todo[] | undefined, id: string | undefined) =>
  id === undefined ? undefined : todos?.find((todo) => todo.id === id || todo.subTodos.some((sub) => sub.id === id))

/** Narrowed by the filter and, with `found`, by what the search box found. `target` is the Todo opened at a match. */
type ListProps = { filter: TodoFilter; found: ReadonlySet<string> | undefined; target: string | undefined }

function OpenTodos({ filter, found, target }: ListProps) {
  const { data: todos, error, isPending } = useOpenTodos()
  const tags = useTagNames()
  const complete = useCompleteTodo()
  const drop = useDropTodo()
  const remove = useDeleteTodo()
  const reopen = useReopenTodo()
  const restore = useRestoreTodo()
  const update = useUpdateTodo()
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set())
  // Todos showing the entry for a new Sub-todo, asked for from their Add a Sub-todo action.
  const [adding, setAdding] = useState<ReadonlySet<string>>(new Set())
  // Parents whose last open Sub-todo was just finished: they offer to be marked done.
  const [offers, setOffers] = useState<ReadonlySet<string>>(new Set())
  const [pending, setPending] = useState<PendingFinish | null>(null)
  const showSkeleton = useAfter(300, isPending)
  const today = useToday()
  // The Todo opened at a search match opens expanded (its parent, for a Sub-todo), once.
  const holder = holderOf(todos, target)
  const [expandedFor, setExpandedFor] = useState<string>()
  if (holder && expandedFor !== target) {
    setExpandedFor(target)
    setOpenIds(toggled(openIds, holder.id, true))
  }
  useScrollToTodo(holder && target)

  if (error) return <p className="text-destructive px-1 text-sm break-words">Couldn’t load Todos: {error.message}</p>
  if (isPending) return showSkeleton ? <SkeletonRows /> : null
  if (!todos.length) return <EmptyState>No open Todos. Type one above and press ↵ to add it.</EmptyState>
  const filtering = isFiltering(filter) || found !== undefined
  const shown = filterTodos(todos, filter, found)
  if (!shown.length)
    return (
      <EmptyState>
        {found
          ? 'No open Todos match this search and these filters. Try fewer or shorter words, or clear the filters.'
          : 'No open Todos match these filters. Remove one, or clear all.'}
      </EmptyState>
    )

  /** Done or Drop at once, with Undo. Finishing the last open Sub-todo makes its parent offer to be marked done. */
  const finishNow = (item: TodoItem, { status, reason }: Finish, parent?: Todo) => {
    const what = `${parent ? 'Sub-todo' : 'Todo'} ${status === 'done' ? 'done' : 'Dropped'}`
    const change = status === 'done' ? complete.mutateAsync(item) : drop.mutateAsync({ todo: item, reason })
    withUndo(what, item, change, (finished) => reopen.mutate(finished))
    if (parent?.subTodos.every((sub) => sub.id === item.id || sub.status !== 'open')) setOffers((ids) => toggled(ids, parent.id, true))
  }
  /** A parent with open Sub-todos asks first, since they are finished with it. */
  const finish = (item: TodoItem, how: Finish, parent?: Todo) => {
    const openSubTodos = 'subTodos' in item ? item.subTodos.filter((sub) => sub.status === 'open').length : 0
    if ('subTodos' in item && openSubTodos > 0) setPending({ ...how, todo: item, openSubTodos })
    else finishNow(item, how, parent)
  }
  const deleteForGood = (item: TodoItem, parent?: Todo) => {
    withUndo(`${parent ? 'Sub-todo' : 'Todo'} deleted`, item, remove.mutateAsync(item), (deleted) =>
      restore.mutate({ todo: deleted, parentId: parent?.id }),
    )
  }

  const row = (
    item: TodoItem,
    { parent, warning, dimmed, children }: { parent?: Todo; warning?: string; dimmed?: boolean; children?: ReactNode },
  ) => (
    <TodoRow
      key={item.id}
      todo={item}
      dimmed={dimmed}
      open={openIds.has(item.id)}
      onOpenChange={(open) => {
        setOpenIds((ids) => toggled(ids, item.id, open))
        if (!open) setAdding((ids) => toggled(ids, item.id, false))
      }}
      adding={adding.has(item.id)}
      onDone={() => finish(item, { status: 'done' }, parent)}
      onChange={(change) => update.mutate({ todo: item, change })}
      tags={tags}
      today={today}
      warning={warning}
      actions={
        <>
          {/* Sub-todos are one level deep: only Todos get the action; Sub-todos keep its place, lining up dates and flags. */}
          {parent ? (
            <span aria-hidden className="size-6 shrink-0" />
          ) : (
            <AddSubTodo
              todo={item}
              onClick={() => {
                setOpenIds((ids) => toggled(ids, item.id, true))
                setAdding((ids) => toggled(ids, item.id, true))
              }}
            />
          )}
          <DropOrDelete
            todo={item}
            onDrop={(reason) => finish(item, { status: 'dropped', reason }, parent)}
            onDelete={() => deleteForGood(item, parent)}
          />
        </>
      }
    >
      {children}
    </TodoRow>
  )

  /**
   * Under an expanded Todo: all its Sub-todos, and the entry for a new one once asked for. While filtering, the
   * Sub-todos the filter matched show even when it is collapsed.
   */
  const subTodosOf = (todo: Todo, matchedIds: ReadonlySet<string>) => {
    const entry = adding.has(todo.id)
    const expanded = entry || (openIds.has(todo.id) && isExpandable(todo))
    const matched = todo.subTodos.filter((sub) => matchedIds.has(sub.id))
    if (!expanded && !(filtering && matched.length)) return undefined
    const dismissOffer = () => setOffers((ids) => toggled(ids, todo.id, false))
    return (
      <SubTodos
        parent={todo}
        shown={filtering ? matched : todo.subTodos}
        entry={entry}
        onEntryClose={() => setAdding((ids) => toggled(ids, todo.id, false))}
        tags={tags}
        today={today}
        renderOpen={(sub, warning) => row(sub, { parent: todo, warning })}
        onReopen={(sub) => reopen.mutate(sub)}
        offer={
          offers.has(todo.id)
            ? {
                onAccept: () => {
                  dismissOffer()
                  finishNow(todo, { status: 'done' })
                },
                onDismiss: dismissOffer,
              }
            : undefined
        }
      />
    )
  }

  const changeError = complete.error ?? drop.error ?? remove.error ?? reopen.error ?? restore.error ?? update.error
  const all = expandAll(
    shown.map(({ todo }) => todo),
    openIds,
  )
  return (
    <>
      {all && (
        <div className="flex items-center justify-end">
          <Button
            size="xs"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => {
              setOpenIds(all.next)
              if (!all.next.size) setAdding(new Set())
            }}
          >
            {all.next.size ? <ChevronsUpDown /> : <ChevronsDownUp />}
            {all.label}
          </Button>
        </div>
      )}
      {changeError && (
        <p className="text-destructive px-1 text-xs">
          {changeError.message}
          {isStale(changeError) && ' Showing the newer version.'}
        </p>
      )}
      <ul className="flex flex-col">
        {shown.map(({ todo, dimmed, subTodos }) =>
          row(todo, { dimmed, children: subTodosOf(todo, new Set(subTodos.map((sub) => sub.id))) }),
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

const ROW_ACTION =
  'text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 aria-expanded:bg-muted grid size-6 shrink-0 place-items-center rounded-md opacity-0 outline-none group-hover/row:opacity-100 focus-visible:opacity-100 focus-visible:ring-3 aria-expanded:opacity-100'

/** The row's Add a Sub-todo action: expands the Todo and opens the Sub-todo entry under it, focused. */
function AddSubTodo({ todo, onClick }: { todo: TodoItem; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={`Add a Sub-todo to “${todo.title}”`} title="Add a Sub-todo" className={ROW_ACTION}>
      <ListPlus className="size-3.5" />
    </button>
  )
}

/** The row's Drop or delete Popover: an optional reason, ↵ or Drop to Drop it, Delete to remove a mistake. */
function DropOrDelete({ todo, onDrop, onDelete }: { todo: TodoItem; onDrop: (reason: string) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')

  const act = (action: () => void) => {
    action()
    setOpen(false)
    setReason('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label={`Drop or delete “${todo.title}”`} className={ROW_ACTION}>
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
function FinishedTodos({ filter, found, target }: ListProps) {
  const [expanded, setExpanded] = useState(false)
  const { data: todos, error } = useFinishedTodos()
  const reopen = useReopenTodo()
  const today = useToday()
  // A finished Todo opened at a search match opens Done & Dropped and shows itself opened, once.
  const holder = holderOf(todos, target)
  const [expandedFor, setExpandedFor] = useState<string>()
  if (holder && expandedFor !== target) {
    setExpandedFor(target)
    setExpanded(true)
  }
  useScrollToTodo(holder && expanded ? target : undefined)

  if (error) return <p className="text-destructive px-1 text-sm break-words">Couldn’t load Done & Dropped: {error.message}</p>
  const filtering = isFiltering(filter) || found !== undefined
  const shown = filterTodos(todos ?? [], filter, found)
  if (!shown.length) return null

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
        <span className="tabular-nums">{shown.length}</span>
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
            {shown.map(({ todo, dimmed, subTodos }) => {
              const opened = todo.id === holder?.id
              return (
                <FinishedRow key={todo.id} todo={todo} dimmed={dimmed} open={opened} onReopen={() => reopen.mutate(todo)}>
                  {/* Opened at a match: its Sub-todos show too, where the match may be. */}
                  {(filtering || opened) && <SubTodoLines subTodos={filtering ? subTodos : todo.subTodos} today={today} />}
                </FinishedRow>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}

const finishedDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

function FinishedRow({
  todo,
  dimmed,
  open,
  onReopen,
  children,
}: {
  todo: Todo
  dimmed: boolean
  /** Opened at a search match: its description shows under it. */
  open?: boolean
  onReopen: () => void
  children?: ReactNode
}) {
  const dropped = todo.status === 'dropped'
  return (
    <li data-todo={todo.id} className="flex flex-col">
      <div className={cn('hover:bg-muted/70 flex min-h-8 items-center gap-2 rounded-md px-1.5', dimmed && DIMMED)}>
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
          <ReferenceText text={todo.title} />
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
      </div>
      {open && todo.description && (
        <p className="text-muted-foreground mb-1 ml-8 text-sm break-words whitespace-pre-wrap">
          <ReferenceText text={todo.description} />
        </p>
      )}
      {children}
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
