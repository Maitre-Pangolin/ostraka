// A plain-text field (title or description) where `#tag`, `*prio` and `^date` leave the text once completed, picked
// from the suggestions with Tab or ↵, or followed by a space. The values they set go to `onTokens`.
import { pullCompletedTokens, suggestTokens, type TokenProps, type TokenSuggestion } from '@ostraka/core/todo-tokens'
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@/lib/utils'
import { longDate, useToday } from './due'
import { PRIORITY_LABEL } from './priority'
import { PriorityFlag, TagPill } from './properties'

export type TokenFieldProps = {
  value: string
  onChange: (text: string) => void
  /** Properties set by tokens that just left the text. */
  onTokens: (props: TokenProps) => void
  /** ↵ (`shift: false`) or ⇧↵ (`shift: true`). Return true when handled; an unhandled ⇧↵ in a multiline field is a new line. */
  onEnter?: (key: { shift: boolean }) => boolean
  onBlur?: () => void
  /** Tags in use, for `#` suggestions; `exclude` those the Todo already has. */
  tags: string[]
  exclude?: string[]
  multiline?: boolean
  autoFocus?: boolean
  placeholder?: string
  'aria-label': string
  className?: string
}

const hasProps = (props: TokenProps) => props.tags.length > 0 || props.priority !== undefined || props.due !== undefined

/** The word being typed: from the last space before the caret to the caret. */
const fragmentAt = (text: string, caret: number) => /\S*$/.exec(text.slice(0, caret))?.[0] ?? ''

export function TokenField({
  value,
  onChange,
  onTokens,
  onEnter,
  onBlur,
  tags,
  exclude,
  multiline,
  autoFocus,
  placeholder,
  className,
  ...aria
}: TokenFieldProps) {
  const field = useRef<HTMLTextAreaElement>(null)
  const pendingCaret = useRef<number | null>(null)
  const [caret, setCaret] = useState<number | null>(null)
  const [selected, setSelected] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const listId = useId()

  const today = useToday()
  const fragment = caret === null ? '' : fragmentAt(value, caret)
  const suggestions = dismissed || !fragment ? [] : suggestTokens(fragment, { today, tags, exclude }).slice(0, 8)
  const active = Math.min(selected, suggestions.length - 1)

  // Put the caret back where it belongs after a token leaves the text.
  useLayoutEffect(() => {
    if (pendingCaret.current === null || !field.current) return
    field.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  })

  const accept = (text: string, at: number) => {
    const pulled = pullCompletedTokens(text, { today, caret: at })
    const { text: rest, caret: movedCaret, ...props } = pulled
    if (hasProps(props)) onTokens(props)
    if (rest !== value) onChange(rest)
    pendingCaret.current = movedCaret
    setCaret(movedCaret)
    setSelected(0)
    setDismissed(false)
  }

  const pick = (suggestion: TokenSuggestion) => {
    const at = caret ?? value.length
    const start = at - fragment.length
    accept(`${value.slice(0, start)}${suggestion.token} ${value.slice(at)}`, start + suggestion.token.length + 1)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (suggestions.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setSelected((active + step + suggestions.length) % suggestions.length)
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        pick(suggestions[active]!)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setDismissed(true)
        return
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.currentTarget.blur()
      return
    }
    if (event.key === 'Enter') {
      const handled = onEnter?.({ shift: event.shiftKey }) ?? false
      if (handled || !multiline || !event.shiftKey) event.preventDefault()
    }
  }

  return (
    <div className="relative min-w-0 flex-1">
      {/* One element for both: a title is a one-line textarea that wraps instead of scrolling sideways. */}
      <textarea
        ref={field}
        rows={1}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        {...aria}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
        aria-controls={listId}
        aria-activedescendant={suggestions.length ? `${listId}-${active}` : undefined}
        // A title stays on one line, pasted line breaks included.
        onChange={(event) =>
          accept(multiline ? event.target.value : event.target.value.replace(/\r?\n/g, ' '), event.target.selectionStart)
        }
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setCaret(null)
          onBlur?.()
        }}
        className={cn(
          'placeholder:text-muted-foreground field-sizing-content block w-full min-w-0 resize-none bg-transparent outline-none',
          className,
        )}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Suggestions"
        hidden={!suggestions.length}
        className="bg-popover text-popover-foreground ring-foreground/10 absolute top-full left-0 z-30 mt-1 w-64 max-w-full rounded-lg p-1 shadow-md ring-1"
      >
        {suggestions.map((suggestion, index) => (
          <li
            key={suggestion.token}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            // Keep focus in the field: pick on mouse down, before the field would blur.
            onMouseDown={(event) => {
              event.preventDefault()
              pick(suggestion)
            }}
            onMouseEnter={() => setSelected(index)}
            className={cn('flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-sm', index === active && 'bg-accent')}
          >
            <SuggestionLabel suggestion={suggestion} />
            {index === active && <kbd className="text-muted-foreground ml-auto text-[10px]">Tab</kbd>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function SuggestionLabel({ suggestion }: { suggestion: TokenSuggestion }) {
  if (suggestion.kind === 'tag')
    return (
      <>
        <TagPill tag={suggestion.tag} />
        {'isNew' in suggestion && <span className="text-muted-foreground truncate text-xs">New Tag</span>}
      </>
    )
  if (suggestion.kind === 'priority')
    return (
      <>
        <PriorityFlag priority={suggestion.priority} />
        <span>{PRIORITY_LABEL[suggestion.priority]}</span>
        <span className="text-muted-foreground text-xs">{suggestion.token}</span>
      </>
    )
  return (
    <>
      <span>{suggestion.token}</span>
      <span className="text-muted-foreground truncate text-xs">{longDate(suggestion.due)}</span>
    </>
  )
}
