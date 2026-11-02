import type { TokenProps } from '@ostraka/core/todo-tokens'
import type { SubTodo } from '@ostraka/core/todo-schema'
import { AlignLeft, Ban, Check, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { Todo, TodoChange } from './api'
import { DuePicker, DueText, PriorityFlag, PriorityPicker, TagDot, TagPill } from './properties'
import { TokenField } from './token-field'

export type TodoRowProps = {
  todo: Todo
  open: boolean
  onToggle: () => void
  onDone: () => void
  onChange: (change: TodoChange) => void
  /** Tags in use, for `#` suggestions. */
  tags: string[]
  today: string
  /** Row actions at the end, such as Drop or delete. */
  actions?: ReactNode
  /** Shown only for context: the Todo doesn't match the filter, some of its Sub-todos do. */
  dimmed?: boolean
  /** Under the row, such as the Sub-todos a filter matched. */
  children?: ReactNode
}

/** A row shown only for context around what a filter matched. */
export const DIMMED = 'opacity-50 hover:opacity-100 focus-within:opacity-100'

const PRIORITY_RING: Record<Todo['priority'], string> = {
  high: 'border-prio-high',
  medium: 'border-prio-med',
  low: 'border-prio-low',
  none: '',
}

/** Tokens typed in an open Todo change it straight away. */
function tokenChange(tags: string[], props: TokenProps): TodoChange {
  const change: TodoChange = {}
  if (props.tags.length) change.tags = [...new Set([...tags, ...props.tags])]
  if (props.priority) change.priority = props.priority
  if (props.due) change.due = props.due
  return change
}

/**
 * One open Todo. Collapsed, it shows indicators for description, due date, priority and Tags. Expanded, its title and
 * description are edited in place and its Tags can be removed. The date and the flag open their pickers either way.
 */
export function TodoRow({ todo, open, onToggle, onDone, onChange, tags, today, actions, dimmed, children }: TodoRowProps) {
  const [describing, setDescribing] = useState(false)
  const showDescription = open && (todo.description !== undefined || describing)
  // The Tags as last sent, so tokens typed in quick succession add up before the list has caught up.
  const latestTags = useRef(todo.tags)
  useEffect(() => {
    latestTags.current = todo.tags
  }, [todo.tags])
  const setTags = (next: string[]) => {
    latestTags.current = next
    onChange({ tags: next })
  }
  const onTokens = (props: TokenProps) => {
    const change = tokenChange(latestTags.current, props)
    if (change.tags) latestTags.current = change.tags
    onChange(change)
  }
  return (
    <li className="flex flex-col">
      <div className={cn('group/row hover:bg-muted/70 flex min-h-8 items-center gap-1.5 rounded-md px-1', dimmed && DIMMED)}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} “${todo.title}”`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 grid size-5 shrink-0 place-items-center rounded outline-none focus-visible:ring-3"
        >
          <ChevronRight aria-hidden className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        </button>
        <Checkbox
          checked={false}
          onCheckedChange={onDone}
          aria-label={`Mark “${todo.title}” done`}
          className={cn('rounded-full', PRIORITY_RING[todo.priority])}
        />
        {open ? (
          <TitleEditor todo={todo} onChange={onChange} onTokens={onTokens} tags={tags} onDescribe={() => setDescribing(true)} />
        ) : (
          <span onClick={onToggle} className="min-w-0 flex-1 cursor-default truncate py-1 pl-1 text-sm">
            {todo.title}
          </span>
        )}
        {!open && <Indicators todo={todo} />}
        <DuePicker due={todo.due} today={today} quiet onChange={(due) => onChange({ due })} />
        <PriorityPicker priority={todo.priority} quiet onChange={(priority) => onChange({ priority })} />
        {actions}
      </div>
      {open && (showDescription || todo.tags.length > 0) && (
        <div className="mb-1 ml-11 flex flex-col gap-1 pr-2">
          {showDescription && (
            <DescriptionEditor
              todo={todo}
              onChange={onChange}
              onTokens={onTokens}
              tags={tags}
              autoFocus={describing}
              onClose={() => setDescribing(false)}
            />
          )}
          {todo.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {todo.tags.map((tag) => (
                <TagPill key={tag} tag={tag} onRemove={() => setTags(latestTags.current.filter((other) => other !== tag))} />
              ))}
            </div>
          )}
        </div>
      )}
      {children}
    </li>
  )
}

const PRIORITY_DOT: Record<SubTodo['priority'], string> = { ...PRIORITY_RING, none: 'border-input' }

/**
 * Sub-todos under their parent, as a filter matched them: read-only lines with a guide from the parent's checkbox.
 * Editing and finishing Sub-todos come with their own rows.
 */
export function SubTodoLines({ subTodos, today }: { subTodos: SubTodo[]; today: string }) {
  if (!subTodos.length) return null
  return (
    <ul aria-label="Matching Sub-todos" className="border-border mb-1 ml-8 flex flex-col border-l pl-2">
      {subTodos.map((subTodo) => {
        const finished = subTodo.status !== 'open'
        return (
          <li key={subTodo.id} className="flex min-h-7 items-center gap-1.5 px-1">
            {subTodo.status === 'done' ? (
              <Check aria-label="Done" className="text-muted-foreground size-3.5 shrink-0" />
            ) : subTodo.status === 'dropped' ? (
              <Ban aria-label="Dropped" className="text-muted-foreground size-3.5 shrink-0" />
            ) : (
              <span aria-hidden className={cn('size-3.5 shrink-0 rounded-full border', PRIORITY_DOT[subTodo.priority])} />
            )}
            <span className={cn('min-w-0 flex-1 truncate text-sm', finished && 'text-muted-foreground line-through')}>{subTodo.title}</span>
            <span className="hidden shrink-0 items-center gap-1 @md:flex">
              {subTodo.tags.map((tag) => (
                <TagPill key={tag} tag={tag} />
              ))}
            </span>
            {subTodo.due && !finished && <DueText due={subTodo.due} today={today} />}
            {subTodo.priority !== 'none' && <PriorityFlag priority={subTodo.priority} className="shrink-0" />}
          </li>
        )
      })}
    </ul>
  )
}

function Indicators({ todo }: { todo: Todo }) {
  return (
    <>
      {todo.description && (
        <span className="text-muted-foreground shrink-0" title="Has a description">
          <AlignLeft aria-hidden className="size-3.5" />
          <span className="sr-only">Has a description</span>
        </span>
      )}
      {todo.tags.length > 0 && (
        <>
          <span className="hidden shrink-0 items-center gap-1 @md:flex">
            {todo.tags.slice(0, 3).map((tag) => (
              <TagPill key={tag} tag={tag} />
            ))}
            {todo.tags.length > 3 && <span className="text-muted-foreground text-[11px]">+{todo.tags.length - 3}</span>}
          </span>
          <span className="flex shrink-0 pl-1 @md:hidden" title={todo.tags.map((tag) => `#${tag}`).join(' ')}>
            {todo.tags.map((tag) => (
              <TagDot key={tag} tag={tag} />
            ))}
            <span className="sr-only">{todo.tags.map((tag) => `#${tag}`).join(' ')}</span>
          </span>
        </>
      )}
    </>
  )
}

