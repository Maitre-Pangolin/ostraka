import type { TokenProps } from '@ostraka/core/todo-tokens'
import type { SubTodo as StoredSubTodo } from '@ostraka/core/todo-schema'
import { AlignLeft, Ban, Check, ChevronRight, ListTree, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { ReferenceText } from '@/references/reference-chip'
import type { TodoChange, TodoItem } from './api'
import { isExpandable } from './expansion'
import { PRIORITY_RING } from './priority'
import { DuePicker, DueText, PriorityFlag, PriorityPicker, TagDot, TagPill } from './properties'
import { TokenField } from './token-field'

export type TodoRowProps = {
  /** A Todo, or a Sub-todo: they look and edit the same. */
  todo: TodoItem
  /** Asked to show expanded. A row without a description or Sub-todos stays collapsed anyway (`isExpandable`). */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A Sub-todo is being added under it: it shows expanded, with the entry among its children. */
  adding?: boolean
  onDone: () => void
  onChange: (change: TodoChange) => void
  /** Tags in use, for `#` suggestions. */
  tags: string[]
  today: string
  /** Row actions at the end, such as Add a Sub-todo and Drop or delete. */
  actions?: ReactNode
  /** A warning shown before the due date, such as a Sub-todo due after its parent. */
  warning?: string
  /** Shown only for context: the Todo doesn't match the filter, some of its Sub-todos do. */
  dimmed?: boolean
  /** Under the row, along a guide line from its checkbox: a Todo's Sub-todos. */
  children?: ReactNode
}

/** A row shown only for context around what a filter matched. */
export const DIMMED = 'opacity-50 hover:opacity-100 focus-within:opacity-100'

/** Tokens typed in an open Todo change it straight away. */
function tokenChange(tags: string[], props: TokenProps): TodoChange {
  const change: TodoChange = {}
  if (props.tags.length) change.tags = [...new Set([...tags, ...props.tags])]
  if (props.priority) change.priority = props.priority
  if (props.due) change.due = props.due
  return change
}

/**
 * One open Todo or Sub-todo: `▸ ○ Title [indicators] #tags [warning] date flag [actions]`. Tags, date and priority
 * always sit on the row. Only a row with a description or Sub-todos expands (chevron); expanded, its title and
 * description are edited in place, its Tags get ×, and its Sub-todos show under it along a guide line from its
 * checkbox. A row with neither has no chevron, and its title is edited in place by clicking it.
 */
export function TodoRow({
  todo,
  open,
  onOpenChange,
  adding,
  onDone,
  onChange,
  tags,
  today,
  actions,
  warning,
  dimmed,
  children,
}: TodoRowProps) {
  const [describing, setDescribing] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const expandable = isExpandable(todo)
  const expanded = Boolean(adding) || (open && (expandable || describing))
  const showDescription = expanded && (todo.description !== undefined || describing)
  // The Tags as last sent, so tokens typed in quick succession add up before the list has caught up.
  const latestTags = useRef(todo.tags)
  useEffect(() => {
    latestTags.current = todo.tags
  }, [todo.tags])
  const removeTag = (tag: string) => {
    latestTags.current = latestTags.current.filter((other) => other !== tag)
    onChange({ tags: latestTags.current })
  }
  const onTokens = (props: TokenProps) => {
    const change = tokenChange(latestTags.current, props)
    if (change.tags) latestTags.current = change.tags
    onChange(change)
  }
  const toggle = () => {
    if (expanded) setDescribing(false)
    onOpenChange(!expanded)
  }
  return (
    <li data-todo={todo.id} className="flex flex-col">
      <div className={cn('group/row hover:bg-muted/70 flex min-h-8 items-center gap-1.5 rounded-md px-1', dimmed && DIMMED)}>
        {expandable ? (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} “${todo.title}”`}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 grid size-5 shrink-0 place-items-center rounded outline-none focus-visible:ring-3"
          >
            <ChevronRight aria-hidden className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
          </button>
        ) : (
          // Keeps the checkbox lined up with the rows that expand.
          <span aria-hidden className="size-5 shrink-0" />
        )}
        <Checkbox
          checked={false}
          onCheckedChange={onDone}
          aria-label={`Mark “${todo.title}” done`}
          className={cn('rounded-full', PRIORITY_RING[todo.priority])}
        />
        {expanded || editingTitle ? (
          <div className="flex min-w-1/4 flex-1">
            <TitleEditor
              todo={todo}
              onChange={onChange}
              onTokens={onTokens}
              tags={tags}
              autoFocus={editingTitle}
              onLeave={() => setEditingTitle(false)}
              onDescribe={() => {
                setDescribing(true)
                onOpenChange(true)
              }}
            />
          </div>
        ) : expandable ? (
          <span onClick={toggle} className="min-w-0 flex-1 cursor-default truncate py-1 pl-1 text-sm">
            <ReferenceText text={todo.title} />
          </span>
        ) : (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Edit “${todo.title}”`}
            onClick={() => setEditingTitle(true)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.target !== event.currentTarget) return
              event.preventDefault()
              setEditingTitle(true)
            }}
            className="focus-visible:ring-ring/50 min-w-0 flex-1 cursor-text truncate rounded py-1 pl-1 text-sm outline-none focus-visible:ring-3"
          >
            <ReferenceText text={todo.title} />
          </span>
        )}
        {!expanded && <Indicators todo={todo} />}
        <RowTags tags={todo.tags} onRemove={expanded ? removeTag : undefined} />
        {warning && (
          <span className="text-warning shrink-0" title={warning}>
            <TriangleAlert aria-hidden className="size-3.5" />
            <span className="sr-only">{warning}</span>
          </span>
        )}
        <DuePicker due={todo.due} today={today} quiet onChange={(due) => onChange({ due })} />
        <PriorityPicker priority={todo.priority} quiet onChange={(priority) => onChange({ priority })} />
        {actions}
      </div>
      {(showDescription || children) && (
        <div className={cn('relative flex flex-col', children && GUIDE_LINE)}>
          {showDescription && (
            <div className="mb-1 ml-11 flex flex-col gap-1 pr-2">
              <DescriptionEditor
                todo={todo}
                onChange={onChange}
                onTokens={onTokens}
                tags={tags}
                autoFocus={describing}
                onClose={() => setDescribing(false)}
              />
            </div>
          )}
          {children}
        </div>
      )}
    </li>
  )
}

