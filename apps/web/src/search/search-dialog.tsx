// ⌘K: search everything from anywhere. Search only, no commands. A completed `#tag` or `@person` becomes a removable
// chip; Kind and Date menus narrow further. The server finds and ranks; this lays the hits out by kind and opens the
// one picked at its match. Empty, it lists the items opened last.
import { pullSearchChips, searchQuery, type SearchDates } from '@ostraka/core/search-input'
import { useNavigate } from '@tanstack/react-router'
import { format, parseISO } from 'date-fns'
import { BookText, CalendarRange, CheckSquare, ChevronDown, Lightbulb, Shapes, UserRound, X, type LucideIcon } from 'lucide-react'
import { cn } from 'cn'
import { useEffect, useState, type ReactNode } from 'react'
import type { DateRange } from 'react-day-picker'
import { Calendar } from '@/components/ui/calendar'
import { Command, CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { usePeopleIndex } from '@/people/api'
import { dayToDate, localDay, useToday } from '@/todos/due'
import { TagPill } from '@/todos/properties'
import { useSearch, type SearchHit, type SearchKind } from './api'
import { groupHits } from './groups'
import { recentItems, rememberOpened, type RecentItem } from './recent'

const KINDS: Record<SearchKind, { label: string; icon: LucideIcon }> = {
  todo: { label: 'Todos', icon: CheckSquare },
  note: { label: 'Notes', icon: Lightbulb },
  devlog: { label: 'Dev logs', icon: BookText },
  sketch: { label: 'Sketches', icon: Shapes },
}

const DATE_PRESETS: { value: Exclude<SearchDates, object>; label: string }[] = [
  { value: 'any', label: 'Any date' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'year', label: 'This year' },
]

const focusRing = 'outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

/** A chip taken out of the typed text, in the order typed. */
type Chip = { kind: 'tag'; tag: string } | { kind: 'person'; id: string }

/** Everything the dialog narrows by besides the text; a new opening starts from this. */
type Filters = { chips: Chip[]; tagMatch: 'all' | 'any'; kind: SearchKind | 'any'; dates: SearchDates }
const NO_FILTERS: Filters = { chips: [], tagMatch: 'all', kind: 'any', dates: 'any' }

/** Opens and closes with ⌘K (Ctrl+K), wherever the focus is, editors included. */
function useShortcut(toggle: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        event.stopPropagation()
        toggle()
      }
    }
    // Capture, so an editor's own ⌘K binding never sees it first.
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [toggle])
}