type EditorProps = { todo: Todo; onChange: (change: TodoChange) => void; onTokens: (props: TokenProps) => void; tags: string[] }

/** The text being edited, following the stored text while the field isn't being edited. */
function useDraft(stored: string) {
  const [draft, setDraft] = useState(stored)
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setDraft(stored)
  }, [stored])
  return {
    draft,
    setDraft: (text: string) => {
      editing.current = true
      setDraft(text)
    },
    done: () => {
      editing.current = false
    },
    reset: () => setDraft(stored),
  }
}

/** ↵ or leaving the field saves the title; ⇧↵ opens the description. An emptied title goes back to what it was. */
function TitleEditor({ todo, onChange, onTokens, tags, onDescribe }: EditorProps & { onDescribe: () => void }) {
  const { draft, setDraft, done, reset } = useDraft(todo.title)
  const save = () => {
    done()
    if (!draft.trim()) reset()
    else if (draft.trim() !== todo.title) onChange({ title: draft })
  }
  return (
    <TokenField
      value={draft}
      onChange={setDraft}
      onTokens={onTokens}
      onEnter={({ shift }) => {
        if (shift) onDescribe()
        else (document.activeElement as HTMLElement | null)?.blur()
        return true
      }}
      onBlur={save}
      tags={tags}
      exclude={todo.tags}
      aria-label="Title"
      className="hover:border-border focus:border-ring -my-px rounded border border-transparent px-1 py-0.5 text-sm"
    />
  )
}

/** Plain text. ↵ or leaving the field saves it, ⇧↵ makes a new line; emptied, it closes. */
function DescriptionEditor({
  todo,
  onChange,
  onTokens,
  tags,
  autoFocus,
  onClose,
}: EditorProps & { autoFocus: boolean; onClose: () => void }) {
  const { draft, setDraft, done } = useDraft(todo.description ?? '')
  const save = () => {
    done()
    if (draft.trim() !== (todo.description ?? '')) onChange({ description: draft })
    if (!draft.trim()) onClose()
  }
  return (
    <TokenField
      multiline
      autoFocus={autoFocus}
      value={draft}
      onChange={setDraft}
      onTokens={onTokens}
      onEnter={({ shift }) => {
        if (shift) return false
        ;(document.activeElement as HTMLElement | null)?.blur()
        return true
      }}
      onBlur={save}
      tags={tags}
      exclude={todo.tags}
      aria-label="Description"
      placeholder="Description"
      className="text-muted-foreground hover:bg-muted/60 focus:bg-card focus:text-foreground focus:border-ring rounded-md border border-transparent px-2 py-1 text-xs leading-5"
    />
  )
}
