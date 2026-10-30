// PROTOTYPE: three structurally different half-screen layouts for #10. Throw away.
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  BookText,
  CheckSquare,
  ChevronDown,
  CircleX,
  GitPullRequest,
  LayoutDashboard,
  NotebookPen,
  Shapes,
  Lightbulb,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { SPRINT } from './data'
import {
  MRList,
  NoteCapture,
  QuickEntry,
  SectionLabel,
  SprintSummary,
  TagFilterBar,
  TodoList,
  openCount,
  overdueCount,
  useStore,
  workCounts,
} from './parts'

const Header = ({ children }: { children?: ReactNode }) => (
  <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
    <span className="font-heading text-[15px] font-semibold tracking-tight text-primary">ostraka</span>
    <span className="text-xs text-muted-foreground">Fri 30 Oct</span>
    <span className="flex-1" />
    {children}
  </header>
)

// ---------------------------------------------------------------- A: one column, work as a strip

export function VariantA() {
  const { todos } = useStore()
  const [workOpen, setWorkOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [showFinished, setShowFinished] = useState(false)
  const w = workCounts()
  return (
    <div className="flex h-full flex-col">
      <Header>
        <Button size="sm" variant={noteOpen ? 'secondary' : 'ghost'} onClick={() => setNoteOpen(!noteOpen)}>
          <NotebookPen /> Note
        </Button>
      </Header>
      {/* work strip */}
      <button
        type="button"
        onClick={() => setWorkOpen(!workOpen)}
        className="flex h-9 shrink-0 items-center gap-3 border-b bg-muted/40 px-3 text-xs text-muted-foreground hover:bg-muted"
      >
        <span className="flex items-center gap-1">
          <GitPullRequest className="size-3.5" />
          <b className="text-foreground">{w.toReview}</b> to review
        </span>
        {w.failing > 0 && (
          <span className="flex items-center gap-1 text-destructive">
            <CircleX className="size-3.5" />
            {w.failing} failing
          </span>
        )}
        <span className="hidden @sm:inline">
          {SPRINT.name} · <b className="text-today">{SPRINT.daysLeft}d left</b>
        </span>
        <ChevronDown className={cn('ml-auto size-3.5 transition-transform', workOpen && 'rotate-180')} />
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {workOpen && (
          <div className="grid gap-3 border-b bg-muted/20 p-3 @3xl:grid-cols-2">
            <MRList />
            <SprintSummary />
          </div>
        )}
        <div className="mx-auto flex max-w-3xl flex-col gap-2 p-3">
          {noteOpen && (
            <div className="rounded-lg border bg-card p-2">
              <NoteCapture compact onSaved={() => setNoteOpen(false)} />
            </div>
          )}
          <QuickEntry autoFocus />
          <TagFilterBar />
          <TodoList empty="No open Todos match. Enjoy it." />
          <button
            type="button"
            onClick={() => setShowFinished(!showFinished)}
            className="mt-2 flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn('size-3.5 transition-transform', !showFinished && '-rotate-90')} />
            Done & Dropped ({todos.length - openCount(todos)})
          </button>
          {showFinished && <TodoList statuses={['done', 'dropped']} />}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- B: tabs, one job at a time, entry at the bottom

export function VariantB() {
  const { todos } = useStore()
  const [tab, setTab] = useState('todos')
  const [view, setView] = useState<'open' | 'done' | 'dropped'>('open')
  const w = workCounts()
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as string)} className="flex h-full flex-col gap-0">
      <Header>
        <TabsList className="h-8">
          <TabsTrigger value="todos" className="px-2 text-xs">
            <CheckSquare /> Todos <span className="tabular-nums text-muted-foreground">{openCount(todos)}</span>
          </TabsTrigger>
          <TabsTrigger value="note" className="px-2 text-xs">
            <NotebookPen /> Note
          </TabsTrigger>
          <TabsTrigger value="work" className="px-2 text-xs">
            <GitPullRequest /> Work
            {w.toReview + w.failing > 0 && <Badge className="h-4 min-w-4 px-1 text-[10px]">{w.toReview + w.failing}</Badge>}
          </TabsTrigger>
        </TabsList>
      </Header>
      <TabsContent value="todos" className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
          <div className="flex shrink-0 rounded-md bg-muted p-0.5 text-xs">
            {(['open', 'done', 'dropped'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setView(s)}
                className={cn('rounded px-2 py-0.5 capitalize text-muted-foreground', view === s && 'bg-background text-foreground shadow-sm')}
              >
                {s}
              </button>
            ))}
          </div>
          <TagFilterBar className="min-w-0 flex-1" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          <TodoList statuses={[view]} />
        </div>
        <div className="shrink-0 border-t bg-muted/30 p-2">
          <QuickEntry autoFocus />
        </div>
      </TabsContent>
      <TabsContent value="note" className="min-h-0 flex-1 overflow-y-auto p-3">
        <NoteCapture />
      </TabsContent>
      <TabsContent value="work" className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="grid gap-4 @3xl:grid-cols-2">
          <MRList />
          <SprintSummary />
        </div>
      </TabsContent>
    </Tabs>
  )
}

