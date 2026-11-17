// The Dev logs view: the list by year, month and Week, each collapsible (each month's summary on top), beside what is
// open: one day or summary, read-only until Edit, a Week stacked by day, or else the date range stacked by day with
// its Tag and Person filter. The range narrows the list too. All of it but what is collapsed lives in the URL.
import {
  addDays,
  devlogCounts,
  devlogDays,
  devlogList,
  devlogRangeList,
  devlogRangePresets,
  devlogSectionProblems,
  devlogYears,
  filterDevlogDays,
  isWeekId,
  monthRange,
  searchDevlogList,
  weekRange,
  yearRange,
  type DevlogDay,
  type DevlogMonth,
  type DevlogWeek,
  type DevlogsView as ViewState,
} from '@ostraka/core/devlog-days'
import { isBrokenDevlog, type DevlogSummary } from '@ostraka/core/devlog-schema'
import type { SnippetPiece } from '@ostraka/core/search-types'
import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  ArrowLeft,
  CalendarPlus,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  Eye,
  Hash,
  Palmtree,
  Pencil,
  Sparkles,
  Square,
  SquareCheck,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { DateRange } from 'react-day-picker'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { FileHistory, HistoryButton } from '@/history/file-history'
import { ApiError } from '@/lib/api'
import { SaveStatus } from '@/lib/save-status'
import { useAfter } from '@/lib/use-after'
import type { SaveState } from '@/lib/use-autosave'
import { PeoplePicker, PersonFilterChips } from '@/people/people-filter'
import { cn } from '@/lib/utils'
import { ReferenceText } from '@/references/reference-chip'
import { useSectionSearch } from '@/search/api'
import { useFindHighlight } from '@/search/find-highlight'
import { SectionSearch, Snippet } from '@/search/section-search'
import { useRememberOpened } from '@/search/recent'
import { EmptyState } from '@/shell/shell'
import { dayToDate, localDay, useToday } from '@/todos/due'
import { ActiveChip, FilterPicker, MatchToggle } from '@/todos/filters'
import { TagDot, TagPill } from '@/todos/properties'
import { ROW_ACTION } from '@/todos/todos-view'
import { useDevlog, useDevlogDays, useDevlogs, useTodoTitles, type BrokenDevlog, type Devlog, type DevlogListing } from './api'
import { groupsOf, useDevlogGroups } from './collapse'
import { DevlogEditor, type DevlogEditorHandle } from './devlog-editor'
import { MarkdownView, type TextRenderer, type TodoLinkRenderer } from './markdown-view'

const focusRing = 'outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

const toggled = (values: string[] = [], value: string) =>
  values.includes(value) ? values.filter((other) => other !== value) : [...values, value]

/** How the skill is run, shown on a day without a Dev log. */
const SKILL_COMMAND = '/devlog'

