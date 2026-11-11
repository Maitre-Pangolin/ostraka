import { IDEA_TAG, isBrokenNote, type NotesView as ViewState } from '@ostraka/core/note-schema'
import { normalizeTag } from '@ostraka/core/todo-tokens'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { ArrowLeft, Lightbulb, Plus, Tag, TriangleAlert } from 'lucide-react'
import { lazy, Suspense, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ApiError } from '@/lib/api'
import { SaveStatus } from '@/lib/save-status'
import { useAutosave, type SaveState } from '@/lib/use-autosave'
import { useAfter } from '@/lib/use-after'
import { cn } from '@/lib/utils'
import { FileHistory, HistoryButton } from '@/history/file-history'
import { useSectionSearch, type SearchHit } from '@/search/api'
import { useFindHighlight } from '@/search/find-highlight'
import { SectionSearch, Snippet } from '@/search/section-search'
import { useRememberOpened } from '@/search/recent'
import { EmptyState } from '@/shell/shell'
import { useTagNames } from '@/todos/api'
import { TagDot, TagPill } from '@/todos/properties'
import { saveNote, useCreateNote, useNote, useNotes, useUpdateNote, type Note, type NoteListing } from './api'

// Milkdown and CodeMirror load with the first open Note, not with the app.
import type { NoteEditorHandle } from './note-editor'
const NoteEditor = lazy(() => import('./note-editor').then((module) => ({ default: module.NoteEditor })))

const focusRing = 'outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

/**
 * The Notes view: the list (all Notes, or only the Ideas) beside the open Note, side by side from `@3xl` and one at
 * a time below. The open Note, the Ideas switch and the search box's text live in the URL; the search narrows the
 * list and is highlighted in the open Note.
 */
export function NotesView() {
  const view = useSearch({ from: '/notes' })
  const navigate = useNavigate({ from: '/notes' })
  const setView = (next: ViewState) => void navigate({ search: next, replace: true })
  const open = (note: string | undefined) => setView({ ...view, note })
  return (
    <div className="flex h-full min-h-0">
      <section
        aria-label={view.ideas ? 'Ideas' : 'Notes'}
        className={cn('min-h-0 w-full shrink-0 flex-col overflow-y-auto border-r @3xl:flex @3xl:w-72', view.note ? 'hidden' : 'flex')}
      >
        <NotesList
          ideas={view.ideas === true}
          openId={view.note}
          onOpen={open}
          onIdeas={(ideas) => setView({ ...view, ideas: ideas || undefined })}
          q={view.q}
          onSearch={(q) => setView({ ...view, q })}
        />
      </section>
      <section className={cn('min-h-0 min-w-0 flex-1 flex-col', view.note ? 'flex' : 'hidden @3xl:flex')}>
        {view.note ? (
          <>
            <button
              type="button"
              onClick={() => open(undefined)}
              className={cn(
                'text-muted-foreground hover:text-foreground flex h-8 shrink-0 items-center gap-1 border-b px-2 text-xs @3xl:hidden',
                focusRing,
              )}
            >
              <ArrowLeft className="size-3.5" /> All {view.ideas ? 'Ideas' : 'Notes'}
            </button>
            <NoteDetail key={view.note} id={view.note} find={view.q} />
          </>
        ) : (
          <EmptyState>Pick a Note on the left, or start one.</EmptyState>
        )}
      </section>
    </div>
  )
}

