import type { TokenProps } from '@ostraka/core/todo-tokens'
import { CalendarDays, X } from 'lucide-react'
import { useState } from 'react'
import { useAddTodo, useTagNames } from './api'
import { useToday } from './due'
import { PRIORITY_LABEL } from './priority'
import { DueText, PriorityFlag, TagPill } from './properties'
import { TokenField } from './token-field'

const NO_PROPS: TokenProps = { tags: [] }

/** Tokens pulled out later win: Tags add up, a priority or date replaces the one before. */
const mergeProps = (before: TokenProps, added: TokenProps): TokenProps => ({
  tags: [...new Set([...before.tags, ...added.tags])],
  priority: added.priority ?? before.priority,
  due: added.due ?? before.due,
})

/**
 * Type a title, ↵ adds it. Completed `#tag`, `*prio` and `^date` leave the text and wait as chips under the input
 * (× removes one) until the Todo is added; tokens still in the text are pulled out on add. ⇧↵ opens a plain-text
 * description, where ↵ adds and ⇧↵ makes a new line. The fields clear at once; a failed add puts everything back.
 */
export function QuickEntry() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState<string | null>(null)
  const [props, setProps] = useState(NO_PROPS)
  const add = useAddTodo()
  const tags = useTagNames()
  const today = useToday()
  const addProps = (added: TokenProps) => setProps((before) => mergeProps(before, added))

  const submit = () => {
    if (!title.trim()) return true
    const typed = { title, description, props }
    setTitle('')
    setDescription(null)
    setProps(NO_PROPS)
    add.mutate(description?.trim() ? { title, description, ...props } : { title, ...props }, {
      onError: () => {
        setTitle((current) => current || typed.title)
        setDescription((current) => current ?? typed.description)
        setProps((current) => mergeProps(typed.props, current))
      },
    })
    return true
  }

  const hasChips = props.tags.length > 0 || props.priority !== undefined || props.due !== undefined
  return (
    <div className="flex flex-col gap-1">
      <div className="bg-card focus-within:border-ring focus-within:ring-ring/50 rounded-lg border focus-within:ring-3">
        <div className="flex h-9 items-center px-2.5">
          <TokenField
            autoFocus
            value={title}
            onChange={setTitle}
            onTokens={addProps}
            onEnter={({ shift }) => {
              if (!shift) return submit()
              setDescription((current) => current ?? '')
              return true
            }}
            tags={tags}
            exclude={props.tags}
            aria-label="New Todo"
            placeholder="Add a Todo   #tag  *high  ^fri"
            className="text-sm"
          />
        </div>
        {description !== null && (
          <div className="border-t px-2.5 py-1.5">
            <TokenField
              autoFocus
              multiline
              value={description}
              onChange={setDescription}
              onTokens={addProps}
              onEnter={({ shift }) => !shift && submit()}
              tags={tags}
              exclude={props.tags}
              aria-label="Description"
              placeholder="Description (⇧↵ new line, ↵ add)"
              className="text-xs leading-5"
            />
          </div>
        )}
        {(hasChips || title.trim()) && (
          <div className="text-muted-foreground flex min-h-7 flex-wrap items-center gap-1.5 border-t px-2.5 py-1 text-[11px]">
            {props.priority && (
              <Chip
                label={`Remove priority ${PRIORITY_LABEL[props.priority]}`}
                onRemove={() => setProps({ ...props, priority: undefined })}
              >
                <PriorityFlag priority={props.priority} className="size-3" />
                {PRIORITY_LABEL[props.priority]}
              </Chip>
            )}
            {props.due && (
              <Chip label="Remove due date" onRemove={() => setProps({ ...props, due: undefined })}>
                <CalendarDays aria-hidden className="size-3" />
                <DueText due={props.due} today={today} className="px-0" />
              </Chip>
            )}
            {props.tags.map((tag) => (
              <TagPill key={tag} tag={tag} onRemove={() => setProps({ ...props, tags: props.tags.filter((other) => other !== tag) })} />
            ))}
            <span className="ml-auto whitespace-nowrap">{description === null ? '⇧↵ description · ↵ add' : '↵ add'}</span>
          </div>
        )}
      </div>
      {add.error && <p className="text-destructive px-1 text-xs">Couldn’t add the Todo: {add.error.message}</p>}
    </div>
  )
}

function Chip({ label, onRemove, children }: { label: string; onRemove: () => void; children: React.ReactNode }) {
  return (
    <span className="bg-muted text-foreground inline-flex h-5 items-center gap-1 rounded-full pr-0.5 pl-1.5">
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={label}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-full outline-none focus-visible:ring-3"
      >
        <X className="size-3" />
      </button>
    </span>
  )
}