/** The search dialog, mounted once in the shell. */
export function SearchDialog() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [filters, setFilters] = useState(NO_FILTERS)
  const [recent, setRecent] = useState<RecentItem[]>([])
  const today = useToday()
  // Each opening starts a new search, with the items opened last.
  useShortcut(() =>
    setOpen((wasOpen) => {
      if (!wasOpen) {
        setText('')
        setFilters(NO_FILTERS)
        setRecent(recentItems())
      }
      return !wasOpen
    }),
  )
  const navigate = useNavigate()

  const tags = filters.chips.flatMap((chip) => (chip.kind === 'tag' ? [chip.tag] : []))
  const people = filters.chips.flatMap((chip) => (chip.kind === 'person' ? [chip.id] : []))
  const query = searchQuery({ text, tags, tagMatch: filters.tagMatch, people, kind: filters.kind, dates: filters.dates }, today)

  const onType = (typed: string) => {
    const pulled = pullSearchChips(typed)
    setText(pulled.text)
    const added: Chip[] = [
      ...pulled.tags.filter((tag) => !tags.includes(tag)).map((tag) => ({ kind: 'tag' as const, tag })),
      ...pulled.people.filter((id) => !people.includes(id)).map((id) => ({ kind: 'person' as const, id })),
    ]
    if (added.length) setFilters((current) => ({ ...current, chips: [...current.chips, ...added] }))
  }
  const removeChip = (index: number) => setFilters((current) => ({ ...current, chips: current.chips.toSpliced(index, 1) }))

  /** Opens an item's view, at the match: the text searched is highlighted there, and a Todo opens expanded. */
  const openItem = (item: RecentItem) => {
    setOpen(false)
    rememberOpened(item)
    const q = query?.text || undefined
    if (item.kind === 'note') void navigate({ to: '/notes', search: { note: item.id, q } })
    else if (item.kind === 'devlog') void navigate({ to: '/devlogs', search: { log: item.id, q } })
    else if (item.kind === 'sketch') void navigate({ to: '/sketches', search: { sketch: item.id } })
    else void navigate({ to: '/todos', search: { todo: item.id, q } })
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search"
      description="Find Notes, Dev logs, Todos and Sketches"
      className="top-[12%] sm:max-w-xl"
    >
      {/* The server filters and ranks, so cmdk only moves the selection. */}
      <Command shouldFilter={false} className="max-h-[70dvh]">
        <CommandInput
          value={text}
          onValueChange={onType}
          onKeyDown={(event) => {
            // Backspace in an empty field takes the last chip back off.
            if (event.key === 'Backspace' && text === '' && filters.chips.length) removeChip(filters.chips.length - 1)
          }}
          placeholder="Search, or narrow with #tag and @person"
        />
        <FilterBar filters={filters} onChange={setFilters} onRemoveChip={removeChip} today={today} />
        {query ? <SearchResults query={query} onOpen={openItem} /> : <RecentResults items={recent} onOpen={openItem} />}
      </Command>
    </CommandDialog>
  )
}

/** The chips taken from the text, removable, then the Kind and Date menus. */
function FilterBar({
  filters,
  onChange,
  onRemoveChip,
  today,
}: {
  filters: Filters
  onChange: (filters: Filters) => void
  onRemoveChip: (index: number) => void
  today: string
}) {
  const { byId } = usePeopleIndex()
  const tagCount = filters.chips.filter((chip) => chip.kind === 'tag').length
  return (
    <div role="group" aria-label="Search filters" className="flex flex-wrap items-center gap-1 px-1.5 pt-1.5 pb-1">
      {tagCount > 1 && <MatchSwitch match={filters.tagMatch} onChange={(tagMatch) => onChange({ ...filters, tagMatch })} />}
      {filters.chips.map((chip, index) =>
        chip.kind === 'tag' ? (
          <TagPill key={`tag:${chip.tag}`} tag={chip.tag} onRemove={() => onRemoveChip(index)} />
        ) : (
          <PersonChip key={`person:${chip.id}`} name={byId.get(chip.id)?.name ?? `@${chip.id}`} onRemove={() => onRemoveChip(index)} />
        ),
      )}
      <span className="flex-1" />
      <KindMenu kind={filters.kind} onChange={(kind) => onChange({ ...filters, kind })} />
      <DateMenu dates={filters.dates} today={today} onChange={(dates) => onChange({ ...filters, dates })} />
    </div>
  )
}

/** Several Tags match all of them by default; one click switches to any of them. */
function MatchSwitch({ match, onChange }: { match: 'all' | 'any'; onChange: (match: 'all' | 'any') => void }) {
  return (
    <div role="group" aria-label="Match Tags" className="bg-muted flex h-5 items-center rounded-full p-0.5 text-[11px]">
      {(['all', 'any'] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={match === option}
          onClick={() => onChange(option)}
          className={cn(
            'text-muted-foreground rounded-full px-1.5 leading-4',
            focusRing,
            match === option && 'bg-background text-foreground shadow-sm',
          )}
        >
          {option === 'all' ? 'All of' : 'Any of'}
        </button>
      ))}
    </div>
  )
}

function PersonChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <span className="text-primary bg-primary/10 inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[11px] leading-none font-medium">
      <UserRound aria-hidden className="size-3" />
      {name}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className={cn('-mr-0.5 rounded-full opacity-60 hover:opacity-100', focusRing)}
      >
        <X className="size-3" />
      </button>
    </span>
  )
}