const dayLabel = (day: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  dayToDate(day).toLocaleDateString('en-GB', options)
const longDay = (day: string) => dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const monthLabel = (month: string) => dayToDate(`${month}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
const monthName = (month: string) => dayToDate(`${month}-01`).toLocaleDateString('en-GB', { month: 'long' })
const rangeLabel = (from: string, to: string) =>
  `${dayLabel(from, { day: 'numeric', month: 'short' })} – ${dayLabel(to, { day: 'numeric', month: 'short', year: 'numeric' })}`

type Range = { from: string; to: string }

const rangeOf = (view: ViewState): Range | undefined => (view.from && view.to ? { from: view.from, to: view.to } : undefined)
const withoutLog = (view: ViewState): ViewState => Object.fromEntries(Object.entries(view).filter(([key]) => key !== 'log'))

export function DevlogsView() {
  const view = useSearch({ from: '/devlogs' })
  const navigate = useNavigate({ from: '/devlogs' })
  // The search box's text stays while days and ranges are opened, until it is changed itself.
  const setView = (next: ViewState) => void navigate({ search: 'q' in next ? next : { ...next, q: view.q }, replace: true })
  const range = rangeOf(view)
  const open = view.log !== undefined || range !== undefined
  // Opening a day, summary or Week keeps the range and its filter.
  const openLog = (log: string) => setView({ ...view, log })
  // A new range keeps the filter, and shows its days stacked.
  const showRange = ({ from, to }: Range) =>
    setView({
      from,
      to,
      ...(view.tag && { tag: view.tag }),
      ...(view.match && { match: view.match }),
      ...(view.person && { person: view.person }),
    })
  // Clearing the range clears its filter too, and keeps what is open.
  const clearRange = () => setView(view.log ? { log: view.log } : {})
  // Below @3xl one side shows: back from a day goes to the range it was opened in, from the range to the whole list.
  const back = view.log && range ? { label: 'Back to these dates', to: withoutLog(view) } : { label: 'All Dev logs', to: {} }
  return (
    <div className="flex h-full min-h-0">
      <section
        aria-label="Dev logs"
        className={cn('min-h-0 w-full shrink-0 flex-col overflow-y-auto border-r @3xl:flex @3xl:w-72', open ? 'hidden' : 'flex')}
      >
        <DevlogsList view={view} onView={setView} onOpen={openLog} onRange={showRange} onClearRange={clearRange} />
      </section>
      <section className={cn('min-h-0 min-w-0 flex-1 flex-col', open ? 'flex' : 'hidden @3xl:flex')}>
        {open && (
          <button
            type="button"
            onClick={() => setView(back.to)}
            className={cn(
              'text-muted-foreground hover:text-foreground flex h-8 shrink-0 items-center gap-1 border-b px-2 text-xs @3xl:hidden',
              focusRing,
            )}
          >
            <ArrowLeft className="size-3.5" /> {back.label}
          </button>
        )}
        {view.log && isWeekId(view.log) ? (
          <WeekView key={view.log} id={view.log} find={view.q} onOpen={openLog} />
        ) : view.log ? (
          <DevlogDetail key={view.log} id={view.log} find={view.q} />
        ) : range ? (
          <RangeView view={{ ...view, ...range }} onView={setView} onOpen={openLog} />
        ) : (
          <EmptyState>Pick a day or a Week on the left, or choose dates.</EmptyState>
        )}
      </section>
    </div>
  )
}

const sameRange = (a: Range | undefined, b: Range) => a?.from === b.from && a.to === b.to
const daysOfMonths = (months: DevlogMonth[]) => months.flatMap(({ weeks }) => weeks.flatMap(({ days }) => days))

function DevlogsList({
  view,
  onView,
  onOpen,
  onRange,
  onClearRange,
}: {
  view: ViewState
  onView: (view: ViewState) => void
  onOpen: (log: string) => void
  onRange: (range: Range) => void
  onClearRange: () => void
}) {
  const logs = useDevlogs()
  const today = useToday()
  const range = rangeOf(view)
  // The range's days with their bodies, as stacked: a Person is looked for in the text. Shared with the stack's query.
  const rangeDays = useDevlogDays(range)
  const slow = useAfter(300, logs.isPending || (range !== undefined && rangeDays.isPending))
  const search = useSectionSearch('devlog', view.q)
  const list = useFindHighlight(view.q)
  const all = logs.data ? devlogList(logs.data, today) : []
  // A range shows only its days, agreeing with the stack; a search keeps the list's order, without the gaps.
  const months: DevlogMonth[] = range
    ? logs.data && rangeDays.data
      ? devlogRangeList(range, rangeDays.data, logs.data, view, today, search.found)
      : []
    : search.found
      ? searchDevlogList(all, search.found)
      : all
  const years = devlogYears(months)
  const filtered = Boolean(view.tag?.length || view.person?.length)
  // A range or a search opens every group it shows, without touching what is saved.
  const scope = range || search.found ? JSON.stringify([view.from, view.to, search.found && view.q]) : undefined
  const groups = useDevlogGroups(today, scope)
  // What is open shows in the list: its year, month and Week open when it is opened from elsewhere (a link, ⌘K), and
  // again when a range or search starts or ends.
  const revealed = useRef<string | undefined>(undefined)
  useEffect(() => {
    const key = JSON.stringify([view.log, scope])
    if (!view.log || revealed.current === key) return
    revealed.current = key
    groups.reveal(groupsOf(view.log))
  })
  const snippetOf = (id: string) => search.hits?.get(id)?.snippet
  return (
    <>
      <div className="bg-background sticky top-0 z-10 flex h-10 shrink-0 items-center gap-1.5 border-b px-2">
        <RangePicker range={range} today={today} onRange={onRange} onClear={onClearRange} />
      </div>
      <div className="border-b px-2 py-1.5">
        <SectionSearch value={view.q} onChange={(q) => onView({ ...view, q })} label="Search Dev logs" />
      </div>
      {search.indexing && <p className="text-muted-foreground px-3 py-2 text-xs">Indexing…</p>}
      {search.error && <p className="text-destructive px-3 py-2 text-xs">{search.error.message}</p>}
      {logs.error && <p className="text-destructive px-3 py-2 text-sm">{logs.error.message}</p>}
      {rangeDays.error && <p className="text-destructive px-3 py-2 text-sm">{rangeDays.error.message}</p>}
      {slow && <SkeletonRows />}
      {!range && logs.data && !all.length && <EmptyState>No Dev logs yet. Run the Dev log skill to write today's.</EmptyState>}
      {!range && all.length > 0 && !months.length && <EmptyState>No Dev log matches this search. Try fewer or shorter words.</EmptyState>}
      {range && logs.data && rangeDays.data && !months.length && (
        <EmptyState>
          {filtered || view.q
            ? 'No Dev log on these days matches these filters. Remove one or choose other dates.'
            : 'Nothing on these days. Choose other dates.'}
        </EmptyState>
      )}
      <div ref={list}>
        {years.map(({ year, months: yearMonths }) => (
          <div key={year} role="group" aria-label={year}>
            <GroupHeader
              label={year}
              name={year}
              open={groups.isOpen(year)}
              onToggle={() => groups.toggle(year)}
              counts={devlogCounts(daysOfMonths(yearMonths))}
              current={sameRange(range, yearRange(year))}
              action={{ title: 'Show this year', onClick: () => onRange(yearRange(year)) }}
              className="text-sm font-semibold"
            />
            {groups.isOpen(year) &&
              yearMonths.map((month) => (
                <div key={month.month} role="group" aria-label={monthLabel(month.month)}>
                  <GroupHeader
                    label={monthName(month.month)}
                    name={monthLabel(month.month)}
                    open={groups.isOpen(month.month)}
                    onToggle={() => groups.toggle(month.month)}
                    counts={devlogCounts(daysOfMonths([month]))}
                    current={sameRange(range, monthRange(month.month))}
                    action={{ title: 'Show this month', onClick: () => onRange(monthRange(month.month)) }}
                    className="text-xs font-semibold"
                  />
                  {groups.isOpen(month.month) && (
                    <>
                      {month.summary && (
                        <SummaryRow
                          summary={month.summary}
                          snippet={snippetOf(month.month)}
                          active={view.log === month.month}
                          onOpen={() => onOpen(month.month)}
                        />
                      )}
                      {month.weeks.map((week) => (
                        <div key={week.id} role="group" aria-label={`Week ${week.number}`}>
                          <WeekHeader
                            week={week}
                            open={groups.isOpen(week.id)}
                            onToggle={() => groups.toggle(week.id)}
                            active={view.log === week.id}
                            onOpen={() => onOpen(week.id)}
                          />
                          {groups.isOpen(week.id) && (
                            <ul className="flex flex-col">
                              {week.days.map((day) => (
                                <li key={day.date}>
                                  <DayRow
                                    day={day}
                                    today={today}
                                    snippet={snippetOf(day.date)}
                                    active={view.log === day.date}
                                    onOpen={() => onOpen(day.date)}
                                  />
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ))}
          </div>
        ))}
      </div>
    </>
  )
}

/** How many days of a collapsed group have a Dev log, and how many are missing one. */
function GroupCounts({ counts: { written, missing } }: { counts: { written: number; missing: number } }) {
  const title = `${written} ${written === 1 ? 'Dev log' : 'Dev logs'}${missing ? `, ${missing} missing` : ''}`
  return (
    <span
      title={title}
      className="text-muted-foreground ml-auto shrink-0 pl-1 text-[11px] font-normal tracking-normal normal-case tabular-nums"
    >
      {missing ? `${written} · ${missing} missing` : written}
      <span className="sr-only">{` (${title})`}</span>
    </span>
  )
}

/** A year's or month's header: it collapses and expands, and its row action sets the range to it. */
function GroupHeader({
  label,
  name,
  open,
  onToggle,
  counts,
  current,
  action,
  className,
}: {
  label: string
  /** Its full name, for the row action. */
  name: string
  open: boolean
  onToggle: () => void
  counts: { written: number; missing: number }
  /** The range is this year or month. */
  current: boolean
  action: { title: string; onClick: () => void }
  className?: string
}) {
  return (
    <div className={cn('group/row bg-background flex items-center gap-1 border-b pr-2', current && 'bg-accent', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-current={current || undefined}
        onClick={onToggle}
        className={cn('flex min-w-0 flex-1 items-center gap-1 py-1.5 pl-2 text-left', focusRing)}
      >
        <ChevronRight aria-hidden className={cn('text-muted-foreground size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="truncate">{label}</span>
        {!open && <GroupCounts counts={counts} />}
      </button>
      <button type="button" onClick={action.onClick} title={action.title} aria-label={`Show ${name}`} className={ROW_ACTION}>
        <CalendarRange className="size-3.5" />
      </button>
    </div>
  )
}

/** A Week's header: the chevron collapses and expands it, its name opens it stacked by day. */
function WeekHeader({
  week,
  open,
  onToggle,
  active,
  onOpen,
}: {
  week: DevlogWeek
  open: boolean
  onToggle: () => void
  /** The Week is open on the right. */
  active: boolean
  onOpen: () => void
}) {
  const end = addDays(week.start, 6)
  const title = `Week ${week.number} of ${week.id.slice(0, 4)}, ${rangeLabel(week.start, end)}`
  return (
    <div
      className={cn(
        'bg-muted/40 text-muted-foreground flex items-center text-[11px] font-semibold tracking-wide uppercase',
        active && 'bg-accent text-foreground',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Week ${week.number} days`}
        onClick={onToggle}
        className={cn('hover:text-foreground grid shrink-0 place-items-center py-1 pr-1 pl-2', focusRing)}
      >
        <ChevronRight aria-hidden className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
      </button>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active || undefined}
        title={title}
        className={cn('hover:text-foreground flex min-w-0 flex-1 items-center gap-1 py-1 pr-3 text-left uppercase', focusRing)}
      >
        Week {week.number}
        {!open && <GroupCounts counts={devlogCounts(week.days)} />}
      </button>
    </div>
  )
}

