// ⌘K: search everything from anywhere. Search only, no commands. The server finds and ranks; this lays the hits out
// by kind and opens the one picked.
import { useNavigate } from '@tanstack/react-router'
import { format, parseISO } from 'date-fns'
import { BookText, CheckSquare, Lightbulb, Shapes, type LucideIcon } from 'lucide-react'
import { cn } from 'cn'
import { useEffect, useState } from 'react'
import { Command, CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { TagPill } from '@/todos/properties'
import { useSearch, type SearchHit, type SearchKind } from './api'
import { groupHits } from './groups'

const KINDS: Record<SearchKind, { label: string; icon: LucideIcon }> = {
  todo: { label: 'Todos', icon: CheckSquare },
  note: { label: 'Notes', icon: Lightbulb },
  devlog: { label: 'Dev logs', icon: BookText },
  sketch: { label: 'Sketches', icon: Shapes },
}

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
  // Each opening starts a new search.
  useShortcut(() =>
    setOpen((wasOpen) => {
      if (!wasOpen) setText('')
      return !wasOpen
    }),
  )
  const navigate = useNavigate()

  const openHit = (hit: SearchHit) => {
    setOpen(false)
    if (hit.kind === 'note') void navigate({ to: '/notes', search: { note: hit.id } })
    else if (hit.kind === 'devlog') void navigate({ to: '/devlogs', search: { log: hit.id } })
    else if (hit.kind === 'sketch') void navigate({ to: '/sketches', search: { sketch: hit.id } })
    else void navigate({ to: '/todos', search: {} })
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
        <CommandInput value={text} onValueChange={setText} placeholder="Search Notes, Dev logs, Todos and Sketches" />
        <SearchResults text={text} onOpen={openHit} />
      </Command>
    </CommandDialog>
  )
}

/** One line in place of the hits: what to do, the state, or the error. */
const line = (children: string, className = 'text-muted-foreground') => (
  <p className={cn('px-3 py-4 text-sm', className)} aria-live="polite">
    {children}
  </p>
)

function SearchResults({ text, onOpen }: { text: string; onOpen: (hit: SearchHit) => void }) {
  const { data, error, isFetching } = useSearch(text)
  if (!text.trim()) return line('Type to search. "A phrase" matches exactly; a Reference or @mention matches as a whole.')
  if (error) return line(error.message, 'text-destructive')
  if (data?.indexing) return line('Indexing…')
  if (!data) return null
  if (!data.hits.length) return isFetching ? null : line('Nothing found. Try fewer or shorter words.')
  return (
    <CommandList className="max-h-none flex-1">
      {groupHits(data.hits).map(({ kind, hits }) => (
        <CommandGroup key={kind} heading={KINDS[kind].label}>
          {hits.map((hit) => (
            <SearchRow key={`${hit.kind}:${hit.id}`} hit={hit} onOpen={onOpen} />
          ))}
        </CommandGroup>
      ))}
    </CommandList>
  )
}

const day = (date: string) => parseISO(date)

/** A Dev log is titled by its day, a monthly summary by its month; anything else by its own title. */
function titleOf(hit: SearchHit): string {
  if (hit.kind !== 'devlog') return hit.title
  return /^\d{4}-\d{2}$/.test(hit.id) ? `${format(day(`${hit.id}-01`), 'MMMM yyyy')} summary` : format(day(hit.id), 'EEEE d MMMM yyyy')
}

function SearchRow({ hit, onOpen }: { hit: SearchHit; onOpen: (hit: SearchHit) => void }) {
  const Icon = KINDS[hit.kind].icon
  const finished = hit.status === 'done' || hit.status === 'dropped'
  return (
    <CommandItem value={`${hit.kind}:${hit.id}`} onSelect={() => onOpen(hit)} className="items-start gap-2.5 py-2">
      <Icon className="text-muted-foreground mt-0.5 size-4" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 truncate font-medium', finished && 'text-muted-foreground line-through')}>
            {titleOf(hit)}
          </span>
          {hit.status === 'dropped' && <span className="text-muted-foreground shrink-0 text-xs">Dropped</span>}
          {/* A Dev log's title is already its date. */}
          {hit.kind !== 'devlog' && (
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{format(day(hit.date), 'd MMM yyyy')}</span>
          )}
        </div>
        {(hit.snippet.length > 0 || hit.tags.length > 0) && (
          <div className="flex min-w-0 items-center gap-2">
            {hit.snippet.length > 0 && (
              <p className="text-muted-foreground line-clamp-2 min-w-0 flex-1 text-xs">
                {hit.snippet.map((piece, index) =>
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
            {hit.tags.length > 0 && (
              <span className="ml-auto flex shrink-0 gap-1">
                {hit.tags.map((tag) => (
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
