// The Dev logs view: the list by month and week (each month's summary on top), beside what is open: one day or
// summary, read-only until Edit, or a date range stacked by day with a Tag filter. All of it lives in the URL.
import {
  addDays,
  devlogDays,
  devlogList,
  devlogRangePresets,
  devlogSectionProblems,
  filterDevlogDays,
  type DevlogDay,
  type DevlogsView as ViewState,
} from '@ostraka/core/devlog-days'
import { isBrokenDevlog, type DevlogSummary } from '@ostraka/core/devlog-schema'
import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  ArrowLeft,
  CalendarPlus,
  CalendarRange,
  ChevronDown,
  Eye,
  Hash,
  Palmtree,
  Pencil,
  Sparkles,
  Square,
  SquareCheck,
  TriangleAlert,
} from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import type { DateRange } from 'react-day-picker'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { FileHistory, HistoryButton } from '@/history/file-history'
import { ApiError } from '@/lib/api'
import { useAfter } from '@/lib/use-after'
import { MentionChip } from '@/people/mention-chip'
import { PeoplePicker, PersonFilterChips } from '@/people/people-filter'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/shell/shell'
import { dayToDate, localDay, useToday } from '@/todos/due'
import { ActiveChip, FilterPicker, MatchToggle } from '@/todos/filters'
import { TagDot, TagPill } from '@/todos/properties'
import { useDevlog, useDevlogDays, useDevlogs, useTodoTitles, type BrokenDevlog, type Devlog, type DevlogListing } from './api'
import { DevlogEditor, SaveStatus, type DevlogEditorHandle, type SaveState } from './devlog-editor'
import { MarkdownView, type TodoLinkRenderer } from './markdown-view'

const focusRing = 'outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

const toggled = (values: string[] = [], value: string) =>
  values.includes(value) ? values.filter((other) => other !== value) : [...values, value]

/** How the skill is run, shown on a day without a Dev log. */
const SKILL_COMMAND = '/devlog'