// ---------------------------------------------------------------- C: icon rail + panes that stack when narrow

const RAIL = [
  { icon: CheckSquare, label: 'Todos', active: true },
  { icon: Lightbulb, label: 'Notes' },
  { icon: BookText, label: 'Dev logs' },
  { icon: Shapes, label: 'Sketches' },
  { icon: LayoutDashboard, label: 'Work' },
]

const Pane = ({ title, children, right, className }: { title: string; children: ReactNode; right?: ReactNode; className?: string }) => (
  <section className={cn('rounded-xl border bg-card p-2 shadow-xs', className)}>
    <div className="flex items-center gap-2">
      <SectionLabel className="text-foreground/80">{title}</SectionLabel>
      <span className="flex-1" />
      {right}
    </div>
    {children}
  </section>
)

export function VariantC() {
  const { todos } = useStore()
  const [showFinished, setShowFinished] = useState(false)
  const w = workCounts()
  const overdue = overdueCount(todos)
  return (
    <div className="flex h-full">
      <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r bg-muted/40 py-2">
        <span className="mb-2 grid size-7 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">o</span>
        {RAIL.map(({ icon: Icon, label, active }) => (
          <button
            key={label}
            type="button"
            title={label}
            className={cn('grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground', active && 'bg-background text-primary shadow-xs')}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </nav>
      <div className="@container min-w-0 flex-1 overflow-y-auto bg-muted/20">
        <div className="grid gap-2 p-2 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] @3xl:items-start">
          {/* glance cards: always first, one row */}
          <div className="grid grid-cols-3 gap-2 @3xl:col-span-2">
            {[
              { n: overdue, label: 'overdue', tone: overdue ? 'text-destructive' : '' },
              { n: w.toReview, label: 'MRs to review', tone: '' },
              { n: SPRINT.daysLeft, label: 'sprint days left', tone: 'text-today' },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border bg-card px-2.5 py-1.5">
                <div className={cn('text-lg font-semibold tabular-nums leading-tight', c.tone)}>{c.n}</div>
                <div className="truncate text-[11px] text-muted-foreground">{c.label}</div>
              </div>
            ))}
          </div>
          <Pane
            title="Todos"
            right={
              <button type="button" onClick={() => setShowFinished(!showFinished)} className="text-[11px] text-muted-foreground hover:text-foreground">
                {showFinished ? 'show open' : 'done & dropped'}
              </button>
            }
          >
            <div className="flex flex-col gap-1.5 px-1 pb-1">
              {!showFinished && <QuickEntry autoFocus />}
              <TagFilterBar />
            </div>
            <TodoList statuses={showFinished ? ['done', 'dropped'] : ['open']} />
          </Pane>
          <div className="flex flex-col gap-2">
            <Pane title="Quick Note">
              <div className="px-1 pb-1">
                <NoteCapture compact />
              </div>
            </Pane>
            <Pane title="Merge requests">
              <MRList />
            </Pane>
            <Pane title="Sprint">
              <SprintSummary />
            </Pane>
          </div>
        </div>
      </div>
    </div>
  )
}

export const VARIANTS = [
  { key: 'A', name: 'Focus list + work strip', C: VariantA },
  { key: 'B', name: 'Tabs, entry at bottom', C: VariantB },
  { key: 'C', name: 'Rail + stacking panes', C: VariantC },
]
