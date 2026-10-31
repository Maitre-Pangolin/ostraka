// PROTOTYPE: GitLab MRs and Jira sprint overview for #10. Throw away.
import { cn } from '@/lib/utils'
import { ChevronDown, CircleCheck, CircleX, GitMerge, GitPullRequest, GitPullRequestArrow, Loader, MessageSquare, SquareKanban } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { MRS, PEOPLE, SPRINT, type MR, type SprintIssue } from './data'

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-1.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground', className)}>{children}</div>
}

const PIPE = {
  passed: <CircleCheck className="size-3.5 text-[var(--tag-3)]" />,
  failed: <CircleX className="size-3.5 text-destructive" />,
  running: <Loader className="size-3.5 animate-spin text-[var(--tag-5)]" />,
}

const isReady = (m: MR) => m.pipeline === 'passed' && m.approvals.split('/')[0] === m.approvals.split('/')[1]

function MRRow({ mr }: { mr: MR }) {
  // What needs me: reviewer and not yet approved by me, or author with a failure / ready to merge.
  const needsMe = mr.role === 'reviewer' ? !mr.approvedByMe : mr.pipeline === 'failed' || isReady(mr)
  return (
    <div className={cn('flex min-h-8 items-center gap-2 rounded-md px-1.5 text-sm hover:bg-muted/70', !needsMe && 'opacity-60')}>
      {PIPE[mr.pipeline]}
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">!{mr.iid}</span>
      <span className="min-w-0 flex-1 truncate">
        {mr.draft && <span className="mr-1 text-xs text-muted-foreground">Draft:</span>}
        {mr.title}
      </span>
      {mr.role === 'reviewer' && <span className="hidden shrink-0 text-xs text-muted-foreground @md:inline">{PEOPLE[mr.author]?.name.split(' ')[0]}</span>}
      {mr.threads > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
          <MessageSquare className="size-3" />
          {mr.threads}
        </span>
      )}
      {mr.approvedByMe ? (
        <span className="shrink-0 text-[11px] text-[var(--tag-3)]">approved</span>
      ) : mr.role === 'author' && isReady(mr) ? (
        <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground">
          <GitMerge className="size-3" /> ready
        </span>
      ) : (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{mr.approvals}</span>
      )}
      <span className="w-7 shrink-0 text-right text-[11px] text-muted-foreground">{mr.updated}</span>
    </div>
  )
}

export function MRList() {
  const groups = [
    { title: 'Reviewing', items: MRS.filter((m) => m.role === 'reviewer') },
    { title: 'Authored', items: MRS.filter((m) => m.role === 'author') },
  ]
  return (
    <div className="flex flex-col gap-2">
      {groups.map((g) => (
        <div key={g.title}>
          <SectionLabel>
            {g.title} <span className="font-normal">{g.items.length}</span>
          </SectionLabel>
          {g.items.map((m) => (
            <MRRow key={m.iid} mr={m} />
          ))}
        </div>
      ))}
    </div>
  )
}

const CATEGORY_DOT: Record<SprintIssue['category'], string> = {
  todo: 'bg-muted-foreground/40',
  doing: 'bg-[var(--tag-5)]',
  done: 'bg-[var(--tag-3)]',
}

export const sprintOpen = () => SPRINT.mine.filter((i) => i.category !== 'done').length

export function SprintSummary() {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 px-1.5">
        <span className="text-sm font-medium">{SPRINT.name}</span>
        <span className="text-xs text-muted-foreground">
          <b className="text-foreground">{sprintOpen()}</b> open · <b className="text-today">{SPRINT.daysLeft} days left</b>
        </span>
      </div>
      <div>
        {SPRINT.mine.map((i) => (
          <div key={i.key} className="flex min-h-7 items-center gap-2 rounded-md px-1.5 text-sm hover:bg-muted/70">
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{i.key}</span>
            <span className={cn('min-w-0 flex-1 truncate', i.category === 'done' && 'text-muted-foreground line-through')}>{i.title}</span>
            <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
              <span className={cn('size-1.5 rounded-full', CATEGORY_DOT[i.category], i.status === 'Blocked' && 'bg-destructive')} />
              {i.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function WorkStrip() {
  const [open, setOpen] = useState(false)
  const toReview = MRS.filter((m) => m.role === 'reviewer' && !m.approvedByMe).length
  const opened = MRS.filter((m) => m.role === 'author').length
  const failing = MRS.filter((m) => m.role === 'author' && m.pipeline === 'failed').length
  const stat = (icon: ReactNode, value: number, label: string, className?: string) => (
    <span className={cn('flex items-center gap-1', className)} title={label}>
      {icon}
      <b className="tabular-nums text-foreground">{value}</b>
      <span className="hidden @md:inline">{label}</span>
    </span>
  )
  return (
    <div className="shrink-0 border-b">
      <button type="button" onClick={() => setOpen(!open)} className="flex h-9 w-full items-center gap-3 bg-muted/40 px-3 text-xs text-muted-foreground hover:bg-muted">
        {stat(<GitPullRequest className="size-3.5" />, toReview, 'to review')}
        {stat(<GitPullRequestArrow className="size-3.5" />, opened, 'opened')}
        {stat(<CircleX className={cn('size-3.5', failing > 0 && 'text-destructive')} />, failing, 'failed', failing > 0 ? '[&_b]:text-destructive' : 'opacity-60')}
        <span className="h-3.5 w-px bg-border" />
        {stat(<SquareKanban className="size-3.5" />, sprintOpen(), 'open tickets')}
        <ChevronDown className={cn('ml-auto size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto bg-muted/20 p-2 @3xl:grid-cols-2">
          <section>
            <SectionLabel className="text-foreground/80">GitLab · open MRs</SectionLabel>
            <MRList />
          </section>
          <section>
            <SectionLabel className="text-foreground/80">Jira · my sprint</SectionLabel>
            <SprintSummary />
          </section>
        </div>
      )}
    </div>
  )
}