function SummaryRow({
  summary,
  snippet,
  active,
  onOpen,
}: {
  summary: DevlogListing
  /** Where a search matched it. */
  snippet?: SnippetPiece[]
  active: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active || undefined}
      className={cn(
        'hover:bg-muted/60 flex w-full min-w-0 flex-col gap-0.5 border-b px-3 py-2 text-left text-sm',
        focusRing,
        active && 'bg-accent',
      )}
    >
      {isBrokenDevlog(summary) ? (
        <BrokenLine log={summary} />
      ) : (
        <span className="flex min-w-0 items-center gap-1.5">
          <Sparkles aria-hidden className="text-primary size-3.5 shrink-0" />
          <span className="truncate font-medium">Monthly summary</span>
        </span>
      )}
      {snippet && <Snippet pieces={snippet} />}
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
function DayRow({
  day,
  today,
  snippet,
  active,
  onOpen,
}: {
  day: DevlogDay
  today: string
  /** Where a search matched it. */
  snippet?: SnippetPiece[]
  active: boolean
  onOpen: () => void
}) {
  const { log } = day
  if (!log) return <MissingDay date={day.date} today={today} className="border-b px-3 py-2" />
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active || undefined}
      className={cn(
        'hover:bg-muted/60 flex w-full min-w-0 flex-col gap-0.5 border-b px-3 py-2 text-left',
        focusRing,
        active && 'bg-accent',
      )}
    >
      <span className="flex w-full min-w-0 items-center gap-2">
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
              <>
                <WrappedTags tags={log.tags} className="hidden @md:flex" />
                <span className="flex min-w-0 items-center gap-1 overflow-hidden @md:hidden">
                  {log.tags.map((tag) => (
                    <TagDot key={tag} tag={tag} />
                  ))}
                </span>
              </>
            )}
          </>
        )}
      </span>
      {snippet && <Snippet pieces={snippet} />}
    </button>
  )
}