// A vertical line from the centre of the row's checkbox (padding, chevron, gap, half the checkbox) down its Sub-todos.
const GUIDE_LINE = 'before:bg-border before:absolute before:top-0 before:bottom-4 before:left-[calc(var(--spacing)*9.5)] before:w-px'

/**
 * Sub-todos of a finished Todo, as a filter matched them in Done & Dropped: read-only lines with a guide from the
 * parent's checkbox. Open Todos show their Sub-todos as full rows instead (`SubTodos`).
 */
export function SubTodoLines({ subTodos, today }: { subTodos: StoredSubTodo[]; today: string }) {
  if (!subTodos.length) return null
  return (
    <ul aria-label="Matching Sub-todos" className="border-border mb-1 ml-8 flex flex-col border-l pl-2">
      {subTodos.map((subTodo) => {
        const finished = subTodo.status !== 'open'
        return (
          <li key={subTodo.id} data-todo={subTodo.id} className="flex min-h-7 items-center gap-1.5 px-1">
            {subTodo.status === 'done' ? (
              <Check aria-label="Done" className="text-muted-foreground size-3.5 shrink-0" />
            ) : subTodo.status === 'dropped' ? (
              <Ban aria-label="Dropped" className="text-muted-foreground size-3.5 shrink-0" />
            ) : (
              <span aria-hidden className={cn('size-3.5 shrink-0 rounded-full', PRIORITY_RING[subTodo.priority])} />
            )}
            <span className={cn('min-w-0 flex-1 truncate text-sm', finished && 'text-muted-foreground line-through')}>
              <ReferenceText text={subTodo.title} />
            </span>
            <RowTags tags={subTodo.tags} />
            {subTodo.due && !finished && <DueText due={subTodo.due} today={today} />}
            {subTodo.priority !== 'none' && <PriorityFlag priority={subTodo.priority} className="shrink-0" />}
          </li>
        )
      })}
    </ul>
  )
}

/** A collapsed row's Sub-todo count and description mark. */
function Indicators({ todo }: { todo: TodoItem }) {
  const subTodos = 'subTodos' in todo ? todo.subTodos : []
  const finished = subTodos.filter((sub) => sub.status !== 'open').length
  return (
    <>
      {subTodos.length > 0 && (
        <span
          className="text-muted-foreground flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums"
          title={`${finished} of ${subTodos.length} Sub-todos finished`}
        >
          <ListTree aria-hidden className="size-3.5" />
          <span aria-hidden>
            {finished}/{subTodos.length}
          </span>
          <span className="sr-only">
            {finished} of {subTodos.length} Sub-todos finished
          </span>
        </span>
      )}
      {todo.description && (
        <span className="text-muted-foreground shrink-0" title="Has a description">
          <AlignLeft aria-hidden className="size-3.5" />
          <span className="sr-only">Has a description</span>
        </span>
      )}
    </>
  )
}

/**
 * A row's Tags, on the row after its title. Expanded (`onRemove`): every Tag as a pill with ×, wrapping within half
 * the row rather than squeezing the title or scrolling sideways. Collapsed: up to three pills, below `@md` dots.
 */
function RowTags({ tags, onRemove }: { tags: string[]; onRemove?: (tag: string) => void }) {
  if (!tags.length) return null
  if (onRemove)
    return (
      <span className="flex max-w-1/2 min-w-0 flex-wrap items-center justify-end gap-1">
        {tags.map((tag) => (
          <TagPill key={tag} tag={tag} onRemove={() => onRemove(tag)} />
        ))}
      </span>
    )
  const label = tags.map((tag) => `#${tag}`).join(' ')
  return (
    <>
      <span className="hidden shrink-0 items-center gap-1 @md:flex">
        {tags.slice(0, 3).map((tag) => (
          <TagPill key={tag} tag={tag} />
        ))}
        {tags.length > 3 && <span className="text-muted-foreground text-[11px]">+{tags.length - 3}</span>}
      </span>
      <span className="flex shrink-0 pl-1 @md:hidden" title={label}>
        {tags.map((tag) => (
          <TagDot key={tag} tag={tag} />
        ))}
        <span className="sr-only">{label}</span>
      </span>
    </>
  )
}

type EditorProps = { todo: TodoItem; onChange: (change: TodoChange) => void; onTokens: (props: TokenProps) => void; tags: string[] }

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

/**
 * ↵ or leaving the field saves the title; ⇧↵ opens the description. An emptied title goes back to what it was.
 * `onLeave` follows leaving it, which ends editing in place on a row that doesn't expand.
 */
function TitleEditor({
  todo,
  onChange,
  onTokens,
  tags,
  autoFocus,
  onLeave,
  onDescribe,
}: EditorProps & { autoFocus: boolean; onLeave: () => void; onDescribe: () => void }) {
  const { draft, setDraft, done, reset } = useDraft(todo.title)
  const save = () => {
    done()
    if (!draft.trim()) reset()
    else if (draft.trim() !== todo.title) onChange({ title: draft })
    onLeave()
  }
  return (
    <TokenField
      autoFocus={autoFocus}
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
