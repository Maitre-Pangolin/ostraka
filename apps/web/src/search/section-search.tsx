// A section's search box (Notes, Dev logs, Todos): narrows the section's own list in place, in its own order, and
// highlights the matches. The text lives in the URL as `q`; the server finds (`useSectionSearch`).
import type { SnippetPiece } from '@ostraka/core/search-types'
import { Search, X } from 'lucide-react'
import { useRef } from 'react'
import { cn } from '@/lib/utils'

const focusRing = 'outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

/** The search field: Esc leaves it and keeps the text, × clears it. */
export function SectionSearch({
  value,
  onChange,
  label,
  className,
}: {
  value: string | undefined
  onChange: (text: string | undefined) => void
  /** What it searches, as the placeholder and accessible name: "Search Notes". */
  label: string
  className?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <label
      className={cn(
        'border-input focus-within:border-ring focus-within:ring-ring/50 dark:bg-input/30 flex h-7 min-w-0 items-center gap-1.5 rounded-md border px-2 focus-within:ring-3',
        className,
      )}
    >
      <Search aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
      <input
        ref={input}
        type="search"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || undefined)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          input.current?.blur()
        }}
        aria-label={label}
        placeholder={label}
        className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-xs outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange(undefined)
            input.current?.focus()
          }}
          aria-label="Clear search"
          className={cn('text-muted-foreground hover:text-foreground -mr-1 shrink-0 rounded p-0.5', focusRing)}
        >
          <X className="size-3" />
        </button>
      )}
    </label>
  )
}

/** The snippet around a match, matches in `<mark>` as in ⌘K. */
export function Snippet({ pieces, className }: { pieces: SnippetPiece[]; className?: string }) {
  if (!pieces.length) return null
  return (
    <span className={cn('text-muted-foreground line-clamp-2 text-xs', className)}>
      {pieces.map((piece, index) =>
        piece.match ? (
          <mark key={index} className="bg-primary/15 text-foreground rounded-xs">
            {piece.text}
          </mark>
        ) : (
          <span key={index}>{piece.text}</span>
        ),
      )}
    </span>
  )
}
