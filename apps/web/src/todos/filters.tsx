// The Todo filters: Priority and Tags chips that open pickers, then the active values as removable chips and
// Clear all. The filter itself lives in the URL search params (see `src/router.tsx`).
import type { Priority } from '@ostraka/core/todo-schema'
import { isFiltering, type TodoFilter } from '@ostraka/core/todo-filter'
import { ChevronDown, Flag, Hash, Search, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useTags } from './api'
import { PRIORITY_LABEL } from './priority'
import { PriorityFlag, TagDot, TagPill } from './properties'

const PRIORITIES: Priority[] = ['high', 'medium', 'low', 'none']
/** A picker with more options than this gets a search field. */
const SEARCH_PAST = 6

const focusRing = 'outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

const toggled = <T,>(values: T[] = [], value: T) =>
  values.includes(value) ? values.filter((other) => other !== value) : [...values, value]

/** The filter chips over the Todo list. `onChange` gets the whole new filter. */
export function TodoFilters({ filter, onChange }: { filter: TodoFilter; onChange: (filter: TodoFilter) => void }) {
  const tags = useTags()
  const priorities = filter.priority ?? []
  const chosenTags = filter.tag ?? []
  // Tags in use, alphabetical; a chosen Tag no Todo has any more stays listed so it can be unchosen.
  const tagOptions = [...new Set([...(tags.data?.map((tag) => tag.name) ?? []), ...chosenTags])].toSorted()

  return (
    <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-1.5">
      <FilterPicker
        label="Priority"
        icon={<Flag className="size-3.5" />}
        options={PRIORITIES}
        chosen={priorities}
        onToggle={(priority) => onChange({ ...filter, priority: toggled(filter.priority, priority) })}
        name={(priority) => PRIORITY_LABEL[priority]}
        render={(priority) => (
          <span className="flex items-center gap-1.5">
            <PriorityFlag priority={priority} />
            {PRIORITY_LABEL[priority]}
          </span>
        )}
      />
      <FilterPicker
        label="Tags"
        icon={<Hash className="size-3.5" />}
        options={tagOptions}
        chosen={chosenTags}
        onToggle={(tag) => onChange({ ...filter, tag: toggled(filter.tag, tag) })}
        render={(tag) => <TagPill tag={tag} />}
        name={(tag) => `#${tag}`}
        empty={tags.error ? <span className="text-destructive">Couldn’t load Tags: {tags.error.message}</span> : 'No Tags yet.'}
        header={
          <MatchToggle
            match={filter.match ?? 'all'}
            onChange={(match) => onChange({ ...filter, match: match === 'any' ? 'any' : undefined })}
          />
        }
      />
      {isFiltering(filter) && (
        <>
          <span aria-hidden className="bg-border mx-0.5 h-4 w-px shrink-0" />
          {priorities.map((priority) => (
            <ActiveChip
              key={priority}
              label={`Priority: ${PRIORITY_LABEL[priority]}`}
              onRemove={() => onChange({ ...filter, priority: toggled(filter.priority, priority) })}
            >
              <PriorityFlag priority={priority} className="size-3" />
              {PRIORITY_LABEL[priority]}
            </ActiveChip>
          ))}
          {chosenTags.length > 1 && (
            <span className="text-muted-foreground text-[11px] font-medium">{filter.match === 'any' ? 'Any of' : 'All of'}</span>
          )}
          {chosenTags.map((tag) => (
            <ActiveChip key={tag} label={`Tag ${tag}`} onRemove={() => onChange({ ...filter, tag: toggled(filter.tag, tag) })}>
              <TagDot tag={tag} className="ml-0 ring-0" />
              {tag}
            </ActiveChip>
          ))}
          <button
            type="button"
            onClick={() => onChange({})}
            className={cn('text-muted-foreground hover:text-foreground h-6 shrink-0 rounded-md px-1 text-[11px]', focusRing)}
          >
            Clear all
          </button>
        </>
      )}
    </div>
  )
}

/** A filter chip: shows how many values are chosen and opens a checklist, with a search field past six options. */
export function FilterPicker<T extends string>({
  label,
  icon,
  options,
  chosen,
  onToggle,
  render,
  name,
  header,
  empty = 'Nothing to pick.',
}: {
  label: string
  icon: ReactNode
  options: T[]
  chosen: T[]
  onToggle: (value: T) => void
  render: (value: T) => ReactNode
  /** The option's accessible name. */
  name: (value: T) => string
  header?: ReactNode
  empty?: ReactNode
}) {
  const [query, setQuery] = useState('')
  const searchable = options.length > SEARCH_PAST
  const shown = searchable ? options.filter((option) => option.includes(query.trim().toLowerCase())) : options
  return (
    <Popover onOpenChange={(open) => open || setQuery('')}>
      <PopoverTrigger
        aria-label={chosen.length ? `${label} filter, ${chosen.length} chosen` : `${label} filter`}
        render={
          <button
            type="button"
            className={cn(
              'text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs',
              focusRing,
              chosen.length > 0 && 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
            )}
          />
        }
      >
        {icon}
        {label}
        {chosen.length > 0 && (
          <span className="bg-primary text-primary-foreground rounded-full px-1 text-[10px] leading-4 font-semibold tabular-nums">
            {chosen.length}
          </span>
        )}
        <ChevronDown aria-hidden className="size-3 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 gap-0 p-1">
        {searchable && (
          <label className="flex items-center gap-1.5 border-b px-2 pb-1">
            <Search aria-hidden className="text-muted-foreground size-3.5" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={`Find ${label}`}
              placeholder={`Find ${label}`}
              className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
        )}
        {header}
        <div className="flex max-h-64 flex-col overflow-y-auto">
          {shown.map((option) => (
            <label key={option} className="hover:bg-muted flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-sm">
              <Checkbox checked={chosen.includes(option)} onCheckedChange={() => onToggle(option)} aria-label={name(option)} />
              {render(option)}
            </label>
          ))}
          {!shown.length && <p className="text-muted-foreground px-2 py-2 text-xs">{options.length ? 'No match.' : empty}</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Tags match all of the chosen ones by default; one click switches to any of them. */
export function MatchToggle({ match, onChange }: { match: 'all' | 'any'; onChange: (match: 'all' | 'any') => void }) {
  return (
    <div className="text-muted-foreground flex items-center justify-between px-2 py-1 text-[11px]">
      Match
      <div role="group" aria-label="Match Tags" className="bg-muted flex rounded-md p-0.5">
        {(['all', 'any'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={match === option}
            onClick={() => onChange(option)}
            className={cn('rounded px-1.5 leading-5', focusRing, match === option && 'bg-background text-foreground shadow-sm')}
          >
            {option === 'all' ? 'All' : 'Any'}
          </button>
        ))}
      </div>
    </div>
  )
}

/** An active filter value, removable with ×. */
export function ActiveChip({ label, onRemove, children }: { label: string; onRemove: () => void; children: ReactNode }) {
  return (
    <span className="bg-muted flex h-6 shrink-0 items-center gap-1 rounded-full pr-1 pl-2 text-xs">
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter ${label}`}
        className={cn('text-muted-foreground hover:bg-background hover:text-foreground rounded-full p-0.5', focusRing)}
      >
        <X className="size-3" />
      </button>
    </span>
  )
}
