// PROTOTYPE: app shell for #10 — layout A (focus list + work strip) inside C's side rail. Throw away.
import { cn } from '@/lib/utils'
import { BookText, CheckSquare, ChevronDown, LayoutDashboard, Lightbulb, Settings, Shapes } from 'lucide-react'
import { useState } from 'react'
import { CONFIG, MRS } from './data'
import { DevLogsView, NotesView, SketchesView } from './docs'
import { useStore } from './store'
import { FilterBar, ListToolbar, QuickEntry, TodoList } from './todos'
import { MRList, SectionLabel, SprintSummary, WorkStrip, sprintOpen } from './work'

export type View = 'todos' | 'notes' | 'devlogs' | 'sketches' | 'work' | 'settings'

const RAIL: { view: View; icon: typeof CheckSquare; label: string }[] = [
  { view: 'todos', icon: CheckSquare, label: 'Todos' },
  { view: 'notes', icon: Lightbulb, label: 'Notes' },
  { view: 'devlogs', icon: BookText, label: 'Dev logs' },
  { view: 'sketches', icon: Shapes, label: 'Sketches' },
  { view: 'work', icon: LayoutDashboard, label: 'Work' },
]

function Rail({ view, setView }: { view: View; setView: (v: View) => void }) {
  const { todos } = useStore()
  const badge: Partial<Record<View, number>> = {
    todos: todos.filter((t) => t.status === 'open').length,
    work: MRS.filter((m) => m.role === 'reviewer' && !m.approvedByMe).length,
  }
  const item = ({ view: v, icon: Icon, label }: (typeof RAIL)[number]) => (
    <button
      key={v}
      type="button"
      title={label}
      onClick={() => setView(v)}
      className={cn('relative grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground', view === v && 'bg-background text-primary shadow-xs ring-1 ring-border')}
    >
      <Icon className="size-4" />
      {badge[v] ? <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-muted px-1 text-center text-[9px] font-semibold leading-4 text-muted-foreground ring-2 ring-background">{badge[v]}</span> : null}
    </button>
  )
  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r bg-muted/40 py-2">
      <span className="mb-2 grid size-7 place-items-center rounded-lg bg-primary font-heading text-sm font-bold text-primary-foreground">o</span>
      {RAIL.map(item)}
      <span className="flex-1" />
      {item({ view: 'settings', icon: Settings, label: 'Settings' })}
    </nav>
  )
}

function TodosView() {
  const { todos } = useStore()
  const [showFinished, setShowFinished] = useState(false)
  const open = todos.filter((t) => t.status === 'open').length
  return (
    <div className="flex h-full flex-col">
      <WorkStrip />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-1.5 p-3">
          <QuickEntry autoFocus />
          <FilterBar />
          <ListToolbar count={open} />
          <TodoList empty="No open Todos match. Enjoy it." />
          <button type="button" onClick={() => setShowFinished(!showFinished)} className="mt-2 flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn('size-3.5 transition-transform', !showFinished && '-rotate-90')} />
            Done & Dropped ({todos.length - open})
          </button>
          {showFinished && <TodoList statuses={['done', 'dropped']} />}
        </div>
      </div>
    </div>
  )
}

function WorkView() {
  return (
    <div className="h-full overflow-y-auto p-2">
      <div className="grid gap-4 @3xl:grid-cols-2">
        <section>
          <SectionLabel className="text-foreground/80">GitLab · open MRs ({MRS.length})</SectionLabel>
          <MRList />
        </section>
        <section>
          <SectionLabel className="text-foreground/80">Jira · my sprint tickets ({sprintOpen()} open)</SectionLabel>
          <SprintSummary />
        </section>
      </div>
    </div>
  )
}

function SettingsView() {
  const field = (label: string, value: string, hint?: string) => (
    <label className="flex flex-col gap-0.5">
      <span className="text-xs font-medium">{label}</span>
      <input defaultValue={value} className="h-8 rounded-md border bg-card px-2 text-sm outline-none focus:border-ring" />
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  )
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto flex max-w-lg flex-col gap-5">
        <p className="text-xs text-muted-foreground">
          Stored in <code className="rounded bg-muted px-1">~/.config/ostraka/config.yml</code>. Tokens are not here: they live in the macOS Keychain.
        </p>
        <section className="flex flex-col gap-2">
          <SectionLabel className="px-0">Content</SectionLabel>
          {field('Content folder', CONFIG.contentDir, 'Overridden by OSTRAKA_HOME.')}
        </section>
        <section className="flex flex-col gap-2">
          <SectionLabel className="px-0">GitLab</SectionLabel>
          {field('Host', CONFIG.gitlab.host, 'Shows every open MR where you are author or reviewer.')}
        </section>
        <section className="flex flex-col gap-2">
          <SectionLabel className="px-0">Jira</SectionLabel>
          {field('Site', CONFIG.jira.site)}
          {field('Board', CONFIG.jira.board, "The board's active sprint is the one shown.")}
          {field('My tickets (JQL)', CONFIG.jira.mine)}
        </section>
      </div>
    </div>
  )
}

export function Shell({ view, setView, dark }: { view: View; setView: (v: View) => void; dark: boolean }) {
  return (
    <div className="flex h-full">
      <Rail view={view} setView={setView} />
      <div className="@container min-w-0 flex-1">
        {view === 'todos' && <TodosView />}
        {view === 'notes' && <NotesView />}
        {view === 'devlogs' && <DevLogsView />}
        {view === 'sketches' && <SketchesView dark={dark} />}
        {view === 'work' && <WorkView />}
        {view === 'settings' && <SettingsView />}
      </div>
    </div>
  )
}