/**
 * A day's Tags as pills wrapping onto two rows at most: those that don't fit are counted in a muted +N carrying them as
 * its title. Measured in place, so it follows the list's width.
 */
function WrappedTags({ tags, className }: { tags: string[]; className?: string }) {
  const box = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState(0)
  // Every Tag again when the Tags or the width change, then one less at a time until they fit.
  const fitFor = `${tags.join(' ')}|${width}`
  const [fit, setFit] = useState({ for: fitFor, shown: tags.length })
  if (fit.for !== fitFor) setFit({ for: fitFor, shown: tags.length })
  const { shown } = fit
  useLayoutEffect(() => {
    const element = box.current
    if (element && fit.shown > 0 && element.scrollHeight > element.clientHeight + 1) setFit({ ...fit, shown: fit.shown - 1 })
  }, [fit])
  useEffect(() => {
    const element = box.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry?.contentRect.width ?? 0)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const rest = tags.slice(shown)
  return (
    <span ref={box} className={cn('max-h-9 min-w-0 flex-1 flex-wrap content-start items-center gap-1 overflow-hidden', className)}>
      {tags.slice(0, shown).map((tag) => (
        <TagPill key={tag} tag={tag} className="h-4 text-[10px]" />
      ))}
      {rest.length > 0 && (
        <span title={rest.map((tag) => `#${tag}`).join(' ')} className="text-muted-foreground h-4 text-[10px] leading-4">
          +{rest.length}
          <span className="sr-only">{` more: ${rest.join(', ')}`}</span>
        </span>
      )}
    </span>
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

/** The date range: presets, then a calendar to pick from and to; × clears it. */
function RangePicker({
  range: chosen,
  today,
  onRange,
  onClear,
}: {
  range: Range | undefined
  today: string
  onRange: (range: Range) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState<DateRange>()
  const show = (from: string, to: string) => {
    onRange({ from, to })
    setOpen(false)
  }
  const tinted = chosen && 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
  return (
    <Popover open={open} onOpenChange={(next) => (setOpen(next), setPicking(undefined))}>
      <span className="flex min-w-0 items-center">
        <PopoverTrigger
          render={
            <button
              type="button"
              className={cn(
                'text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted flex h-6 min-w-0 items-center gap-1 rounded-full border px-2 text-xs',
                focusRing,
                tinted,
                chosen && 'rounded-r-none border-r-0 pr-1',
              )}
            />
          }
        >
          <CalendarRange aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{chosen ? rangeLabel(chosen.from, chosen.to) : 'Dates'}</span>
          <ChevronDown aria-hidden className="size-3 shrink-0 opacity-60" />
        </PopoverTrigger>
        {chosen && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear dates"
            title="Clear dates"
            className={cn('grid h-6 shrink-0 place-items-center rounded-r-full border border-l-0 pr-1.5 pl-0.5', focusRing, tinted)}
          >
            <X className="size-3" />
          </button>
        )}
      </span>
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
        {chosen && (
          <Button
            size="xs"
            variant="ghost"
            className="text-muted-foreground justify-start"
            onClick={() => {
              onClear()
              setOpen(false)
            }}
          >
            <X /> Clear dates
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** A Todo link in a Dev log: the Todo's current title, done or open, whatever text the file stored. */
/** A Dev log's text with its References as chips, each with its status dot and hover card. */
const referenceText: TextRenderer = (text) => <ReferenceText text={text} />

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
function DevlogDetail({ id, find }: { id: string; find?: string }) {
  const query = useDevlog(id)
  useRememberOpened('devlog', id, query.data ? id : undefined)
  // The search's matches highlighted in the text, the first scrolled to on opening.
  const body = useFindHighlight(find, id)
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
      <div ref={body} className={cn('min-h-0 flex-1 overflow-y-auto', historyOpen && 'hidden')}>
        {editing ? (
          <div className="ostraka-md min-h-full">
            <DevlogEditor id={id} onState={setState} onError={setError} handle={editor} />
          </div>
        ) : log.body.trim() ? (
          <div className="devlog-prose px-5 py-3">
            <MarkdownView markdown={log.body} todoLink={todoLink} text={referenceText} />
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

/** A date range stacked by day, newest first, with gaps and off days, narrowed by Tags and People. */
function RangeView({
  view,
  onView,
  onOpen,
}: {
  view: ViewState & Range
  onView: (view: ViewState) => void
  onOpen: (day: string) => void
}) {
  const query = useDevlogDays({ from: view.from, to: view.to })
  const today = useToday()
  const todoLink = useTodoLink()
  const slow = useAfter(300, query.isPending)
  const search = useSectionSearch('devlog', view.q)
  const stack = useFindHighlight(view.q)
  const days = query.data ? devlogDays(view, query.data, today) : []
  const shown = filterDevlogDays(days, view, search.found)
  const tagOptions = [
    ...new Set([...days.flatMap(({ log }) => (log && !isBrokenDevlog(log) ? log.tags : [])), ...(view.tag ?? [])]),
  ].toSorted()
  const setFilter = (next: Pick<ViewState, 'tag' | 'match' | 'person'>) =>
    onView({
      from: view.from,
      to: view.to,
      q: view.q,
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
      <div ref={stack} className="min-h-0 flex-1 overflow-y-auto">
        {query.error && <p className="text-destructive px-3 py-2 text-sm">{query.error.message}</p>}
        {slow && <SkeletonRows />}
        {query.data && !shown.length && (
          <EmptyState>
            {view.tag || view.person || view.q
              ? 'No Dev log on these days matches these filters. Remove one or choose other dates.'
              : 'Nothing on these days. Choose other dates.'}
          </EmptyState>
        )}
        <DayStack key={`${view.from} ${view.to}`} days={shown} today={today} todoLink={todoLink} onOpen={onOpen} />
      </div>
    </div>
  )
}

/** A Week stacked by day, newest first, with gaps and off days. */
function WeekView({ id, find, onOpen }: { id: string; find?: string; onOpen: (day: string) => void }) {
  const range = weekRange(id)!
  const query = useDevlogDays(range)
  const today = useToday()
  const todoLink = useTodoLink()
  const slow = useAfter(300, query.isPending)
  const stack = useFindHighlight(find)
  const days = query.data ? devlogDays(range, query.data, today) : []
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-10 shrink-0 items-center gap-2 border-b px-3 py-1">
        <h2 className="shrink-0 text-sm font-medium">Week {Number(id.slice(6))}</h2>
        <span className="text-muted-foreground truncate text-xs">{rangeLabel(range.from, range.to)}</span>
      </div>
      <div ref={stack} className="min-h-0 flex-1 overflow-y-auto">
        {query.error && <p className="text-destructive px-3 py-2 text-sm">{query.error.message}</p>}
        {slow && <SkeletonRows />}
        {query.data && !days.length && <EmptyState>Nothing this Week yet.</EmptyState>}
        <DayStack days={days} today={today} todoLink={todoLink} onOpen={onOpen} />
      </div>
    </div>
  )
}

/** How many stacked days render at first, and how many more each time the end comes near. */
const STACK_STEP = 20

/**
 * Days stacked one under the other, rendered a few at a time as the end of the stack scrolls near, so a year stays
 * quick to open. It sits directly in the element that scrolls.
 */
function DayStack({
  days,
  today,
  todoLink,
  onOpen,
}: {
  days: DevlogDay<Devlog | BrokenDevlog>[]
  today: string
  todoLink: TodoLinkRenderer
  onOpen: (day: string) => void
}) {
  const [count, setCount] = useState(STACK_STEP)
  const [end, setEnd] = useState<HTMLElement | null>(null)
  const more = count < days.length
  useEffect(() => {
    if (!end || !more) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setCount((shown) => shown + STACK_STEP)
      },
      { root: end.parentElement, rootMargin: '800px 0px' },
    )
    observer.observe(end)
    return () => observer.disconnect()
  }, [end, more])
  return (
    <>
      {days.slice(0, count).map((day) => (
        <StackedDay key={day.date} day={day} today={today} todoLink={todoLink} onOpen={() => onOpen(day.date)} />
      ))}
      {/* A new end each time, so it is watched again while it is still in sight. */}
      {more && <div key={count} ref={setEnd} aria-hidden className="h-px" />}
    </>
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
          <MarkdownView markdown={log.body} todoLink={todoLink} text={referenceText} />
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
