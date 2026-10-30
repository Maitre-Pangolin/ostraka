// PROTOTYPE: building blocks shared by the layout variants for #10. Throw away.
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  AlignLeft,
  Ban,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  Flag,
  GitMerge,
  ListTree,
  Loader,
  MessageSquare,
  NotebookPen,
  Plus,
} from 'lucide-react'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { INITIAL_TODOS, MRS, PEOPLE, SPRINT, TODAY, type MR, type Priority, type Todo } from './data'
import { allTags, dueLabel, parseQuickEntry, tagSlot, visibleTodos, type TagFilter, type VisibleTodo } from './logic'

// ---------------------------------------------------------------- state

type Store = {
  todos: Todo[]
  add: (title: string, parentId?: string) => void
  toggleDone: (id: string) => void
  drop: (id: string) => void
  filter: TagFilter
  setFilter: (f: TagFilter) => void
  notes: { title: string; tags: string[]; path: string }[]
  addNote: (body: string, tags: string[]) => void
  tags: string[]
}

const StoreCtx = createContext<Store | null>(null)
export const useStore = () => useContext(StoreCtx)!

let nextId = 1000
const mapTodos = (todos: Todo[], id: string, fn: (t: Todo) => Todo): Todo[] =>
  todos.map((t) => (t.id === id ? fn(t) : { ...t, subs: mapTodos(t.subs, id, fn) }))
const findTodo = (todos: Todo[], id: string): Todo | undefined =>
  todos.flatMap((t) => [t, ...t.subs]).find((t) => t.id === id)
const parentOf = (todos: Todo[], id: string) => todos.find((t) => t.subs.some((s) => s.id === id))

export function StoreProvider({ children }: { children: ReactNode }) {
  const [todos, setTodos] = useState(INITIAL_TODOS)
  const [filter, setFilter] = useState<TagFilter>({ tags: [], mode: 'and' })
  const [notes, setNotes] = useState<Store['notes']>([])

  const store: Store = {
    todos,
    filter,
    setFilter,
    notes,
    tags: useMemo(() => allTags(todos), [todos]),
    add(input, parentId) {
      const p = parseQuickEntry(input)
      if (!p.title) return
      const todo: Todo = { id: `n${nextId++}`, ...p, status: 'open', createdAt: TODAY + 'T' + nextId, subs: [] }
      setTodos((ts) => (parentId ? mapTodos(ts, parentId, (t) => ({ ...t, subs: [...t.subs, todo] })) : [todo, ...ts]))
    },
    toggleDone(id) {
      const t = findTodo(todos, id)!
      const finishing = t.status === 'open'
      const openSubs = t.subs.filter((s) => s.status === 'open')
      if (finishing && openSubs.length && !confirm(`Finish "${t.title}" and its ${openSubs.length} open Sub-todo(s)?`)) return
      const status = finishing ? ('done' as const) : ('open' as const)
      let next = mapTodos(todos, id, (x) => ({
        ...x,
        status,
        finishedAt: finishing ? TODAY : undefined,
        subs: finishing ? x.subs.map((s) => (s.status === 'open' ? { ...s, status, finishedAt: TODAY } : s)) : x.subs,
      }))
      const parent = parentOf(next, id)
      if (finishing && parent?.status === 'open' && parent.subs.every((s) => s.status !== 'open')) {
        if (confirm(`That was the last Sub-todo. Finish "${parent.title}" too?`))
          next = mapTodos(next, parent.id, (x) => ({ ...x, status: 'done', finishedAt: TODAY }))
      }
      setTodos(next)
    },
    drop(id) {
      const reason = prompt('Drop this Todo. Reason (optional):')
      if (reason === null) return
      setTodos((ts) => mapTodos(ts, id, (x) => ({ ...x, status: 'dropped', dropReason: reason || undefined, finishedAt: TODAY })))
    },
    addNote(body, tags) {
      const title = body.split('\n')[0].slice(0, 60) || 'Untitled'
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      setNotes((ns) => [{ title, tags, path: `notes/${TODAY}-${slug}.md` }, ...ns])
    },
  }
  return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>
}

// ---------------------------------------------------------------- small pieces

