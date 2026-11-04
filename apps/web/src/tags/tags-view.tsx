// Tag management: every Tag in use with its colour and usage, to rename, merge, delete or colour. A rename, merge or
// delete rewrites every Todo, Note, Dev log and Sketch using the Tag, so it waits for a confirmation Dialog.
import { TAG_COLORS } from '@ostraka/core/tag-color'
import { normalizeTag } from '@ostraka/core/todo-tokens'
import { Merge, Pencil, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverDescription, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { useAfter } from '@/lib/use-after'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/shell/shell'
import { TagPill } from '@/todos/properties'
import { TAG_STYLES } from '@/todos/tag-styles'
import { useDeleteTag, useMergeTag, useRenameTag, useSetTagColor, useTagUsage, type TagColor, type TagCounts, type TagUsage } from './api'

const focusRing = 'outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
const ROW_ACTION =
  'text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:opacity-100 grid size-6 shrink-0 place-items-center rounded-md opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 ' +
  focusRing

const KINDS: [keyof TagCounts, string, string][] = [
  ['todos', 'Todo', 'Todos'],
  ['notes', 'Note', 'Notes'],
  ['devlogs', 'Dev log', 'Dev logs'],
  ['sketches', 'Sketch', 'Sketches'],
]

/** “3 Todos, 1 Note and 2 Dev logs”: the kinds with any, in a fixed order. */
function countsText(counts: TagCounts): string {
  const parts = KINDS.filter(([kind]) => counts[kind] > 0).map(([kind, one, many]) => `${counts[kind]} ${counts[kind] === 1 ? one : many}`)
  if (parts.length === 0) return 'nothing'
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

const total = (counts: TagCounts) => counts.todos + counts.notes + counts.devlogs + counts.sketches

/** A change waiting for its confirmation Dialog. */
type Pending =
  | { action: 'rename'; tag: TagUsage; to: string }
  | { action: 'merge'; tag: TagUsage; into: string }
  | { action: 'delete'; tag: TagUsage }

/** Tags: the shared vocabulary, with its colours and usage, and the changes that keep it clean. */
export function TagsView() {
  const { data: tags, error, isPending } = useTagUsage()
  const showSkeleton = useAfter(300, isPending)
  const [pending, setPending] = useState<Pending | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const rename = useRenameTag()
  const merge = useMergeTag()
  const remove = useDeleteTag()
  const setColor = useSetTagColor()

  const fail = (what: string) => (cause: Error) => setFailure(`Couldn’t ${what}: ${cause.message}`)

  const confirm = (change: Pending) => {
    setFailure(null)
    const name = change.tag.name
    if (change.action === 'rename') rename.mutate({ name, to: change.to }, { onError: fail(`rename #${name}`) })
    else if (change.action === 'merge') merge.mutate({ name, into: change.into }, { onError: fail(`merge #${name}`) })
    else remove.mutate(name, { onError: fail(`delete #${name}`) })
  }

  /** A rename onto a Tag in use is a merge, and the Dialog says so. */
  const requestRename = (tag: TagUsage, to: string) =>
    setPending(tags?.some((other) => other.name === to) ? { action: 'merge', tag, into: to } : { action: 'rename', tag, to })

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 p-3">
      <header className="flex flex-col gap-0.5">
        <h1 className="font-heading text-base font-semibold">Tags</h1>
        <p className="text-muted-foreground text-xs">
          Tags come from use. Renaming, merging or deleting one changes every Todo, Note, Dev log and Sketch using it.
        </p>
      </header>
      {failure && (
        <p role="alert" className="text-destructive text-sm wrap-anywhere">
          {failure}
        </p>
      )}
      {error ? (
        <p role="alert" className="text-destructive text-sm wrap-anywhere whitespace-pre-wrap">
          Couldn’t load the Tags: {error.message}
        </p>
      ) : isPending ? (
        showSkeleton && (
          <div aria-label="Loading Tags" className="flex flex-col gap-2">
            {[30, 45, 25, 40].map((width) => (
              <Skeleton key={width} className="h-6" style={{ width: `${width}%` }} />
            ))}
          </div>
        )
      ) : tags.length === 0 ? (
        <EmptyState>No Tags yet. Type #tag on a Todo, or add one to a Note or Sketch.</EmptyState>
      ) : (
        <ul aria-label="Tags" className="flex flex-col">
          {tags.map((tag) => (
            <TagRow
              key={tag.name}
              tag={tag}
              others={tags.filter((other) => other.name !== tag.name)}
              onColor={(color) => {
                setFailure(null)
                setColor.mutate({ name: tag.name, color }, { onError: fail(`colour #${tag.name}`) })
              }}
              onRename={(to) => requestRename(tag, to)}
              onMerge={(into) => setPending({ action: 'merge', tag, into })}
              onDelete={() => setPending({ action: 'delete', tag })}
            />
          ))}
        </ul>
      )}
      <TagChangeDialog
        pending={pending}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) confirm(pending)
          setPending(null)
        }}
      />
    </div>
  )
}

