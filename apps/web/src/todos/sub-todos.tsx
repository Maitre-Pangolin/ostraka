// A Todo's Sub-todos, shown under it when expanded: in creation order, finished ones in place, an entry to add one,
// and the offer to finish the parent once its last open Sub-todo is finished.
import { dueAfterParent } from '@ostraka/core/sub-todos'
import type { TokenProps } from '@ostraka/core/todo-tokens'
import { Ban, Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ReferenceText } from '@/references/reference-chip'
import { useAddSubTodo, type SubTodo, type Todo } from './api'
import { longDate } from './due'
import { PropChips } from './quick-entry'
import { TokenField } from './token-field'
import { mergeProps, NO_PROPS } from './token-props'

export type SubTodosProps = {
  parent: Todo
  /** The Sub-todos to list, in creation order: all of them, or those a filter matched. */
  shown: SubTodo[]
  /** Whether to end with the entry for a new Sub-todo (the parent is expanded). */
  entry: boolean
  tags: string[]
  today: string
  /** An open Sub-todo's row, as a `TodoRow` given its warning. */
  renderOpen: (sub: SubTodo, warning: string | undefined) => ReactNode
  onReopen: (sub: SubTodo) => void
  /** Set once the last open Sub-todo was finished here: offer to mark the parent done, never do it unasked. */
  offer?: { onAccept: () => void; onDismiss: () => void }
}

const dueAfterWarning = (parent: Todo) => (parent.due ? `Due after its parent, due ${longDate(parent.due)}` : undefined)

export function SubTodos({ parent, shown, entry, tags, today, renderOpen, onReopen, offer }: SubTodosProps) {
  const allFinished = parent.subTodos.length > 0 && parent.subTodos.every((sub) => sub.status !== 'open')
  return (
    <div className="flex flex-col pl-10">
      {shown.length > 0 && (
        <ul aria-label={`Sub-todos of “${parent.title}”`} className="flex flex-col">
          {shown.map((sub) =>
            sub.status === 'open' ? (
              renderOpen(sub, dueAfterParent(sub, parent) ? dueAfterWarning(parent) : undefined)
            ) : (
              <FinishedSubTodo key={sub.id} sub={sub} onReopen={() => onReopen(sub)} />
            ),
          )}
        </ul>
      )}
      {offer && allFinished && (
        <div role="status" className="text-muted-foreground flex min-h-8 flex-wrap items-center gap-1.5 pl-6 text-xs">
          <span>All Sub-todos finished.</span>
          <Button size="xs" variant="secondary" onClick={offer.onAccept}>
            Mark “{parent.title}” done
          </Button>
          <Button size="xs" variant="ghost" onClick={offer.onDismiss}>
            Not now
          </Button>
        </div>
      )}
      {entry && <SubTodoEntry parentId={parent.id} tags={tags} today={today} />}
    </div>
  )
}

function FinishedSubTodo({ sub, onReopen }: { sub: SubTodo; onReopen: () => void }) {
  const dropped = sub.status === 'dropped'
  return (
    <li data-todo={sub.id} className="hover:bg-muted/70 flex min-h-8 items-center gap-1.5 rounded-md px-1">
      {/* Lines the checkbox up with open Sub-todos, which have a chevron first. */}
      <span aria-hidden className="size-5 shrink-0" />
      {dropped ? (
        <button
          type="button"
          onClick={onReopen}
          aria-label={`Reopen “${sub.title}”`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 grid size-4 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-3"
        >
          <Ban className="size-4" />
        </button>
      ) : (
        <Checkbox checked onCheckedChange={onReopen} aria-label={`Reopen “${sub.title}”`} className="rounded-full" />
      )}
      <span className="text-muted-foreground decoration-muted-foreground/50 min-w-0 flex-1 truncate py-1 pl-1 text-sm line-through">
        <ReferenceText text={sub.title} />
      </span>
      {dropped && (
        <span className="text-muted-foreground hidden max-w-[40%] truncate text-xs @md:block" title={sub.dropReason}>
          {sub.dropReason ? `Dropped: ${sub.dropReason}` : 'Dropped'}
        </span>
      )}
    </li>
  )
}

/**
 * Type a Sub-todo, ↵ adds it and the field stays ready for the next. Completed `#tag`, `*prio` and `^date` wait as
 * chips beside it, as in quick entry. A failed add puts the text back.
 */
function SubTodoEntry({ parentId, tags, today }: { parentId: string; tags: string[]; today: string }) {
  const [title, setTitle] = useState('')
  const [props, setProps] = useState(NO_PROPS)
  const add = useAddSubTodo()
  const addProps = (added: TokenProps) => setProps((before) => mergeProps(before, added))

  const submit = () => {
    if (!title.trim()) return true
    const typed = { title, props }
    setTitle('')
    setProps(NO_PROPS)
    add.mutate(
      { parentId, title, ...props },
      {
        onError: () => {
          setTitle((current) => current || typed.title)
          setProps((current) => mergeProps(typed.props, current))
        },
      },
    )
    return true
  }

  return (
    <div className="flex flex-col pb-1">
      <div className="flex min-h-8 items-center gap-1.5 pr-1 pl-1">
        <Plus aria-hidden className="text-muted-foreground mx-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <TokenField
            value={title}
            onChange={setTitle}
            onTokens={addProps}
            onEnter={({ shift }) => !shift && submit()}
            tags={tags}
            exclude={props.tags}
            aria-label="New Sub-todo"
            placeholder="Add a Sub-todo   #tag  *high  ^fri"
            className="hover:border-border focus:border-ring -my-px rounded border border-transparent px-1 py-0.5 text-sm"
          />
        </div>
        <span className="text-muted-foreground flex shrink-0 flex-wrap items-center gap-1 text-[11px]">
          <PropChips props={props} onChange={setProps} today={today} />
        </span>
      </div>
      {add.error && <p className="text-destructive px-1 text-xs">Couldn’t add the Sub-todo: {add.error.message}</p>}
    </div>
  )
}