export function TagPill({ tag, active, onClick, className }: { tag: string; active?: boolean; onClick?: () => void; className?: string }) {
  const c = `var(--tag-${tagSlot(tag)})`
  return (
    <span
      onClick={onClick}
      className={cn('inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] font-medium leading-none', onClick && 'cursor-pointer select-none', className)}
      style={{
        color: c,
        background: `color-mix(in oklch, ${c} ${active ? 28 : 13}%, transparent)`,
        boxShadow: active ? `inset 0 0 0 1px ${c}` : undefined,
      }}
    >
      #{tag}
    </span>
  )
}

const PRIO_CLASS: Record<NonNullable<Priority>, string> = {
  high: 'text-prio-high',
  med: 'text-prio-med',
  low: 'text-prio-low',
}
const PRIO_BORDER: Record<NonNullable<Priority>, string> = {
  high: 'border-prio-high data-checked:bg-prio-high data-checked:border-prio-high',
  med: 'border-prio-med data-checked:bg-prio-med data-checked:border-prio-med',
  low: 'border-prio-low data-checked:bg-prio-low data-checked:border-prio-low',
}

export function DueLabel({ due, className }: { due: string; className?: string }) {
  const { text, tone } = dueLabel(due)
  return (
    <span
      className={cn(
        'shrink-0 text-[11px] tabular-nums',
        tone === 'overdue' && 'font-semibold text-destructive',
        tone === 'today' && 'font-semibold text-today',
        tone === 'soon' && 'text-foreground/70',
        tone === 'later' && 'text-muted-foreground',
        className,
      )}
    >
      {text}
    </span>
  )
}

// Renders @mentions as Person chips and URLs as short links.
export function RichText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(@[a-z0-9-]+|https?:\/\/\S+)/g)
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.startsWith('@') && PEOPLE[p.slice(1)] ? (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              alert(`Contact window for ${PEOPLE[p.slice(1)]} (Slack DM, email, GitLab, Jira) — see #15`)
            }}
            className="rounded px-0.5 font-medium text-primary hover:bg-primary/10"
          >
            {PEOPLE[p.slice(1)]}
          </button>
        ) : p.startsWith('http') ? (
          <a key={i} href={p} onClick={(e) => e.preventDefault()} className="text-primary underline-offset-2 hover:underline">
            {p.replace(/^https?:\/\/[^/]+\//, '').replace('/-/merge_requests/', ' !')}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  )
}

// ---------------------------------------------------------------- todo rows

function TodoLine({
  todo,
  depth,
  dimmed,
  open,
  onToggleOpen,
  expandable,
  doneCount,
}: {
  todo: Todo
  depth: 0 | 1
  dimmed?: boolean
  open?: boolean
  onToggleOpen?: () => void
  expandable?: boolean
  doneCount?: string
}) {
  const { toggleDone, drop } = useStore()
  const finished = todo.status !== 'open'
  return (
    <div
      onClick={expandable ? onToggleOpen : undefined}
      className={cn(
        'group/row flex min-h-8 items-center gap-2 rounded-md pr-1.5 hover:bg-muted/70',
        depth === 0 ? 'pl-0.5' : 'pl-6',
        expandable && 'cursor-pointer',
        dimmed && 'opacity-45',
      )}
    >
      <span className="flex w-4 shrink-0 justify-center text-muted-foreground">
        {expandable && <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />}
      </span>
      <span onClick={(e) => e.stopPropagation()} className="flex">
        {todo.status === 'dropped' ? (
          <Ban className="size-4 text-muted-foreground" />
        ) : (
          <Checkbox
            checked={todo.status === 'done'}
            onCheckedChange={() => toggleDone(todo.id)}
            className={cn('rounded-full', todo.priority && PRIO_BORDER[todo.priority])}
          />
        )}
      </span>
      <RichText
        text={todo.title}
        className={cn('min-w-0 flex-1 truncate text-sm', finished && 'text-muted-foreground line-through decoration-muted-foreground/50')}
      />
      {/* indicators */}
      <span className="flex shrink-0 items-center gap-1.5">
        {todo.description && <AlignLeft className="size-3.5 text-muted-foreground" aria-label="has description" />}
        {doneCount && (
          <span className="flex items-center gap-0.5 text-[11px] tabular-nums text-muted-foreground">
            <ListTree className="size-3.5" />
            {doneCount}
          </span>
        )}
        <span className="hidden items-center gap-1 @md:flex">
          {todo.tags.slice(0, 2).map((t) => (
            <TagPill key={t} tag={t} />
          ))}
          {todo.tags.length > 2 && <span className="text-[11px] text-muted-foreground">+{todo.tags.length - 2}</span>}
        </span>
        <span className="flex @md:hidden">
          {todo.tags.map((t) => (
            <span key={t} className="-ml-0.5 size-2 rounded-full ring-2 ring-background" style={{ background: `var(--tag-${tagSlot(t)})` }} />
          ))}
        </span>
        {todo.due && !finished && <DueLabel due={todo.due} />}
        {todo.priority && !finished && <Flag className={cn('size-3.5 fill-current', PRIO_CLASS[todo.priority])} />}
        {finished && todo.finishedAt && <span className="text-[11px] text-muted-foreground">{todo.finishedAt.slice(5)}</span>}
        {!finished && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              drop(todo.id)
            }}
            title="Drop"
            className="hidden text-muted-foreground hover:text-destructive group-hover/row:block"
          >
            <CircleX className="size-3.5" />
          </button>
        )}
      </span>
    </div>
  )
}

