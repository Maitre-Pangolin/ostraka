// PROTOTYPE: todo list, inline editing, quick entry and filters for #10. Throw away.
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  AtSign,
  Ban,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Flag,
  GitBranch,
  Hash,
  Mail,
  MessageCircle,
  Plus,
  Search,
  SquareKanban,
  Trash2,
  X,
} from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { PEOPLE, TODAY, type Priority, type Todo } from './data'
import { dueLabel, isFiltering, mentions, parseQuickEntry, tagSlot, visibleTodos, EMPTY_FILTER, type PrioKey, type VisibleTodo } from './logic'
import { useStore } from './store'

// ---------------------------------------------------------------- small pieces

export function TagPill({ tag, active, onClick, onRemove, className }: { tag: string; active?: boolean; onClick?: () => void; onRemove?: () => void; className?: string }) {
  const c = `var(--tag-${tagSlot(tag)})`
  return (
    <span
      onClick={onClick}
      className={cn('inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[11px] font-medium leading-none', onClick && 'cursor-pointer select-none', className)}
      style={{ color: c, background: `color-mix(in oklch, ${c} ${active ? 28 : 13}%, transparent)`, boxShadow: active ? `inset 0 0 0 1px ${c}` : undefined }}
    >
      #{tag}
      {onRemove && (
        <button type="button" onClick={onRemove} className="-mr-0.5 rounded-full opacity-60 hover:opacity-100" title={`Remove #${tag}`}>
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}

const PRIO_TEXT: Record<PrioKey, string> = { high: 'text-prio-high', med: 'text-prio-med', low: 'text-prio-low', none: 'text-muted-foreground' }
const PRIO_LABEL: Record<PrioKey, string> = { high: 'High', med: 'Medium', low: 'Low', none: 'None' }
const PRIO_BORDER: Record<NonNullable<Priority>, string> = {
  high: 'border-prio-high data-checked:bg-prio-high data-checked:border-prio-high',
  med: 'border-prio-med data-checked:bg-prio-med data-checked:border-prio-med',
  low: 'border-prio-low data-checked:bg-prio-low data-checked:border-prio-low',
}

export const PrioIcon = ({ p, className }: { p: PrioKey; className?: string }) => (
  <Flag className={cn('size-3.5', p !== 'none' && 'fill-current', PRIO_TEXT[p], className)} />
)

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

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

// ---------------------------------------------------------------- people

const initials = (name: string) => name.split(' ').map((w) => w[0]).join('').slice(0, 2)

export function PersonMention({ id }: { id: string }) {
  const p = PEOPLE[id]
  if (!p) return <span className="rounded bg-muted px-1 text-muted-foreground" title="Unknown Person: add to the People directory">@{id}</span>
  const row = (icon: ReactNode, label: string, value: string) => (
    <div className="group/r flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">{icon}</span>
      <span className="w-12 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate">{value}</span>
      <button type="button" onClick={() => navigator.clipboard?.writeText(value)} className="opacity-0 group-hover/r:opacity-100" title="Copy">
        <Copy className="size-3 text-muted-foreground hover:text-foreground" />
      </button>
    </div>
  )
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={350}
        onClick={stop}
        render={<button type="button" className="rounded px-0.5 font-medium text-primary hover:bg-primary/10" />}
      >
        {p.name}
      </PopoverTrigger>
      <PopoverContent className="w-64" align="start" onClick={stop}>
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{initials(p.name)}</span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{p.name}</div>
            <div className="text-[11px] text-muted-foreground">@{p.id}</div>
          </div>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" className="flex-1">
            <MessageCircle /> Slack DM
          </Button>
          <Button size="sm" variant="outline">
            <Mail /> Email
          </Button>
        </div>
        <div className="flex flex-col gap-1">
          {row(<MessageCircle className="size-3" />, 'Slack', p.slack)}
          {row(<Mail className="size-3" />, 'Email', p.email)}
          {row(<GitBranch className="size-3" />, 'GitLab', p.gitlab)}
          {row(<SquareKanban className="size-3" />, 'Jira', p.jira)}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Renders @mentions as Person chips and URLs as short links.
export function RichText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(@[a-z0-9-]+|https?:\/\/\S+)/g)
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.startsWith('@') ? (
          <PersonMention key={i} id={p.slice(1)} />
        ) : p.startsWith('http') ? (
          <a key={i} href={p} onClick={(e) => (stop(e), e.preventDefault())} className="text-primary underline-offset-2 hover:underline">
            {p.replace(/^https?:\/\/[^/]+\//, '').replace('/-/merge_requests/', ' !')}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  )
}

// ---------------------------------------------------------------- inline pickers

function PriorityPicker({ todo }: { todo: Todo }) {
  const { update } = useStore()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        onClick={stop}
        title="Priority"
        render={<button type="button" className={cn('grid size-5 place-items-center rounded hover:bg-muted', !todo.priority && 'opacity-0 group-hover/row:opacity-100')} />}
      >
        <PrioIcon p={todo.priority ?? 'none'} />
      </PopoverTrigger>
      <PopoverContent className="w-36 gap-0.5 p-1" align="end" onClick={stop}>
        {(['high', 'med', 'low', 'none'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              update(todo.id, { priority: p === 'none' ? null : p })
              setOpen(false)
            }}
            className={cn('flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent', (todo.priority ?? 'none') === p && 'bg-accent')}
          >
            <PrioIcon p={p} /> {PRIO_LABEL[p]}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

const addDays = (n: number) => new Date(new Date(TODAY + 'T00:00:00').getTime() + n * 86_400_000).toISOString().slice(0, 10)
const nextWeekday = (wd: number) => addDays(((wd - new Date(TODAY + 'T00:00:00').getDay() + 7) % 7) || 7)

function DuePicker({ todo }: { todo: Todo }) {
  const { update } = useStore()
  const [open, setOpen] = useState(false)
  const set = (due?: string) => {
    update(todo.id, { due })
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        onClick={stop}
        title="Due date"
        render={<button type="button" className={cn('flex h-5 items-center rounded px-0.5 hover:bg-muted', !todo.due && 'opacity-0 group-hover/row:opacity-100')} />}
      >
        {todo.due ? <DueLabel due={todo.due} /> : <CalendarDays className="size-3.5 text-muted-foreground" />}
      </PopoverTrigger>
      <PopoverContent className="w-52 gap-1 p-1.5" align="end" onClick={stop}>
        <div className="grid grid-cols-2 gap-1">
          {[
            ['Today', TODAY],
            ['Tomorrow', addDays(1)],
            ['Next Monday', nextWeekday(1)],
            ['In a week', addDays(7)],
          ].map(([label, d]) => (
            <Button key={label} size="xs" variant={todo.due === d ? 'secondary' : 'ghost'} className="justify-start" onClick={() => set(d)}>
              {label}
            </Button>
          ))}
        </div>
        <input
          type="date"
          value={todo.due ?? ''}
          onChange={(e) => set(e.target.value || undefined)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        />
        {todo.due && (
          <Button size="xs" variant="ghost" className="justify-start text-muted-foreground" onClick={() => set(undefined)}>
            <X /> Clear date
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

function DropMenu({ todo }: { todo: Todo }) {
  const { drop, remove } = useStore()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        onClick={stop}
        title="Drop or delete"
        render={<button type="button" className="grid size-5 place-items-center rounded text-muted-foreground opacity-0 hover:bg-muted hover:text-destructive group-hover/row:opacity-100" />}
      >
        <Ban className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent className="w-64 gap-2" align="end" onClick={stop}>
        <div className="text-xs text-muted-foreground">Drop keeps it in Done & Dropped with a reason. Delete removes it for good (for mistakes).</div>
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              drop(todo.id, reason)
              setOpen(false)
            }
          }}
          placeholder="Reason (optional)"
          className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus:border-ring"
        />
        <div className="flex gap-1.5">
          <Button size="sm" variant="secondary" className="flex-1" onClick={() => (drop(todo.id, reason), setOpen(false))}>
            <Ban /> Drop
          </Button>
          <Button size="sm" variant="destructive" onClick={() => (remove(todo.id), setOpen(false))}>
            <Trash2 /> Delete
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------- suggestions (#tag, @person, !prio, ^date)

function suggestFor(last: string, tags: string[], exclude: string[] = []) {
  const q = last.slice(1).toLowerCase()
  if (last.startsWith('#')) return tags.filter((t) => t.startsWith(q) && t !== q && !exclude.includes(t)).map((t) => `#${t}`)
  if (last.startsWith('@')) return Object.keys(PEOPLE).filter((p) => p.startsWith(q) || PEOPLE[p].name.toLowerCase().includes(q)).map((p) => `@${p}`)
  if (last.startsWith('!')) return ['!high', '!med', '!low'].filter((p) => p.startsWith(last) && p !== last)
  if (last.startsWith('^')) return ['^today', '^tomorrow', '^mon', '^fri', '^2026-11-05'].filter((p) => p.startsWith(last) && p !== last)
  return []
}

function SuggestionList({ items, sel, onPick, footer }: { items: string[]; sel: number; onPick: (s: string) => void; footer?: ReactNode }) {
  if (!items.length && !footer) return null
  return (
    <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-lg border bg-popover p-1 shadow-md">
      {items.slice(0, 8).map((s, i) => (
        <div
          key={s}
          onMouseDown={(e) => (e.preventDefault(), onPick(s))}
          className={cn('flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 text-sm', i === sel && 'bg-accent')}
        >
          {s.startsWith('#') ? <TagPill tag={s.slice(1)} /> : <span>{s}</span>}
          {s.startsWith('@') && <span className="truncate text-xs text-muted-foreground">{PEOPLE[s.slice(1)]?.name}</span>}
          {i === sel && <kbd className="text-[10px] text-muted-foreground">Tab</kbd>}
        </div>
      ))}
      {footer}
    </div>
  )
}

// ---------------------------------------------------------------- expanded editor

function TagEditor({ todo }: { todo: Todo }) {
  const { update, tags } = useStore()
  const [value, setValue] = useState('')
  const [sel, setSel] = useState(0)
  const items = value ? suggestFor('#' + value.replace(/^#/, ''), tags, todo.tags) : []
  const addTag = (t: string) => {
    const tag = t.replace(/^#/, '').toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (tag && !todo.tags.includes(tag)) update(todo.id, { tags: [...todo.tags, tag].sort() })
    setValue('')
    setSel(0)
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {todo.tags.map((t) => (
        <TagPill key={t} tag={t} onRemove={() => update(todo.id, { tags: todo.tags.filter((x) => x !== t) })} />
      ))}
      <span className="relative">
        <input
          value={value}
          onChange={(e) => (setValue(e.target.value), setSel(0))}
          onKeyDown={(e) => {
            if ((e.key === 'Tab' || e.key === 'Enter') && items.length) {
              e.preventDefault()
              addTag(items[sel])
            } else if (e.key === 'Enter') addTag(value)
            else if (e.key === 'ArrowDown' && items.length) setSel((sel + 1) % items.length)
            else if (e.key === 'Backspace' && !value && todo.tags.length) update(todo.id, { tags: todo.tags.slice(0, -1) })
          }}
          placeholder="+ tag"
          className="h-5 w-20 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/70"
        />
        {value && (
          <span className="absolute left-0 top-full z-30 w-44">
            <SuggestionList
              items={items}
              sel={sel}
              onPick={addTag}
              footer={!items.length ? <div className="px-2 py-1 text-xs text-muted-foreground">↵ new Tag “{value.replace(/^#/, '').toLowerCase()}”</div> : undefined}
            />
          </span>
        )}
      </span>
    </div>
  )
}

function TodoEditor({ todo, depth }: { todo: Todo; depth: 0 | 1 }) {
  const { update } = useStore()
  const [desc, setDesc] = useState(todo.description ?? '')
  const [editingDesc, setEditingDesc] = useState(false)
  return (
    <div className={cn('mb-1 flex flex-col gap-1 pr-2', depth === 0 ? 'ml-12' : 'ml-[4.5rem]')}>
      {editingDesc ? (
        <textarea
          autoFocus
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => (update(todo.id, { description: desc.trim() || undefined }), setEditingDesc(false))}
          onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLTextAreaElement).blur()}
          rows={3}
          placeholder="Description, links, @mentions…"
          className="rounded-md border bg-card px-2 py-1 text-xs outline-none focus:border-ring"
        />
      ) : (
        <div
          onClick={() => setEditingDesc(true)}
          className="cursor-text whitespace-pre-line rounded-md border-l-2 border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/60"
        >
          {todo.description ? <RichText text={todo.description} /> : <span className="opacity-60">Add description…</span>}
        </div>
      )}
      {todo.dropReason && <div className="text-xs italic text-muted-foreground">Dropped: {todo.dropReason}</div>}
      <TagEditor todo={todo} />
    </div>
  )
}

// ---------------------------------------------------------------- rows

function TitleInput({ todo }: { todo: Todo }) {
  const { update } = useStore()
  const [title, setTitle] = useState(todo.title)
  return (
    <input
      value={title}
      onClick={stop}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={() => title.trim() && title !== todo.title && update(todo.id, { title: title.trim() })}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      title="Edit title (@mentions allowed)"
      className="-ml-1 h-6 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-sm outline-none hover:border-border focus:border-ring"
    />
  )
}

function TodoLine({ todo, depth, dimmed, doneCount }: { todo: Todo; depth: 0 | 1; dimmed?: boolean; doneCount?: string }) {
  const { toggleDone, openIds, toggleOpen } = useStore()
  const finished = todo.status !== 'open'
  const open = openIds.has(todo.id)
  return (
    <>
      <div
        onClick={() => toggleOpen(todo.id)}
        className={cn('group/row flex min-h-8 cursor-pointer items-center gap-2 rounded-md pr-1 hover:bg-muted/70', depth === 0 ? 'pl-0.5' : 'pl-6', dimmed && 'opacity-45')}
      >
        <span className="flex w-4 shrink-0 justify-center text-muted-foreground">
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90', !open && !todo.description && !todo.subs.length && 'opacity-0 group-hover/row:opacity-60')} />
        </span>
        <span onClick={stop} className="flex">
          {todo.status === 'dropped' ? (
            <button type="button" onClick={() => toggleDone(todo.id)} title="Reopen">
              <Ban className="size-4 text-muted-foreground" />
            </button>
          ) : (
            <Checkbox checked={todo.status === 'done'} onCheckedChange={() => toggleDone(todo.id)} className={cn('rounded-full', todo.priority && PRIO_BORDER[todo.priority])} />
          )}
        </span>
        {open && !finished ? (
          <TitleInput todo={todo} />
        ) : (
          <RichText text={todo.title} className={cn('min-w-0 flex-1 truncate text-sm', finished && 'text-muted-foreground line-through decoration-muted-foreground/50')} />
        )}
        <span className="flex shrink-0 items-center gap-1">
          {todo.description && !open && <AlignLeftIcon />}
          {doneCount && (
            <span className="flex items-center gap-0.5 text-[11px] tabular-nums text-muted-foreground">
              <ListTreeIcon />
              {doneCount}
            </span>
          )}
          {!open && (
            <>
              <span className="hidden items-center gap-1 @md:flex">
                {todo.tags.slice(0, 2).map((t) => (
                  <TagPill key={t} tag={t} />
                ))}
                {todo.tags.length > 2 && <span className="text-[11px] text-muted-foreground">+{todo.tags.length - 2}</span>}
              </span>
              <span className="flex pl-1 @md:hidden">
                {todo.tags.map((t) => (
                  <span key={t} className="-ml-0.5 size-2 rounded-full ring-2 ring-background" style={{ background: `var(--tag-${tagSlot(t)})` }} />
                ))}
              </span>
            </>
          )}
          {finished ? (
            <span className="text-[11px] text-muted-foreground">{todo.finishedAt?.slice(5)}</span>
          ) : (
            <>
              <DuePicker todo={todo} />
              <PriorityPicker todo={todo} />
              <DropMenu todo={todo} />
            </>
          )}
        </span>
      </div>
      {open && <TodoEditor todo={todo} depth={depth} />}
    </>
  )
}

const AlignLeftIcon = () => (
  <svg viewBox="0 0 24 24" className="size-3.5 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth={2} aria-label="has description">
    <path d="M15 12H3M17 18H3M21 6H3" />
  </svg>
)
const ListTreeIcon = () => (
  <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M21 12h-8M21 6H8M21 18h-8M3 6v4c0 1.1.9 2 2 2h3M3 10v6c0 1.1.9 2 2 2h3" />
  </svg>
)

function TodoItem({ v }: { v: VisibleTodo }) {
  const { add, openIds } = useStore()
  const [sub, setSub] = useState('')
  const { todo } = v
  const open = openIds.has(todo.id) || v.forceOpen
  const doneCount = todo.subs.length ? `${todo.subs.filter((s) => s.status !== 'open').length}/${todo.subs.length}` : undefined
  return (
    <div>
      <TodoLine todo={todo} depth={0} dimmed={v.dimmed} doneCount={doneCount} />
      {open && (v.subs.length > 0 || (todo.status === 'open' && !v.dimmed)) && (
        // guide line from the parent's checkbox down through its Sub-todos
        <div className="relative before:absolute before:bottom-3 before:left-[33px] before:top-0 before:w-px before:bg-muted-foreground/35">
          {v.subs.map((s) => (
            <TodoLine key={s.id} todo={s} depth={1} />
          ))}
          {todo.status === 'open' && !v.dimmed && (
        <form className="mb-1 ml-12 mr-2 flex items-center gap-1.5" onSubmit={(e) => (e.preventDefault(), add(sub, undefined, todo.id), setSub(''))}>
          <Plus className="size-3.5 text-muted-foreground" />
          <input
            value={sub}
            onChange={(e) => setSub(e.target.value)}
            placeholder="Add Sub-todo  #tag !prio ^date"
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
  const [desc, setDesc] = useState<string | null>(null)
  const [sel, setSel] = useState(0)
  const titleRef = useRef<HTMLInputElement>(null)
  const last = value.split(/\s/).pop() ?? ''
  const items = suggestFor(last, tags)
  const parsed = parseQuickEntry(value)
  const complete = (s: string) => (setValue(value.slice(0, value.length - last.length) + s + ' '), setSel(0))
  const submit = () => {
    add(value, desc ?? undefined)
    setValue('')
    setDesc(null)
    titleRef.current?.focus()
  }
  const newTag = last.startsWith('#') && last.length > 1 && !tags.some((t) => t.startsWith(last.slice(1).toLowerCase()))
  return (
    <div className={cn('relative rounded-lg border bg-card focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30', className)}>
      <input
        ref={titleRef}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => (setValue(e.target.value), setSel(0))}
        onKeyDown={(e) => {
          if (items.length && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey))) {
            e.preventDefault()
            complete(items[sel] ?? items[0])
          } else if (items.length && e.key === 'ArrowDown') {
            e.preventDefault()
            setSel((sel + 1) % items.length)
          } else if (items.length && e.key === 'ArrowUp') {
            e.preventDefault()
            setSel((sel - 1 + items.length) % items.length)
          } else if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault()
            setDesc(desc ?? '')
          } else if (e.key === 'Enter') submit()
        }}
        placeholder="Add Todo   #tag  !high  ^fri  @person"
        className="h-9 w-full bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground"
      />
      {desc !== null && (
        <textarea
          autoFocus
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), submit())
            if (e.key === 'Escape' || (e.key === 'Backspace' && !desc)) (e.preventDefault(), setDesc(null), titleRef.current?.focus())
          }}
          rows={2}
          placeholder="Description, links, @mentions…  (⇧↵ new line, ↵ add, Esc back)"
          className="block w-full resize-none border-t bg-transparent px-2.5 py-1.5 text-xs outline-none placeholder:text-muted-foreground/80"
        />
      )}
      <SuggestionList items={items} sel={sel} onPick={complete} footer={newTag ? <div className="px-2 py-1 text-xs text-muted-foreground">New Tag “{last.slice(1).toLowerCase()}” on save</div> : undefined} />
      {value && !items.length && (
        <div className="flex flex-wrap items-center gap-1.5 border-t px-2.5 py-1 text-[11px] text-muted-foreground">
          <span className="truncate">“{parsed.title || '…'}”</span>
          {parsed.priority && <PrioIcon p={parsed.priority} className="size-3" />}
          {parsed.due && <DueLabel due={parsed.due} />}
          {parsed.tags.map((t) => (
            <TagPill key={t} tag={t} />
          ))}
          <span className="ml-auto whitespace-nowrap">{desc === null ? '⇧↵ description · ↵ add' : '↵ add'}</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- filters + toolbar

type FilterKey = 'prios' | 'people' | 'tags'

function FilterPicker({ k, label, icon, options, render }: { k: FilterKey; label: string; icon: ReactNode; options: string[]; render: (v: string) => ReactNode }) {
  const { filter, setFilter } = useStore()
  const [q, setQ] = useState('')
  const selected = filter[k] as string[]
  const toggle = (v: string) => setFilter({ ...filter, [k]: selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v] })
  const shown = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()))
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn('flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground', selected.length && 'border-primary/50 bg-primary/10 text-primary')}
          />
        }
      >
        {icon}
        {label}
        {selected.length > 0 && <span className="rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">{selected.length}</span>}
        <ChevronDown className="size-3 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 gap-0 p-1">
        {options.length > 6 && (
          <div className="flex items-center gap-1.5 border-b px-2 pb-1">
            <Search className="size-3.5 text-muted-foreground" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find ${label.toLowerCase()}`} className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </div>
        )}
        {k === 'tags' && (
          <div className="flex items-center justify-between px-2 py-1 text-[11px] text-muted-foreground">
            Match
            <div className="flex rounded-md bg-muted p-0.5">
              {(['and', 'or'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setFilter({ ...filter, mode: m })} className={cn('rounded px-1.5 uppercase', filter.mode === m && 'bg-background text-foreground shadow-sm')}>
                  {m === 'and' ? 'all' : 'any'}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="max-h-64 overflow-y-auto">
          {shown.map((o) => (
            <label key={o} className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted">
              <Checkbox checked={selected.includes(o)} onCheckedChange={() => toggle(o)} />
              {render(o)}
            </label>
          ))}
          {!shown.length && <p className="px-2 py-2 text-xs text-muted-foreground">No match.</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function FilterBar({ className }: { className?: string }) {
  const { tags, filter, setFilter, todos } = useStore()
  const remove = (k: FilterKey, v: string) => setFilter({ ...filter, [k]: (filter[k] as string[]).filter((x) => x !== v) })
  const people = [...new Set(todos.flatMap((t) => [t, ...t.subs]).filter((t) => t.status === 'open').flatMap(mentions))].filter((p) => PEOPLE[p]).sort()
  const chip = (k: FilterKey, v: string, content: ReactNode) => (
    <span key={k + v} className="flex h-6 shrink-0 items-center gap-1 rounded-full bg-muted pl-2 pr-1 text-xs">
      {content}
      <button type="button" onClick={() => remove(k, v)} className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground" title="Remove filter">
        <X className="size-3" />
      </button>
    </span>
  )
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5 pb-0.5', className)}>
      <FilterPicker
        k="prios"
        label="Priority"
        icon={<Flag className="size-3.5" />}
        options={['high', 'med', 'low', 'none']}
        render={(p) => (
          <span className="flex items-center gap-1.5">
            <PrioIcon p={p as PrioKey} className="size-3.5" />
            {PRIO_LABEL[p as PrioKey]}
          </span>
        )}
      />
      <FilterPicker k="people" label="People" icon={<AtSign className="size-3.5" />} options={people} render={(p) => PEOPLE[p].name} />
      <FilterPicker k="tags" label="Tags" icon={<Hash className="size-3.5" />} options={tags} render={(t) => <TagPill tag={t} />} />
      {isFiltering(filter) && <span className="mx-0.5 h-4 w-px shrink-0 bg-border" />}
      {filter.prios.map((p) =>
        chip(
          'prios',
          p,
          <>
            <PrioIcon p={p} className="size-3" />
            {PRIO_LABEL[p]}
          </>,
        ),
      )}
      {filter.people.map((p) => chip('people', p, <>@{PEOPLE[p]?.name.split(' ')[0]}</>))}
      {filter.tags.length > 1 && <span className="text-[10px] font-semibold uppercase text-muted-foreground">{filter.mode === 'and' ? 'all of' : 'any of'}</span>}
      {filter.tags.map((t) => chip('tags', t, <span className="flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: `var(--tag-${tagSlot(t)})` }} />{t}</span>))}
      {isFiltering(filter) && (
        <button type="button" onClick={() => setFilter(EMPTY_FILTER)} className="shrink-0 px-1 text-[11px] text-muted-foreground hover:text-foreground">
          clear all
        </button>
      )}
    </div>
  )
}

export function ListToolbar({ count }: { count: number }) {
  const { expandAll, collapseAll, openIds } = useStore()
  return (
    <div className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
      <span>{count} open</span>
      <span className="flex-1" />
      <Button size="xs" variant="ghost" onClick={openIds.size ? collapseAll : expandAll} className="text-muted-foreground">
        {openIds.size ? <ChevronsDownUp /> : <ChevronsUpDown />}
        {openIds.size ? 'Collapse all' : 'Expand all'}
      </Button>
    </div>
  )
}