function NotesList({
  ideas,
  openId,
  onOpen,
  onIdeas,
  q,
  onSearch,
}: {
  ideas: boolean
  openId: string | undefined
  onOpen: (id: string) => void
  onIdeas: (ideas: boolean) => void
  q: string | undefined
  onSearch: (q: string | undefined) => void
}) {
  const notes = useNotes({ ideas })
  const search = useSectionSearch('note', q)
  const list = useFindHighlight(q)
  // A search keeps the list's own order; a broken file is never found.
  const shown = search.found ? notes.data?.filter((note) => search.found!.has(note.id)) : notes.data
  const create = useCreateNote()
  const slow = useAfter(300, notes.isPending)
  const start = () => create.mutate({ title: 'Untitled', tags: ideas ? [IDEA_TAG] : [] }, { onSuccess: (note) => onOpen(note.id) })
  return (
    <>
      <div className="bg-background sticky top-0 z-10 flex h-10 shrink-0 items-center gap-1.5 border-b px-2">
        <div role="group" aria-label="Show" className="bg-muted flex rounded-md p-0.5 text-xs">
          {([false, true] as const).map((option) => (
            <button
              key={String(option)}
              type="button"
              aria-pressed={ideas === option}
              onClick={() => onIdeas(option)}
              className={cn(
                'text-muted-foreground rounded px-2 leading-6',
                focusRing,
                ideas === option && 'bg-background text-foreground shadow-sm',
              )}
            >
              {option ? 'Ideas' : 'All Notes'}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={start} disabled={create.isPending}>
          <Plus /> {ideas ? 'New Idea' : 'New Note'}
        </Button>
      </div>
      <div className="border-b px-2 py-1.5">
        <SectionSearch value={q} onChange={onSearch} label={ideas ? 'Search Ideas' : 'Search Notes'} />
      </div>
      {search.indexing && <p className="text-muted-foreground px-3 py-2 text-xs">Indexing…</p>}
      {search.error && <p className="text-destructive px-3 py-2 text-xs">{search.error.message}</p>}
      {create.error && <p className="text-destructive px-3 py-1.5 text-xs">{create.error.message}</p>}
      {notes.error && <p className="text-destructive px-3 py-2 text-sm">{notes.error.message}</p>}
      {slow && <SkeletonRows />}
      {notes.data && !notes.data.length && (
        <EmptyState>
          {ideas ? 'No Ideas yet. Start one, or tag a Note #idea.' : 'No Notes yet. Start one to keep your thoughts.'}
        </EmptyState>
      )}
      {notes.data && notes.data.length > 0 && shown && !shown.length && (
        <EmptyState>{ideas ? 'No Ideas match this search.' : 'No Notes match this search.'} Try fewer or shorter words.</EmptyState>
      )}
      <ul ref={list} className="flex flex-col">
        {shown?.map((note) => (
          <li key={note.id}>
            <NoteRow note={note} hit={search.hits?.get(note.id)} active={note.id === openId} onOpen={() => onOpen(note.id)} />
          </li>
        ))}
      </ul>
    </>
  )
}

const changedOn = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

function NoteRow({ note, hit, active, onOpen }: { note: NoteListing; hit?: SearchHit; active: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active || undefined}
      className={cn(
        'hover:bg-muted/60 flex w-full min-w-0 flex-col gap-0.5 border-b px-3 py-2 text-left',
        focusRing,
        active && 'bg-accent',
      )}
    >
      {isBrokenNote(note) ? (
        <>
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <TriangleAlert aria-hidden className="text-destructive size-3.5 shrink-0" />
            <span className="truncate font-mono">notes/{note.id}.md</span>
          </span>
          <span className="text-destructive line-clamp-2 text-xs">{note.error}</span>
        </>
      ) : (
        <>
          <span className="truncate text-sm font-medium">{note.title}</span>
          {hit && <Snippet pieces={hit.snippet} />}
          <span className="text-muted-foreground flex min-w-0 items-center gap-1 overflow-hidden text-[11px]">
            <span className="shrink-0">{changedOn(note.modifiedAt)}</span>
            {note.tags.map((tag) => (
              <span key={tag} className="contents">
                <TagPill tag={tag} className="hidden h-4 text-[10px] @md:inline-flex" />
                <TagDot tag={tag} className="@md:hidden" />
              </span>
            ))}
          </span>
        </>
      )}
    </button>
  )
}

/**
 * One open Note. Typing saves after a pause, from the version the editor was loaded with; a save is refused if the
 * file changed elsewhere since, and the newer content is shown instead. A change made elsewhere while nothing is
 * waiting to be saved is shown straight away. Nothing is saved until the user edits.
 */
function NoteDetail({ id, find }: { id: string; find?: string }) {
  const query = useNote(id)
  useRememberOpened('note', id, query.data?.title)
  const [state, setState] = useState<SaveState>('saved')
  const [error, setError] = useState<string>()
  const [historyOpen, setHistoryOpen] = useState(false)
  const editor = useRef<NoteEditorHandle | null>(null)
  // The search's matches highlighted in the text, the first scrolled to on opening.
  const matches = useFindHighlight(find, id)
  const autosave = useAutosave({
    path: `notes/${id}.md`,
    query,
    update: useUpdateNote(id),
    textOf: (note: Note) => note.body,
    changeOf: (body) => ({ body }),
    saveOnClose: (change, version) => void saveNote(id, change, version, true),
    beforeFlush: () => editor.current?.flush(),
    onState: setState,
    onError: setError,
  })
  const { loaded } = autosave
  const note = query.data

  if (query.error) {
    return (
      <div className="flex flex-col gap-1 p-3 text-sm">
        <p className="text-destructive">{query.error.message}</p>
        {query.error instanceof ApiError && query.error.status === 409 && (
          <p className="text-muted-foreground">
            Fix the header in <span className="font-mono">notes/{id}.md</span>; the Note opens here once it reads.
          </p>
        )}
      </div>
    )
  }
  if (!note || !loaded) return null

  const setTags = (tags: string[]) => autosave.change({ tags })
  const isIdea = note.tags.includes(IDEA_TAG)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1">
        {note.tags.map((tag) => (
          <TagPill key={tag} tag={tag} onRemove={() => setTags(note.tags.filter((other) => other !== tag))} />
        ))}
        <TagAdder tags={note.tags} onAdd={(tag) => setTags([...note.tags, tag])} />
        <IconButton
          label={isIdea ? 'An Idea: click to make it a plain Note' : 'Make it an Idea'}
          pressed={isIdea}
          onClick={() => setTags(isIdea ? note.tags.filter((tag) => tag !== IDEA_TAG) : [...note.tags, IDEA_TAG])}
        >
          <Lightbulb />
        </IconButton>
        <span className="flex-1" />
        <SaveStatus state={state} />
        <span className="text-muted-foreground hidden truncate font-mono text-[11px] @md:inline">notes/{id}.md</span>
        <HistoryButton
          open={historyOpen}
          onClick={() => {
            // What is waiting is saved first, so the history and a restore start from it.
            if (!historyOpen) autosave.flush()
            setHistoryOpen(!historyOpen)
          }}
        />
      </div>
      {historyOpen && (
        <FileHistory path={`notes/${id}.md`} onClose={() => setHistoryOpen(false)} onRestored={() => setHistoryOpen(false)} />
      )}
      {error && !historyOpen && <p className="text-destructive border-b px-3 py-1.5 text-xs">{error}</p>}
      {/* Hidden, not unmounted, behind the history: the editor keeps what it shows. */}
      <div ref={matches} className={cn('min-h-0 flex-1 overflow-y-auto', historyOpen && 'hidden')}>
        <Suspense>
          <NoteEditor key={loaded.count} markdown={loaded.text} onEdit={autosave.onEdit} handle={editor} />
        </Suspense>
      </div>
    </div>
  )
}

export function IconButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string
  pressed?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={label}
            aria-pressed={pressed}
            onClick={onClick}
            className={cn('text-muted-foreground', pressed && 'text-primary')}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Adds a Tag to the open Note: a Popover with a field, existing Tags suggested first. */
export function TagAdder({ tags, onAdd }: { tags: string[]; onAdd: (tag: string) => void }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const known = useTagNames()
  const query = typed.trim().replace(/^#/, '').toLowerCase()
  const suggestions = known.filter((tag) => !tags.includes(tag) && tag.includes(query)).slice(0, 8)
  const fresh = normalizeTag(query)
  const offerNew = fresh !== undefined && !tags.includes(fresh) && !known.includes(fresh)
  const add = (tag: string) => {
    onAdd(tag)
    setTyped('')
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={(next) => (setOpen(next), next || setTyped(''))}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Add Tag"
            className={cn(
              'text-muted-foreground hover:bg-muted hover:text-foreground flex h-5 items-center gap-0.5 rounded-full border border-dashed px-1.5 text-[11px]',
              focusRing,
            )}
          />
        }
      >
        <Tag aria-hidden className="size-3" />
        <span className="hidden @md:inline">Tag</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 gap-0 p-1">
        <input
          autoFocus
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            const pick = suggestions.find((tag) => tag === query) ?? suggestions[0] ?? (offerNew ? fresh : undefined)
            if (pick) add(pick)
          }}
          aria-label="Tag"
          placeholder="Find or add a Tag"
          className="h-7 min-w-0 border-b bg-transparent px-2 text-sm outline-none"
        />
        <div className="flex max-h-64 flex-col overflow-y-auto pt-1">
          {suggestions.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => add(tag)}
              className={cn('hover:bg-muted flex h-8 shrink-0 items-center rounded-md px-2', focusRing)}
            >
              <TagPill tag={tag} />
            </button>
          ))}
          {offerNew && !suggestions.length && (
            <button
              type="button"
              onClick={() => add(fresh)}
              className={cn('hover:bg-muted flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm', focusRing)}
            >
              <Plus aria-hidden className="size-3.5" /> Add Tag <TagPill tag={fresh} />
            </button>
          )}
          {!suggestions.length && !offerNew && (
            <p className="text-muted-foreground px-2 py-2 text-xs">Type a Tag: lowercase, hyphenated.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function SkeletonRows() {
  return (
    <ul aria-label="Loading Notes" className="flex flex-col">
      {[60, 45, 70].map((width) => (
        <li key={width} className="flex flex-col gap-1.5 border-b px-3 py-2">
          <span className="bg-muted h-3 rounded" style={{ width: `${width}%` }} />
          <span className="bg-muted h-2 w-1/4 rounded" />
        </li>
      ))}
    </ul>
  )
}