function TodoItem({ v }: { v: VisibleTodo }) {
  const { add } = useStore()
  const [open, setOpen] = useState(false)
  const [sub, setSub] = useState('')
  const { todo } = v
  const isOpen = open || v.forceOpen
  const expandable = !!todo.description || todo.subs.length > 0 || todo.status === 'open'
  const doneCount = todo.subs.length ? `${todo.subs.filter((s) => s.status !== 'open').length}/${todo.subs.length}` : undefined
  return (
    <div>
      <TodoLine todo={todo} depth={0} dimmed={v.dimmed} open={isOpen} onToggleOpen={() => setOpen(!open)} expandable={expandable} doneCount={doneCount} />
      {isOpen && (
        <div className="mb-1">
          {todo.description && (
            <div className="mb-1 ml-12 mr-2 whitespace-pre-line rounded-md border-l-2 border-border py-0.5 pl-2 text-xs text-muted-foreground">
              <RichText text={todo.description} />
            </div>
          )}
          {todo.dropReason && <div className="mb-1 ml-12 text-xs italic text-muted-foreground">Dropped: {todo.dropReason}</div>}
          {todo.tags.length > 0 && (
            <div className="mb-1 ml-12 flex flex-wrap gap-1 @md:hidden">
              {todo.tags.map((t) => (
                <TagPill key={t} tag={t} />
              ))}
            </div>
          )}
          {v.subs.map((s) => (
            <TodoLine key={s.id} todo={s} depth={1} />
          ))}
          {todo.status === 'open' && !v.dimmed && (
            <form
              className="ml-12 mr-2 flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                add(sub, todo.id)
                setSub('')
              }}
            >
              <Plus className="size-3.5 text-muted-foreground" />
              <input
                value={sub}
                onChange={(e) => setSub(e.target.value)}
                placeholder="Add Sub-todo"
                className="h-7 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
              />
            </form>
          )}
        </div>
      )}
    </div>
  )
}