const dayLabel = (day: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  dayToDate(day).toLocaleDateString('en-GB', options)
const longDay = (day: string) => dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const monthLabel = (month: string) => dayToDate(`${month}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
const rangeLabel = (from: string, to: string) =>
  `${dayLabel(from, { day: 'numeric', month: 'short' })} – ${dayLabel(to, { day: 'numeric', month: 'short', year: 'numeric' })}`

export function DevlogsView() {
  const view = useSearch({ from: '/devlogs' })
  const navigate = useNavigate({ from: '/devlogs' })
  const setView = (next: ViewState) => void navigate({ search: next, replace: true })
  const range = view.from && view.to ? { from: view.from, to: view.to } : undefined
  const open = view.log !== undefined || range !== undefined
  return (
    <div className="flex h-full min-h-0">
      <section
        aria-label="Dev logs"
        className={cn('min-h-0 w-full shrink-0 flex-col overflow-y-auto border-r @3xl:flex @3xl:w-72', open ? 'hidden' : 'flex')}
      >
        <DevlogsList view={view} onView={setView} />
      </section>
      <section className={cn('min-h-0 min-w-0 flex-1 flex-col', open ? 'flex' : 'hidden @3xl:flex')}>
        {open && (
          <button
            type="button"
            onClick={() => setView({})}
            className={cn(
              'text-muted-foreground hover:text-foreground flex h-8 shrink-0 items-center gap-1 border-b px-2 text-xs @3xl:hidden',
              focusRing,
            )}
          >
            <ArrowLeft className="size-3.5" /> All Dev logs
          </button>
        )}
        {view.log ? (
          <DevlogDetail key={view.log} id={view.log} />
        ) : range ? (
          <RangeView view={{ ...view, ...range }} onView={setView} />
        ) : (
          <EmptyState>Pick a day or a week on the left, or choose dates.</EmptyState>
        )}
      </section>
    </div>
  )
}

function DevlogsList({ view, onView }: { view: ViewState; onView: (view: ViewState) => void }) {
  const logs = useDevlogs()
  const today = useToday()
  const slow = useAfter(300, logs.isPending)
  const months = logs.data ? devlogList(logs.data, today) : []
  const isWeek = (start: string) => view.from === start && view.to === addDays(start, 6)
  const openWeek = (start: string) => onView({ from: start, to: addDays(start, 6) })
  return (
    <>
      <div className="bg-background sticky top-0 z-10 flex h-10 shrink-0 items-center gap-1.5 border-b px-2">
        <RangePicker view={view} today={today} onView={onView} />
      </div>
      {logs.error && <p className="text-destructive px-3 py-2 text-sm">{logs.error.message}</p>}
      {slow && <SkeletonRows />}
      {logs.data && !months.length && <EmptyState>No Dev logs yet. Run the Dev log skill to write today's.</EmptyState>}
      {months.map((month) => (
        <div key={month.month} role="group" aria-label={monthLabel(month.month)}>
          <h2 className="text-foreground bg-background border-b px-3 py-1.5 text-xs font-semibold">{monthLabel(month.month)}</h2>
          {month.summary && (
            <SummaryRow summary={month.summary} active={view.log === month.month} onOpen={() => onView({ log: month.month })} />
          )}
          {month.weeks.map((week) => (
            <div key={week.start}>
              <button
                type="button"
                onClick={() => openWeek(week.start)}
                aria-current={isWeek(week.start) || undefined}
                className={cn(
                  'bg-muted/40 text-muted-foreground hover:text-foreground flex w-full items-center gap-1 px-3 py-1 text-left text-[11px] font-semibold tracking-wide uppercase',
                  focusRing,
                  isWeek(week.start) && 'bg-accent text-foreground',
                )}
              >
                Week of {dayLabel(week.start, { day: 'numeric', month: 'short' })}
              </button>
              <ul className="flex flex-col">
                {week.days.map((day) => (
                  <li key={day.date}>
                    <DayRow day={day} today={today} active={view.log === day.date} onOpen={() => onView({ log: day.date })} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

function SummaryRow({ summary, active, onOpen }: { summary: DevlogListing; active: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active || undefined}
      className={cn(
        'hover:bg-muted/60 flex w-full min-w-0 items-center gap-1.5 border-b px-3 py-2 text-left text-sm',
        focusRing,
        active && 'bg-accent',
      )}
    >
      {isBrokenDevlog(summary) ? (
        <BrokenLine log={summary} />
      ) : (
        <>
          <Sparkles aria-hidden className="text-primary size-3.5 shrink-0" />
          <span className="truncate font-medium">Monthly summary</span>
        </>
      )}
    </button>
  )
}

function BrokenLine({ log }: { log: BrokenDevlog }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
        <TriangleAlert aria-hidden className="text-destructive size-3.5 shrink-0" />
        <span className="truncate font-mono">devlogs/{log.id}.md</span>
      </span>
      <span className="text-destructive line-clamp-2 text-xs">{log.error}</span>
    </span>
  )
}

/** A day in the list: its Dev log's Tags, its off-day label, or the hint to write it. */
function DayRow({ day, today, active, onOpen }: { day: DevlogDay; today: string; active: boolean; onOpen: () => void }) {
  const { log } = day
  if (!log) return <MissingDay date={day.date} today={today} className="border-b px-3 py-2" />
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active || undefined}
      className={cn(
        'hover:bg-muted/60 flex w-full min-w-0 items-center gap-2 border-b px-3 py-2 text-left',
        focusRing,
        active && 'bg-accent',
      )}
    >
      {isBrokenDevlog(log) ? (
        <BrokenLine log={log} />
      ) : (
        <>
          <span className={cn('w-24 shrink-0 text-sm font-medium whitespace-nowrap', log.off && 'text-muted-foreground')}>
            {dayLabel(day.date)}
          </span>
          {log.off ? (
            <OffLabel log={log} />
          ) : (
            <span className="flex min-w-0 items-center gap-1 overflow-hidden">
              {log.tags.map((tag) => (
                <span key={tag} className="contents">
                  <TagPill tag={tag} className="hidden h-4 text-[10px] @md:inline-flex" />
                  <TagDot tag={tag} className="@md:hidden" />
                </span>
              ))}
            </span>
          )}
        </>
      )}
    </button>
  )
}

function OffLabel({ log }: { log: DevlogSummary }) {
  return (
    <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
      <Palmtree aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{log.label ?? 'Off day'}</span>
    </span>
  )
}

/** A weekday nobody wrote up: the hint to run the Dev log skill. */
function MissingDay({ date, today, className, heading }: { date: string; today: string; className?: string; heading?: boolean }) {
  const hint = date === today ? 'Write it with the Dev log skill' : 'Backfill it with the Dev log skill'
  return (
    <div title={hint} className={cn('text-muted-foreground flex min-w-0 items-center gap-2 text-xs', className)}>
      {heading ? (
        <span className="text-foreground flex shrink-0 items-center gap-2 text-sm font-medium">
          <CalendarPlus aria-hidden className="text-muted-foreground size-3.5" />
          {longDay(date)}
        </span>
      ) : (
        <span className="w-24 shrink-0 text-sm whitespace-nowrap">{dayLabel(date)}</span>
      )}
      <span className="min-w-0 flex-1 truncate">
        {date === today ? 'No Dev log yet' : 'No Dev log'}
        <span className={heading ? 'sr-only @md:not-sr-only' : 'sr-only'}>. {hint}:</span>
      </span>
      <code className="bg-muted text-foreground shrink-0 rounded px-1 font-mono text-[10px]">{SKILL_COMMAND}</code>
    </div>
  )
}

/** The date range: presets, then a calendar to pick from and to. */
function RangePicker({ view, today, onView }: { view: ViewState; today: string; onView: (view: ViewState) => void }) {
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState<DateRange>()
  const chosen = view.from && view.to ? { from: view.from, to: view.to } : undefined
  const show = (from: string, to: string) => {
    onView({
      from,
      to,
      ...(view.tag && { tag: view.tag }),
      ...(view.match && { match: view.match }),
      ...(view.person && { person: view.person }),
    })
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={(next) => (setOpen(next), setPicking(undefined))}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              'text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted flex h-6 min-w-0 items-center gap-1 rounded-full border px-2 text-xs',
              focusRing,
              chosen && 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
            )}
          />
        }
      >
        <CalendarRange aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{chosen ? rangeLabel(chosen.from, chosen.to) : 'Dates'}</span>
        <ChevronDown aria-hidden className="size-3 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto gap-1.5 p-1.5">
        <div className="grid grid-cols-2 gap-1">
          {devlogRangePresets(today).map(({ label, from, to }) => (
            <Button
              key={label}
              size="xs"
              variant={chosen?.from === from && chosen.to === to ? 'secondary' : 'ghost'}
              className="justify-start"
              onClick={() => show(from, to)}
            >
              {label}
            </Button>
          ))}
        </div>
        <Calendar
          mode="range"
          selected={picking ?? (chosen && { from: dayToDate(chosen.from), to: dayToDate(chosen.to) })}
          defaultMonth={dayToDate(chosen?.from ?? today)}
          onSelect={(_range, day) => {
            // The first click picks from, the second to.
            if (!picking?.from) return setPicking({ from: day, to: undefined })
            const [from, to] = [localDay(picking.from), localDay(day)].toSorted()
            show(from!, to!)
          }}
          weekStartsOn={1}
          className="p-0"
        />
        <p className="text-muted-foreground px-1 text-[11px]">
          {picking?.from ? 'Now pick the last day.' : 'Pick the first day, then the last.'}
        </p>
      </PopoverContent>
    </Popover>
  )
}

/** A Todo link in a Dev log: the Todo's current title, done or open, whatever text the file stored. */
function useTodoLink(): TodoLinkRenderer {
  const { titles, ready } = useTodoTitles()
  return (id, storedText) => {
    const todo = titles.get(id)
    const Icon = todo?.finished ? SquareCheck : Square
    return (
      <span
        title={todo ? `Todo ${id}` : ready ? `No Todo ${id} any more` : undefined}
        className={cn('bg-muted inline-flex max-w-full items-baseline gap-1 rounded px-1', !todo && ready && 'text-muted-foreground')}
      >
        <Icon aria-hidden className="size-3 shrink-0 self-center" />
        <span className={cn(!todo && ready && 'line-through')}>{todo?.title ?? storedText}</span>
      </span>
    )
  }
}

/** One day or monthly summary: rendered read-only, with Edit switching to the editor. */
function DevlogDetail({ id }: { id: string }) {
  const query = useDevlog(id)
  const today = useToday()
  const todoLink = useTodoLink()
  const [editing, setEditing] = useState(false)
  const [state, setState] = useState<SaveState>('saved')
  const [error, setError] = useState<string>()
  const [historyOpen, setHistoryOpen] = useState(false)
  const editor = useRef<DevlogEditorHandle | null>(null)

  if (query.error) {
    const missing = query.error instanceof ApiError && query.error.status === 404
    return (
      <div className="flex flex-col gap-1 p-3 text-sm">
        {missing && /^\d{4}-\d{2}-\d{2}$/.test(id) ? (
          <MissingDay date={id} today={today} heading />
        ) : (
          <p className="text-destructive">{query.error.message}</p>
        )}
        {query.error instanceof ApiError && query.error.status === 409 && (
          <p className="text-muted-foreground">
            Fix the header in <span className="font-mono">devlogs/{id}.md</span>; it opens here once it reads.
          </p>
        )}
      </div>
    )
  }
  const log = query.data
  if (!log) return null
  const problems = log.kind === 'day' ? devlogSectionProblems(log.body) : []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1">
        <h2 className="truncate text-sm font-medium">{log.kind === 'day' ? longDay(log.date) : `${monthLabel(log.month)} summary`}</h2>
        {log.kind === 'day' && log.off && <OffLabel log={log} />}
        {log.tags.map((tag) => (
          <TagPill key={tag} tag={tag} />
        ))}
        {problems.length > 0 && <SectionWarning problems={problems} />}
        <span className="flex-1" />
        {editing && <SaveStatus state={state} />}
        {log.kind === 'day' && log.sources.length > 0 && (
          <span className="text-muted-foreground hidden truncate text-[11px] @md:inline">From {log.sources.join(', ')}</span>
        )}
        {!historyOpen && (
          <Button size="xs" variant="ghost" onClick={() => setEditing(!editing)}>
            {editing ? <Eye /> : <Pencil />} {editing ? 'View' : 'Edit'}
          </Button>
        )}
        <HistoryButton
          open={historyOpen}
          onClick={() => {
            // What is waiting is saved first, so the history and a restore start from it.
            if (!historyOpen) editor.current?.flush()
            setHistoryOpen(!historyOpen)
          }}
        />
      </div>
      {historyOpen && (
        <FileHistory path={`devlogs/${id}.md`} onClose={() => setHistoryOpen(false)} onRestored={() => setHistoryOpen(false)} />
      )}
      {error && !historyOpen && <p className="text-destructive border-b px-3 py-1.5 text-xs">{error}</p>}
      {/* Hidden, not unmounted, behind the history: the editor keeps what it shows. */}
      <div className={cn('min-h-0 flex-1 overflow-y-auto', historyOpen && 'hidden')}>
        {editing ? (
          <div className="ostraka-md min-h-full">
            <DevlogEditor id={id} onState={setState} onError={setError} handle={editor} />
          </div>
        ) : log.body.trim() ? (
          <div className="devlog-prose px-5 py-3">
            <MarkdownView markdown={log.body} todoLink={todoLink} mention={renderMention} />
          </div>
        ) : (
          <EmptyState>
            {log.kind === 'day' && log.off ? 'An off day, nothing to log.' : 'Nothing written yet. Press Edit to write it.'}
          </EmptyState>
        )}
      </div>
    </div>
  )
}

function SectionWarning({ problems }: { problems: string[] }) {
  const text = `Not in the Dev log structure: ${problems.join(' ')}`
  return (
    <span title={text} className="text-warning flex items-center">
      <TriangleAlert aria-hidden className="size-3.5" />
      <span className="sr-only">{text}</span>
    </span>
  )
}

/** A date range stacked by day, newest first, with gaps and off days, narrowed by Tags. */
function RangeView({ view, onView }: { view: ViewState & { from: string; to: string }; onView: (view: ViewState) => void }) {
  const query = useDevlogDays({ from: view.from, to: view.to })
  const today = useToday()
  const todoLink = useTodoLink()
  const slow = useAfter(300, query.isPending)
  const days = query.data ? devlogDays(view, query.data, today) : []
  const shown = filterDevlogDays(days, view)
  const tagOptions = [
    ...new Set([...days.flatMap(({ log }) => (log && !isBrokenDevlog(log) ? log.tags : [])), ...(view.tag ?? [])]),
  ].toSorted()
  const setFilter = (next: Pick<ViewState, 'tag' | 'match' | 'person'>) =>
    onView({
      from: view.from,
      to: view.to,
      ...(next.tag?.length && { tag: next.tag }),
      ...(next.match && { match: next.match }),
      ...(next.person?.length && { person: next.person }),
    })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1">
        <h2 className="truncate text-sm font-medium">{rangeLabel(view.from, view.to)}</h2>
        <span className="flex-1" />
        <PeoplePicker chosen={view.person ?? []} onToggle={(id) => setFilter({ ...view, person: toggled(view.person, id) })} />
        <FilterPicker
          label="Tags"
          icon={<Hash className="size-3.5" />}
          options={tagOptions}
          chosen={view.tag ?? []}
          onToggle={(tag) => setFilter({ ...view, tag: toggled(view.tag, tag) })}
          render={(tag) => <TagPill tag={tag} />}
          name={(tag) => `#${tag}`}
          empty="No Tags on these days."
          header={
            <MatchToggle
              match={view.match ?? 'all'}
              onChange={(match) => setFilter({ ...view, match: match === 'any' ? 'any' : undefined })}
            />
          }
        />
        <PersonFilterChips chosen={view.person ?? []} onRemove={(id) => setFilter({ ...view, person: toggled(view.person, id) })} />
        {view.tag && view.tag.length > 1 && (
          <span className="text-muted-foreground text-[11px] font-medium">{view.match === 'any' ? 'Any of' : 'All of'}</span>
        )}
        {view.tag?.map((tag) => (
          <ActiveChip key={tag} label={`Tag ${tag}`} onRemove={() => setFilter({ ...view, tag: toggled(view.tag, tag) })}>
            <TagDot tag={tag} className="ml-0 ring-0" />
            {tag}
          </ActiveChip>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.error && <p className="text-destructive px-3 py-2 text-sm">{query.error.message}</p>}
        {slow && <SkeletonRows />}
        {query.data && !shown.length && (
          <EmptyState>
            {view.tag || view.person
              ? 'No Dev log on these days matches these filters. Remove one or choose other dates.'
              : 'Nothing on these days. Choose other dates.'}
          </EmptyState>
        )}
        {shown.map((day) => (
          <StackedDay key={day.date} day={day} today={today} todoLink={todoLink} onOpen={() => onView({ log: day.date })} />
        ))}
      </div>
    </div>
  )
}

function StackedDay({
  day,
  today,
  todoLink,
  onOpen,
}: {
  day: DevlogDay<Devlog | BrokenDevlog>
  today: string
  todoLink: TodoLinkRenderer
  onOpen: () => void
}) {
  const { log } = day
  if (!log) return <MissingDay date={day.date} today={today} heading className="border-b px-3 py-2.5" />
  return (
    <article aria-label={longDay(day.date)} className="border-b">
      <header className="flex min-w-0 flex-wrap items-center gap-1.5 px-3 pt-2.5">
        <DayHeading onOpen={onOpen}>{longDay(day.date)}</DayHeading>
        {!isBrokenDevlog(log) && log.off && <OffLabel log={log} />}
        {!isBrokenDevlog(log) && log.tags.map((tag) => <TagPill key={tag} tag={tag} />)}
      </header>
      {isBrokenDevlog(log) ? (
        <div className="px-3 pb-2.5">
          <BrokenLine log={log} />
        </div>
      ) : log.body.trim() ? (
        <div className="devlog-prose px-5 pb-2.5">
          <MarkdownView markdown={log.body} todoLink={todoLink} mention={renderMention} />
        </div>
      ) : (
        <div className="pb-2.5" />
      )}
    </article>
  )
}

function DayHeading({ onOpen, children }: { onOpen: () => void; children: ReactNode }) {
  return (
    <h3 className="min-w-0 text-sm font-semibold">
      <button type="button" onClick={onOpen} className={cn('hover:text-primary truncate rounded text-left', focusRing)}>
        {children}
      </button>
    </h3>
  )
}

/** A Mention in a Dev log: the Person's current name with their contact card, or an unknown id with an "add" offer. */
const renderMention = (id: string) => <MentionChip id={id} />

function SkeletonRows() {
  return (
    <ul aria-label="Loading Dev logs" className="flex flex-col">
      {[60, 45, 70].map((width) => (
        <li key={width} className="flex flex-col gap-1.5 border-b px-3 py-2">
          <span className="bg-muted h-3 rounded" style={{ width: `${width}%` }} />
          <span className="bg-muted h-2 w-1/4 rounded" />
        </li>
      ))}
    </ul>
  )
}
