// PROTOTYPE: in-memory todo store for #10. Throw away.
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { INITIAL_TODOS, NOTES, TODAY, type Doc, type Todo } from './data'
import { allTags, EMPTY_FILTER, parseQuickEntry, type Filter } from './logic'

type Ask = { title: string; body: string; yes: string; no: string; onYes: () => void; onNo?: () => void }

type Store = {
  todos: Todo[]
  tags: string[]
  add: (input: string, description?: string, parentId?: string) => void
  update: (id: string, patch: Partial<Todo>) => void
  toggleDone: (id: string) => void
  drop: (id: string, reason?: string) => void
  remove: (id: string) => void
  openIds: Set<string>
  toggleOpen: (id: string) => void
  expandAll: () => void
  collapseAll: () => void
  filter: Filter
  setFilter: (f: Filter) => void
  notes: Doc[]
  setNotes: (fn: (ns: Doc[]) => Doc[]) => void
}

const StoreCtx = createContext<Store | null>(null)
export const useStore = () => useContext(StoreCtx)!

let nextId = 1000
const mapTodos = (todos: Todo[], id: string, fn: (t: Todo) => Todo): Todo[] =>
  todos.map((t) => (t.id === id ? fn(t) : { ...t, subs: mapTodos(t.subs, id, fn) }))
const removeTodo = (todos: Todo[], id: string): Todo[] =>
  todos.filter((t) => t.id !== id).map((t) => ({ ...t, subs: removeTodo(t.subs, id) }))
export const findTodo = (todos: Todo[], id: string): Todo | undefined => todos.flatMap((t) => [t, ...t.subs]).find((t) => t.id === id)
const parentOf = (todos: Todo[], id: string) => todos.find((t) => t.subs.some((s) => s.id === id))

export function StoreProvider({ children }: { children: ReactNode }) {
  const [todos, setTodos] = useState(INITIAL_TODOS)
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState(NOTES)
  const [ask, setAsk] = useState<Ask | null>(null)

  const finish = (ts: Todo[], id: string) =>
    mapTodos(ts, id, (x) => ({
      ...x,
      status: 'done',
      finishedAt: TODAY,
      subs: x.subs.map((s) => (s.status === 'open' ? { ...s, status: 'done', finishedAt: TODAY } : s)),
    }))

  const offerParent = (next: Todo[], id: string) => {
    const parent = parentOf(next, id)
    if (parent?.status === 'open' && parent.subs.every((s) => s.status !== 'open'))
      setAsk({
        title: 'All Sub-todos are finished',
        body: `Mark “${parent.title}” as done too?`,
        yes: 'Finish parent',
        no: 'Keep it open',
        onYes: () => setTodos((ts) => finish(ts, parent.id)),
      })
  }

  const store: Store = {
    todos,
    tags: useMemo(() => allTags(todos), [todos]),
    filter,
    setFilter,
    notes,
    setNotes,
    openIds,
    toggleOpen: (id) =>
      setOpenIds((s) => {
        const n = new Set(s)
        if (n.has(id)) n.delete(id)
        else n.add(id)
        return n
      }),
    expandAll: () => setOpenIds(new Set(todos.flatMap((t) => [t.id, ...t.subs.map((s) => s.id)]))),
    collapseAll: () => setOpenIds(new Set()),
    add(input, description, parentId) {
      const p = parseQuickEntry(input)
      if (!p.title) return
      const todo: Todo = { id: `n${nextId++}`, ...p, description: description?.trim() || undefined, status: 'open', createdAt: `${TODAY}T${nextId}`, subs: [] }
      setTodos((ts) => (parentId ? mapTodos(ts, parentId, (t) => ({ ...t, subs: [...t.subs, todo] })) : [todo, ...ts]))
    },
    update: (id, patch) => setTodos((ts) => mapTodos(ts, id, (x) => ({ ...x, ...patch }))),
    toggleDone(id) {
      const t = findTodo(todos, id)!
      if (t.status !== 'open') {
        setTodos((ts) => mapTodos(ts, id, (x) => ({ ...x, status: 'open', finishedAt: undefined, dropReason: undefined })))
        return
      }
      const openSubs = t.subs.filter((s) => s.status === 'open').length
      if (openSubs)
        return setAsk({
          title: 'Finish with open Sub-todos?',
          body: `“${t.title}” still has ${openSubs} open Sub-todo${openSubs > 1 ? 's' : ''}. They will be marked done too.`,
          yes: 'Finish all',
          no: 'Cancel',
          onYes: () => setTodos((ts) => finish(ts, id)),
        })
      const next = finish(todos, id)
      setTodos(next)
      offerParent(next, id)
    },
    drop(id, reason) {
      const next = mapTodos(todos, id, (x) => ({ ...x, status: 'dropped', dropReason: reason || undefined, finishedAt: TODAY }))
      setTodos(next)
      offerParent(next, id)
    },
    remove: (id) => setTodos((ts) => removeTodo(ts, id)),
  }

  return (
    <StoreCtx.Provider value={store}>
      {children}
      <Dialog open={!!ask} onOpenChange={(o) => !o && setAsk(null)}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>{ask?.title}</DialogTitle>
          <DialogDescription>{ask?.body}</DialogDescription>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAsk(null)}>
              {ask?.no}
            </Button>
            <Button
              autoFocus
              onClick={() => {
                ask?.onYes()
                setAsk(null)
              }}
            >
              {ask?.yes}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StoreCtx.Provider>
  )
}