/** A menu's trigger, tinted once it narrows anything. */
const menuTrigger = (active: boolean) =>
  cn(
    'text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs',
    focusRing,
    active && 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
  )

function MenuOption({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={cn('hover:bg-muted flex h-7 items-center gap-2 rounded-md px-2 text-left text-sm', focusRing, selected && 'bg-accent')}
    >
      {children}
    </button>
  )
}

function KindMenu({ kind, onChange }: { kind: SearchKind | 'any'; onChange: (kind: SearchKind | 'any') => void }) {
  const [open, setOpen] = useState(false)
  const pick = (next: SearchKind | 'any') => {
    onChange(next)
    setOpen(false)
  }
  const Icon = kind === 'any' ? undefined : KINDS[kind].icon
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<button type="button" aria-label="Kind" className={menuTrigger(kind !== 'any')} />}>
        {Icon && <Icon aria-hidden className="size-3.5" />}
        {kind === 'any' ? 'Kind' : KINDS[kind].label}
        <ChevronDown aria-hidden className="size-3 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 gap-0 p-1">
        <div role="menu" aria-label="Kind" className="flex flex-col">
          <MenuOption selected={kind === 'any'} onClick={() => pick('any')}>
            Any kind
          </MenuOption>
          {(Object.keys(KINDS) as SearchKind[]).map((option) => {
            const { label, icon: OptionIcon } = KINDS[option]
            return (
              <MenuOption key={option} selected={kind === option} onClick={() => pick(option)}>
                <OptionIcon aria-hidden className="text-muted-foreground size-3.5" />
                {label}
              </MenuOption>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const shortDay = (day: string) => format(dayToDate(day), 'd MMM yyyy')

function DateMenu({ dates, today, onChange }: { dates: SearchDates; today: string; onChange: (dates: SearchDates) => void }) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const [picking, setPicking] = useState<DateRange>()
  const chosen = typeof dates === 'object' ? dates : undefined
  const label = chosen
    ? `${shortDay(chosen.from)} – ${shortDay(chosen.to)}`
    : dates === 'any'
      ? 'Date'
      : DATE_PRESETS.find((preset) => preset.value === dates)!.label
  const pick = (next: SearchDates) => {
    onChange(next)
    setOpen(false)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setCustom(chosen !== undefined)
        setPicking(undefined)
      }}
    >
      <PopoverTrigger render={<button type="button" aria-label="Date" className={cn(menuTrigger(dates !== 'any'), 'min-w-0')} />}>
        <CalendarRange aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
        <ChevronDown aria-hidden className="size-3 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto gap-1 p-1">
        <div role="menu" aria-label="Date" className="flex flex-col">
          {DATE_PRESETS.map((preset) => (
            <MenuOption key={preset.value} selected={dates === preset.value} onClick={() => pick(preset.value)}>
              {preset.label}
            </MenuOption>
          ))}
          <MenuOption selected={chosen !== undefined} onClick={() => setCustom(true)}>
            Custom…
          </MenuOption>
        </div>
        {custom && (
          <>
            <Calendar
              mode="range"
              selected={picking ?? (chosen && { from: dayToDate(chosen.from), to: dayToDate(chosen.to) })}
              defaultMonth={dayToDate(chosen?.from ?? today)}
              onSelect={(_range, day) => {
                // The first click picks from, the second to.
                if (!picking?.from) return setPicking({ from: day, to: undefined })
                const [from, to] = [localDay(picking.from), localDay(day)].toSorted()
                pick({ from: from!, to: to! })
              }}
              weekStartsOn={1}
              className="p-0"
            />
            <p className="text-muted-foreground px-1 text-[11px]">
              {picking?.from ? 'Now pick the last day.' : 'Pick the first day, then the last.'}
            </p>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** One line in place of the hits: what to do, the state, or the error. */
const line = (children: string, className = 'text-muted-foreground') => (
  <p className={cn('px-3 py-4 text-sm', className)} aria-live="polite">
    {children}
  </p>
)

/** The items opened last, for going back in one keystroke. */
function RecentResults({ items, onOpen }: { items: RecentItem[]; onOpen: (item: RecentItem) => void }) {
  if (!items.length) return line('Type to search. "A phrase" matches exactly; a Reference or @mention matches as a whole.')
  return (
    <CommandList className="max-h-none flex-1">
      <CommandGroup heading="Recently opened">
        {items.map((item) => (
          <SearchRow key={`${item.kind}:${item.id}`} item={item} onOpen={() => onOpen(item)} />
        ))}
      </CommandGroup>
    </CommandList>
  )
}

function SearchResults({ query, onOpen }: { query: NonNullable<ReturnType<typeof searchQuery>>; onOpen: (item: RecentItem) => void }) {
  const { data, error, isFetching } = useSearch(query)
  if (error) return line(error.message, 'text-destructive')
  if (data?.indexing) return line('Indexing…')
  if (!data) return null
  if (!data.hits.length) return isFetching ? null : line('Nothing found. Try fewer or shorter words, or remove a filter.')
  return (
    <CommandList className="max-h-none flex-1">
      {groupHits(data.hits).map(({ kind, hits }) => (
        <CommandGroup key={kind} heading={KINDS[kind].label}>
          {hits.map((hit) => (
            <SearchRow key={`${hit.kind}:${hit.id}`} item={hit} onOpen={() => onOpen(asRecent(hit))} />
          ))}
        </CommandGroup>
      ))}
    </CommandList>
  )
}

/** What is remembered of a hit once opened. */
const asRecent = ({ kind, id, title, status, parentId }: SearchHit): RecentItem => ({
  kind,
  id,
  title,
  ...(status && { status }),
  ...(parentId && { parentId }),
})

const day = (date: string) => parseISO(date)

/** A Dev log is titled by its day, a monthly summary by its month; anything else by its own title. */
function titleOf(item: RecentItem): string {
  if (item.kind !== 'devlog') return item.title
  return /^\d{4}-\d{2}$/.test(item.id) ? `${format(day(`${item.id}-01`), 'MMMM yyyy')} summary` : format(day(item.id), 'EEEE d MMMM yyyy')
}

/** A hit, or an item opened before (without date, snippet or Tags). */
function SearchRow({ item, onOpen }: { item: RecentItem & Partial<SearchHit>; onOpen: () => void }) {
  const Icon = KINDS[item.kind].icon
  const finished = item.status === 'done' || item.status === 'dropped'
  const snippet = item.snippet ?? []
  const tags = item.tags ?? []
  return (
    <CommandItem value={`${item.kind}:${item.id}`} onSelect={onOpen} className="items-start gap-2.5 py-2">
      <Icon className="text-muted-foreground mt-0.5 size-4" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 truncate font-medium', finished && 'text-muted-foreground line-through')}>
            {titleOf(item)}
          </span>
          {item.status === 'dropped' && <span className="text-muted-foreground shrink-0 text-xs">Dropped</span>}
          {/* A Dev log's title is already its date. */}
          {item.kind !== 'devlog' && item.date && (
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{format(day(item.date), 'd MMM yyyy')}</span>
          )}
        </div>
        {(snippet.length > 0 || tags.length > 0) && (
          <div className="flex min-w-0 items-center gap-2">
            {snippet.length > 0 && (
              <p className="text-muted-foreground line-clamp-2 min-w-0 flex-1 text-xs">
                {snippet.map((piece, index) =>
                  piece.match ? (
                    <mark key={index} className="bg-primary/15 text-foreground rounded-xs">
                      {piece.text}
                    </mark>
                  ) : (
                    <span key={index}>{piece.text}</span>
                  ),
                )}
              </p>
            )}
            {tags.length > 0 && (
              <span className="ml-auto flex shrink-0 gap-1">
                {tags.map((tag) => (
                  <TagPill key={tag} tag={tag} />
                ))}
              </span>
            )}
          </div>
        )}
      </div>
    </CommandItem>
  )
}