export function TodoList({ statuses = ['open'], empty }: { statuses?: Todo['status'][]; empty?: string }) {
  const { todos, filter } = useStore()
  const items = visibleTodos(todos, filter, statuses)
  if (!items.length) return <p className="px-2 py-6 text-center text-sm text-muted-foreground">{empty ?? 'Nothing here.'}</p>
  return (
    <div className="flex flex-col">
      {items.map((v) => (
        <TodoItem key={v.todo.id} v={v} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- quick entry

export function QuickEntry({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const { add, tags } = useStore()
  const [value, setValue] = useState('')
  const [sel, setSel] = useState(0)
  const last = value.split(/\s/).pop() ?? ''
  const suggestions =
    last.startsWith('#') ? tags.filter((t) => t.startsWith(last.slice(1).toLowerCase()) && t !== last.slice(1)).map((t) => `#${t}`)
    : last.startsWith('@') ? Object.keys(PEOPLE).filter((p) => p.startsWith(last.slice(1).toLowerCase())).map((p) => `@${p}`)
    : last.startsWith('!') ? ['!high', '!med', '!low'].filter((p) => p.startsWith(last) && p !== last)
    : last.startsWith('^') ? ['^today', '^tomorrow', '^mon', '^fri', '^2026-11-05'].filter((p) => p.startsWith(last) && p !== last)
    : []
  const parsed = parseQuickEntry(value)
  const complete = (s: string) => {
    setValue(value.slice(0, value.length - last.length) + s + ' ')
    setSel(0)
  }
  return (
    <div className={cn('relative', className)}>
      <Input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setSel(0)
        }}
        onKeyDown={(e) => {
          if (suggestions.length && (e.key === 'Tab' || e.key === 'Enter')) {
            e.preventDefault()
            complete(suggestions[sel] ?? suggestions[0])
          } else if (suggestions.length && e.key === 'ArrowDown') {
            e.preventDefault()
            setSel((sel + 1) % suggestions.length)
          } else if (suggestions.length && e.key === 'ArrowUp') {
            e.preventDefault()
            setSel((sel - 1 + suggestions.length) % suggestions.length)
          } else if (e.key === 'Enter') {
            add(value)
            setValue('')
          }
        }}
        placeholder="Add Todo   #tag  !high  ^fri  @person"
        className="h-9 bg-card"
      />
      {suggestions.length > 0 && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-lg border bg-popover p-1 shadow-md">
          {suggestions.slice(0, 8).map((s, i) => (
            <div
              key={s}
              onMouseDown={(e) => {
                e.preventDefault()
                complete(s)
              }}
              className={cn('flex cursor-pointer items-center justify-between rounded-md px-2 py-1 text-sm', i === sel && 'bg-accent')}
            >
              {s.startsWith('#') ? <TagPill tag={s.slice(1)} /> : <span>{s}</span>}
              {s.startsWith('@') && <span className="text-xs text-muted-foreground">{PEOPLE[s.slice(1)]}</span>}
              {i === sel && <kbd className="text-[10px] text-muted-foreground">Tab</kbd>}
            </div>
          ))}
          {last.startsWith('#') && last.length > 1 && !tags.some((t) => t.startsWith(last.slice(1).toLowerCase())) && (
            <div className="px-2 py-1 text-xs text-muted-foreground">New Tag “{last.slice(1).toLowerCase()}” on save</div>
          )}
        </div>
      )}
      {value && (parsed.tags.length > 0 || parsed.priority || parsed.due) && suggestions.length === 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
          <span className="truncate">“{parsed.title || '…'}”</span>
          {parsed.priority && <Flag className={cn('size-3 fill-current', PRIO_CLASS[parsed.priority])} />}
          {parsed.due && <DueLabel due={parsed.due} />}
          {parsed.tags.map((t) => (
            <TagPill key={t} tag={t} />
          ))}
          <span className="ml-auto">↵ to add</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- tag filter

export function TagFilterBar({ className }: { className?: string }) {
  const { tags, filter, setFilter } = useStore()
  const toggle = (t: string) =>
    setFilter({ ...filter, tags: filter.tags.includes(t) ? filter.tags.filter((x) => x !== t) : [...filter.tags, t] })
  return (
    <div className={cn('flex items-center gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none]', className)}>
      {filter.tags.length > 1 && (
        <button
          type="button"
          onClick={() => setFilter({ ...filter, mode: filter.mode === 'and' ? 'or' : 'and' })}
          className="h-5 shrink-0 rounded-full border px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
          title="Match all selected Tags (AND) or any (OR)"
        >
          {filter.mode}
        </button>
      )}
      {tags.map((t) => (
        <TagPill key={t} tag={t} active={filter.tags.includes(t)} onClick={() => toggle(t)} className={cn(filter.tags.length > 0 && !filter.tags.includes(t) && 'opacity-55')} />
      ))}
      {filter.tags.length > 0 && (
        <button type="button" onClick={() => setFilter({ tags: [], mode: 'and' })} className="shrink-0 px-1 text-[11px] text-muted-foreground hover:text-foreground">
          clear
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- note capture

export function NoteCapture({ compact, onSaved }: { compact?: boolean; onSaved?: () => void }) {
  const { addNote, notes } = useStore()
  const [body, setBody] = useState('')
  const [tagText, setTagText] = useState('')
  const save = () => {
    if (!body.trim()) return
    addNote(body, tagText.split(/[\s,#]+/).filter(Boolean).map((t) => t.toLowerCase()))
    setBody('')
    setTagText('')
    onSaved?.()
  }
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
        }}
        placeholder="Jot a Note or an Idea… (first line becomes the title, ⌘↵ to save)"
        className={cn('resize-none bg-card text-sm', compact ? 'min-h-20' : 'min-h-40')}
      />
      <div className="flex items-center gap-2">
        <input
          value={tagText}
          onChange={(e) => setTagText(e.target.value)}
          placeholder="#tags (idea, ostraka…)"
          className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
        />
        <Button size="sm" onClick={save} disabled={!body.trim()}>
          <NotebookPen /> Save Note
        </Button>
      </div>
      {notes.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {notes.slice(0, 3).map((n) => (
            <li key={n.path} className="flex items-center gap-1.5 truncate">
              <CircleCheck className="size-3 text-primary" />
              <span className="truncate">{n.path}</span>
              {n.tags.map((t) => (
                <TagPill key={t} tag={t} />
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- work overview

const PIPE = {
  passed: <CircleCheck className="size-3.5 text-[var(--tag-3)]" />,
  failed: <CircleX className="size-3.5 text-destructive" />,
  running: <Loader className="size-3.5 animate-spin text-[var(--tag-5)]" />,
}

function MRRow({ mr }: { mr: MR }) {
  const ready = mr.approvals.split('/')[0] === mr.approvals.split('/')[1] && mr.pipeline === 'passed'
  return (
    <div className="flex min-h-8 items-center gap-2 rounded-md px-1.5 text-sm hover:bg-muted/70">
      {PIPE[mr.pipeline]}
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">!{mr.iid}</span>
      <span className="min-w-0 flex-1 truncate">{mr.title}</span>
      {mr.role === 'review' && <span className="hidden shrink-0 text-xs text-muted-foreground @md:inline">{PEOPLE[mr.author]?.split(' ')[0]}</span>}
      {mr.threads > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
          <MessageSquare className="size-3" />
          {mr.threads}
        </span>
      )}
      {ready ? (
        <Badge className="h-4 px-1.5 text-[10px]">
          <GitMerge /> ready
        </Badge>
      ) : (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{mr.approvals}</span>
      )}
      <span className="w-7 shrink-0 text-right text-[11px] text-muted-foreground">{mr.updated}</span>
    </div>
  )
}

export function MRList() {
  const groups = [
    { title: 'To review', items: MRS.filter((m) => m.role === 'review') },
    { title: 'Mine', items: MRS.filter((m) => m.role === 'mine') },
  ]
  return (
    <div className="flex flex-col gap-2">
      {groups.map((g) => (
        <div key={g.title}>
          <SectionLabel>
            {g.title} <span className="font-normal">{g.items.length}</span>
          </SectionLabel>
          {g.items.map((m) => (
            <MRRow key={m.iid} mr={m} />
          ))}
        </div>
      ))}
    </div>
  )
}

const STATUS_ICON = {
  todo: <CircleDashed className="size-3.5 text-muted-foreground" />,
  doing: <Loader className="size-3.5 text-[var(--tag-5)]" />,
  review: <GitMerge className="size-3.5 text-[var(--tag-6)]" />,
  done: <CircleCheck className="size-3.5 text-[var(--tag-3)]" />,
}

export function SprintSummary() {
  const pct = Math.round((SPRINT.teamDone / SPRINT.teamTotal) * 100)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 px-1.5">
        <span className="text-sm font-medium">{SPRINT.name}</span>
        <span className="text-xs text-muted-foreground">
          <span className="font-semibold text-today">{SPRINT.daysLeft} days left</span> · ends Tue 3 Nov
        </span>
      </div>
      <div className="mx-1.5 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          team {SPRINT.teamDone}/{SPRINT.teamTotal}
        </span>
      </div>
      <div>
        <SectionLabel>Mine</SectionLabel>
        {SPRINT.mine.map((i) => (
          <div key={i.key} className="flex min-h-7 items-center gap-2 rounded-md px-1.5 text-sm hover:bg-muted/70">
            {STATUS_ICON[i.status]}
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{i.key}</span>
            <span className={cn('min-w-0 flex-1 truncate', i.status === 'done' && 'text-muted-foreground line-through')}>{i.title}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-1.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground', className)}>{children}</div>
}

export const workCounts = () => ({
  toReview: MRS.filter((m) => m.role === 'review').length,
  failing: MRS.filter((m) => m.role === 'mine' && m.pipeline === 'failed').length,
  ready: MRS.filter((m) => m.role === 'mine' && m.pipeline === 'passed' && m.approvals.split('/')[0] === m.approvals.split('/')[1]).length,
})

export const openCount = (todos: Todo[]) => todos.filter((t) => t.status === 'open').length
export const overdueCount = (todos: Todo[]) => todos.filter((t) => t.status === 'open' && t.due && dueLabel(t.due).tone === 'overdue').length
