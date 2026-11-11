// A Todo's properties as shown in rows and quick entry: Tag pills, the priority flag and the due date, and the
// pickers that change them.
import type { Priority } from '@ostraka/core/todo-schema'
import { CalendarDays, Flag, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useTagColor } from './api'
import { dayToDate, dueLabel, localDay, longDate, quickDays } from './due'
import { PRIORITY_LABEL } from './priority'
import { TAG_STYLES } from './tag-styles'

const focusRing = 'outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

/** A Tag in its colour from `tags.yml`, with × when `onRemove` is given. */
export function TagPill({ tag, onRemove, className }: { tag: string; onRemove?: () => void; className?: string }) {
  const color = useTagColor(tag)
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[11px] leading-none font-medium',
        TAG_STYLES[color].pill,
        className,
      )}
    >
      #{tag}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove Tag ${tag}`}
          className={cn('-mr-0.5 rounded-full opacity-60 hover:opacity-100', focusRing)}
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}

/** A Tag as a coloured dot, for narrow rows. */
export function TagDot({ tag, className }: { tag: string; className?: string }) {
  const color = useTagColor(tag)
  return <span aria-hidden className={cn('ring-background -ml-0.5 size-2 rounded-full ring-2', TAG_STYLES[color].dot, className)} />
}

const PRIORITY_TEXT: Record<Priority, string> = {
  high: 'text-prio-high',
  medium: 'text-prio-med',
  low: 'text-prio-low',
  none: 'text-muted-foreground',
}

export const PriorityFlag = ({ priority, className }: { priority: Priority; className?: string }) => (
  <Flag aria-hidden className={cn('size-3.5', priority !== 'none' && 'fill-current', PRIORITY_TEXT[priority], className)} />
)

/** The due date relative to today: overdue strongly highlighted, today lightly. */
export function DueText({ due, today, className }: { due: string; today: string; className?: string }) {
  const { text, tone } = dueLabel(due, today)
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1 text-[11px] leading-5 whitespace-nowrap tabular-nums',
        tone === 'overdue' && 'bg-destructive/12 text-destructive font-semibold',
        tone === 'today' && 'text-today font-medium',
        tone === 'soon' && 'text-foreground/75',
        tone === 'later' && 'text-muted-foreground',
        className,
      )}
    >
      {text}
    </span>
  )
}

const PRIORITIES: Priority[] = ['high', 'medium', 'low', 'none']

/** The flag; clicking it opens a priority Popover. `quiet` hides it until the row is hovered when there's no priority. */
export function PriorityPicker({
  priority,
  onChange,
  quiet,
}: {
  priority: Priority
  onChange: (priority: Priority) => void
  quiet?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Priority: ${PRIORITY_LABEL[priority]}`}
        render={
          <button
            type="button"
            className={cn(
              'hover:bg-muted grid size-6 shrink-0 place-items-center rounded',
              focusRing,
              quiet && priority === 'none' && 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100',
            )}
          />
        }
      >
        <PriorityFlag priority={priority} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-40 gap-0.5 p-1">
        {PRIORITIES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              onChange(option)
              setOpen(false)
            }}
            className={cn(
              'hover:bg-accent flex h-7 items-center gap-2 rounded-md px-2 text-left text-sm',
              focusRing,
              option === priority && 'bg-accent',
            )}
          >
            <PriorityFlag priority={option} /> {PRIORITY_LABEL[option]}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

/** The due date (or a calendar icon); clicking it opens quick picks and a calendar. */
export function DuePicker({
  due,
  today,
  onChange,
  quiet,
}: {
  due?: string
  today: string
  onChange: (due: string | null) => void
  quiet?: boolean
}) {
  const [open, setOpen] = useState(false)
  const set = (day: string | null) => {
    onChange(day)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={due ? `Due ${longDate(due)}` : 'Set a due date'}
        render={
          <button
            type="button"
            className={cn(
              'hover:bg-muted flex h-6 shrink-0 items-center rounded px-0.5',
              focusRing,
              quiet && !due && 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100',
            )}
          />
        }
      >
        {due ? <DueText due={due} today={today} /> : <CalendarDays aria-hidden className="text-muted-foreground size-3.5" />}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto gap-1.5 p-1.5">
        <div className="grid grid-cols-2 gap-1">
          {quickDays(today).map(({ label, day }) => (
            <Button key={label} size="xs" variant={due === day ? 'secondary' : 'ghost'} className="justify-start" onClick={() => set(day)}>
              {label}
            </Button>
          ))}
        </div>
        <Calendar
          mode="single"
          selected={due ? dayToDate(due) : undefined}
          defaultMonth={due ? dayToDate(due) : dayToDate(today)}
          onSelect={(date) => date && set(localDay(date))}
          weekStartsOn={1}
          className="p-0"
        />
        {due && (
          <Button size="xs" variant="ghost" className="text-muted-foreground justify-start" onClick={() => set(null)}>
            <X /> Clear date
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