function TagRow({
  tag,
  others,
  onColor,
  onRename,
  onMerge,
  onDelete,
}: {
  tag: TagUsage
  others: TagUsage[]
  onColor: (color: TagColor | null) => void
  onRename: (to: string) => void
  onMerge: (into: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [typed, setTyped] = useState(tag.name)
  const [invalid, setInvalid] = useState<string | null>(null)

  const stopEditing = () => {
    setEditing(false)
    setTyped(tag.name)
    setInvalid(null)
  }

  const submit = () => {
    const to = normalizeTag(typed.trim().replace(/^#/, ''))
    if (to === undefined) return setInvalid(`“${typed}” isn’t a Tag: use lowercase letters, digits and hyphens.`)
    stopEditing()
    if (to !== tag.name) onRename(to)
  }

  return (
    <li className="group/row hover:bg-muted/40 flex flex-col rounded-md px-1.5 py-1">
      <div className="flex min-w-0 items-center gap-2">
        <ColorPicker tag={tag} onColor={onColor} />
        {editing ? (
          <form
            className="min-w-0 flex-1"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <Input
              autoFocus
              onFocus={(event) => event.target.select()}
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value)
                setInvalid(null)
              }}
              onKeyDown={(event) => event.key === 'Escape' && stopEditing()}
              onBlur={stopEditing}
              aria-label={`New name for #${tag.name}`}
              aria-invalid={invalid !== null}
              className="h-7 max-w-64"
            />
          </form>
        ) : (
          <TagPill tag={tag.name} />
        )}
        {!editing && (
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs" title={countsText(tag.uses)}>
            <span className="hidden @md:inline">{countsText(tag.uses)}</span>
            <span className="@md:hidden">{total(tag.uses)}</span>
          </span>
        )}
        <button type="button" aria-label={`Rename #${tag.name}`} title="Rename" className={ROW_ACTION} onClick={() => setEditing(true)}>
          <Pencil className="size-3.5" />
        </button>
        <MergePicker tag={tag} others={others} onMerge={onMerge} />
        <button type="button" aria-label={`Delete #${tag.name}`} title="Delete" className={ROW_ACTION} onClick={onDelete}>
          <Trash2 className="size-3.5" />
        </button>
      </div>
      {invalid && <p className="text-destructive pl-6 text-xs">{invalid}</p>}
    </li>
  )
}

/** The Tag's colour as a swatch, opening a Popover of the eight colours and the default one. */
function ColorPicker({ tag, onColor }: { tag: TagUsage; onColor: (color: TagColor | null) => void }) {
  const [open, setOpen] = useState(false)
  const pick = (color: TagColor | null) => {
    onColor(color)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Colour of #${tag.name}: ${tag.color}`}
        className={cn('grid size-5 shrink-0 place-items-center rounded-full', focusRing)}
      >
        <span className={cn('size-3 rounded-full', TAG_STYLES[tag.color].dot)} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto gap-2 p-2">
        <PopoverDescription className="text-xs">Colour of #{tag.name}</PopoverDescription>
        <div className="grid grid-cols-4 gap-1">
          {TAG_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              aria-pressed={color === tag.color}
              title={color}
              onClick={() => pick(color)}
              className={cn(
                'hover:bg-muted grid size-7 place-items-center rounded-md aria-pressed:ring-2 aria-pressed:ring-ring',
                focusRing,
              )}
            >
              <span className={cn('size-4 rounded-full', TAG_STYLES[color].dot)} />
            </button>
          ))}
        </div>
        <Button variant="ghost" size="xs" onClick={() => pick(null)}>
          Default colour
        </Button>
      </PopoverContent>
    </Popover>
  )
}

const SEARCH_PAST = 6

/** “Merge into…”: the other Tags in a Popover, with a search field past six. */
function MergePicker({ tag, others, onMerge }: { tag: TagUsage; others: TagUsage[]; onMerge: (into: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchable = others.length > SEARCH_PAST
  const shown = searchable ? others.filter((other) => other.name.includes(query.trim().toLowerCase().replace(/^#/, ''))) : others
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <PopoverTrigger aria-label={`Merge #${tag.name} into another Tag`} title="Merge into…" className={ROW_ACTION}>
        <Merge className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 gap-1 p-1">
        <PopoverDescription className="px-2 pt-1 text-xs">Merge #{tag.name} into…</PopoverDescription>
        {searchable && (
          <label className="flex items-center gap-1.5 border-b px-2 pb-1">
            <Search aria-hidden className="text-muted-foreground size-3.5" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Find a Tag"
              placeholder="Find a Tag"
              className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
        )}
        <div className="flex max-h-64 flex-col overflow-y-auto">
          {shown.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1 text-xs">{others.length ? 'No Tag matches.' : 'No other Tag to merge into.'}</p>
          ) : (
            shown.map((other) => (
              <button
                key={other.name}
                type="button"
                onClick={() => {
                  setOpen(false)
                  onMerge(other.name)
                }}
                className={cn('hover:bg-muted flex items-center rounded-sm px-2 py-1 text-left', focusRing)}
              >
                <TagPill tag={other.name} />
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Confirms a rename, merge or delete: what changes, where, and how to undo it. */
function TagChangeDialog({ pending, onCancel, onConfirm }: { pending: Pending | null; onCancel: () => void; onConfirm: () => void }) {
  // Kept while the Dialog closes, so its text doesn't vanish mid-animation.
  const [shown, setShown] = useState(pending)
  if (pending && pending !== shown) setShown(pending)
  if (!shown) return null
  const name = shown.tag.name
  const where = countsText(shown.tag.uses)
  const text =
    shown.action === 'rename'
      ? {
          title: `Rename #${name} to #${shown.to}?`,
          description: `${where} will be tagged #${shown.to} instead, all at once, in the same colour. To undo, rename #${shown.to} back to #${name}.`,
          action: 'Rename',
        }
      : shown.action === 'merge'
        ? {
            title: `Merge #${name} into #${shown.into}?`,
            description: `${where} tagged #${name} will be tagged #${shown.into} instead, which keeps its colour. To undo, restore the files from their History.`,
            action: 'Merge',
          }
        : {
            title: `Delete #${name}?`,
            description: `It comes off ${where}, and its colour is forgotten. To undo, restore the files from their History.`,
            action: 'Delete',
          }
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>{text.description.charAt(0).toUpperCase() + text.description.slice(1)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button autoFocus variant={shown.action === 'delete' ? 'destructive' : 'default'} onClick={onConfirm}>
            {text.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
