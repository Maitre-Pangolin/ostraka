// The top bar's work overview: GitLab and Jira counts that expand in place to the MRs and the sprint, and a chip for
// each failing source.
import { format, formatDistanceToNowStrict } from 'date-fns'
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  GitPullRequest,
  GitPullRequestArrow,
  LoaderCircle,
  Ticket,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAfter } from '@/lib/use-after'
import { cn } from '@/lib/utils'
import { CATEGORY_DOT } from '@/references/status'
import {
  SOURCE_LABEL,
  useActivity,
  useWorkSources,
  type GitLabOverview,
  type JiraOverview,
  type JiraTicket,
  type MergeRequest,
  type PipelineStatus,
  type SourceStatus,
} from './api'

export const WORK_DETAILS_ID = 'work-details'

/** One count with its icon; below `@md` the label hides and a Tooltip carries it. */
function Stat({ icon: Icon, value, label, alert }: { icon: LucideIcon; value: number; label: string; alert?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span />} className={cn('flex items-center gap-1', alert ? 'text-destructive' : value === 0 && 'opacity-60')}>
        <Icon className="size-3.5" />
        <b className={cn('tabular-nums', !alert && 'text-foreground')}>{value}</b>
        <span className="hidden @md:inline">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** A source's numbers in the bar. While it is failing they stay, marked stale (muted, and said so to screen readers). */
function Counts({ stale, children }: { stale: boolean; children: ReactNode }) {
  return (
    <span data-stale={stale || undefined} className={cn('flex items-center gap-3', stale && 'italic opacity-50')}>
      {children}
      {stale && <span className="sr-only">(stale)</span>}
    </span>
  )
}

/** What the bar shows for a source without numbers yet: not set up, loading, or just its name. */
function NoCounts({ source, label, showSkeleton }: { source: SourceStatus | undefined; label: string; showSkeleton: boolean }) {
  if (source?.state === 'off') return <span className="truncate">{label} not set up</span>
  if (!source || source.state === 'loading') return showSkeleton ? <Skeleton aria-label={`Loading ${label}`} className="h-3 w-16" /> : null
  return <span>{label}</span>
}

/** MRs to review · MRs opened · failed pipelines | open Jira tickets. Clicking expands the MRs and the sprint in place. */
export function WorkCounts({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { gitlab, jira, isPending } = useWorkSources()
  const showSkeleton = useAfter(300, isPending)
  const mrs = gitlab?.data?.counts
  const tickets = jira?.data?.counts
  const label = [
    mrs && `GitLab: ${mrs.toReview} to review, ${mrs.opened} opened, ${mrs.failedPipelines} failed${gitlab?.stale ? ' (stale)' : ''}`,
    tickets && `Jira: ${tickets.open} open tickets${jira?.stale ? ' (stale)' : ''}`,
  ]
    .filter(Boolean)
    .join('; ')

  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={WORK_DETAILS_ID}
      aria-label={label || undefined}
      onClick={onToggle}
      className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 -mx-1.5 flex h-7 min-w-0 shrink-0 items-center gap-2 rounded-md px-1.5 outline-none focus-visible:ring-3"
    >
      {mrs ? (
        <Counts stale={gitlab?.stale ?? false}>
          <Stat icon={GitPullRequest} value={mrs.toReview} label="to review" />
          <Stat icon={GitPullRequestArrow} value={mrs.opened} label="opened" />
          <Stat icon={CircleX} value={mrs.failedPipelines} label="failed" alert={mrs.failedPipelines > 0} />
        </Counts>
      ) : (
        <NoCounts source={gitlab} label="GitLab" showSkeleton={showSkeleton} />
      )}
      <span aria-hidden className="bg-border h-3.5 w-px shrink-0" />
      {tickets ? (
        <Counts stale={jira?.stale ?? false}>
          <Stat icon={Ticket} value={tickets.open} label="open tickets" />
        </Counts>
      ) : (
        <NoCounts source={jira} label="Jira" showSkeleton={showSkeleton} />
      )}
      <ChevronDown className={cn('size-3.5 shrink-0 transition-transform motion-reduce:transition-none', expanded && 'rotate-180')} />
    </button>
  )
}

/** A chip per failing Activity source, with its reason; the Tooltip adds when its data was last fresh. */
export function SourceChips() {
  const { data, error } = useActivity()
  if (error) {
    return <span className="text-destructive min-w-0 truncate">Work overview unavailable: {error.message}</span>
  }
  return (data?.sources ?? [])
    .filter((source) => source.state === 'failing')
    .map((source) => <SourceChip key={source.source} source={source} />)
}

function SourceChip({ source }: { source: SourceStatus }) {
  const label = SOURCE_LABEL[source.source] ?? source.source
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span role="status" tabIndex={0} />}
        className="border-destructive/40 text-destructive focus-visible:ring-ring/50 flex h-5.5 min-w-0 items-center gap-1 rounded-full border px-2 outline-none focus-visible:ring-3"
      >
        <CircleAlert className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{source.reason?.startsWith(label) ? source.reason : `${label}: ${source.reason}`}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-80">
        {source.reason}
        {source.updatedAt ? ` Numbers are from ${format(source.updatedAt, 'HH:mm')}.` : ''}
      </TooltipContent>
    </Tooltip>
  )
}

const PIPELINE: Record<string, { icon: LucideIcon; label: string; className: string }> = {
  success: { icon: CircleCheck, label: 'Pipeline passed', className: 'text-success' },
  failed: { icon: CircleX, label: 'Pipeline failed', className: 'text-destructive' },
  running: { icon: LoaderCircle, label: 'Pipeline running', className: 'text-primary motion-safe:animate-spin' },
  canceled: { icon: CircleSlash, label: 'Pipeline canceled', className: 'text-muted-foreground' },
  skipped: { icon: CircleSlash, label: 'Pipeline skipped', className: 'text-muted-foreground' },
}
const WAITING = { icon: CircleDashed, label: 'Pipeline waiting', className: 'text-muted-foreground' }

function PipelineIcon({ status }: { status?: PipelineStatus }) {
  if (!status) return <span aria-label="No pipeline" className="size-3.5 shrink-0" />
  const { icon: Icon, label, className } = PIPELINE[status] ?? { ...WAITING, label: `Pipeline ${status.replaceAll('_', ' ')}` }
  return (
    <Tooltip>
      <TooltipTrigger render={<span />} aria-label={label} className="flex shrink-0">
        <Icon className={cn('size-3.5', className)} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function MrRow({ mr, showAuthor }: { mr: MergeRequest; showAuthor?: boolean }) {
  return (
    <li>
      <a
        href={mr.url}
        target="_blank"
        rel="noreferrer"
        className={cn(
          'hover:bg-muted/70 focus-visible:ring-ring/50 flex min-h-8 min-w-0 items-center gap-2 rounded-md px-1.5 text-sm outline-none focus-visible:ring-3',
          mr.approvedByMe && 'opacity-60',
        )}
      >
        <PipelineIcon status={mr.pipeline?.status} />
        <span className="text-muted-foreground hidden shrink-0 text-xs tabular-nums @md:inline">{mr.reference}</span>
        <span className="min-w-0 flex-1 truncate">
          {mr.draft && <span className="text-muted-foreground mr-1 text-xs">Draft:</span>}
          {mr.title}
        </span>
        {showAuthor && <span className="text-muted-foreground hidden shrink-0 text-xs @md:inline">{mr.author}</span>}
        {mr.approvedByMe && <span className="text-success shrink-0 text-xs">approved</span>}
        <span className="text-muted-foreground hidden w-8 shrink-0 text-right text-xs @md:inline">
          {formatDistanceToNowStrict(mr.updatedAt).replace(/ (\w)\w*$/, '$1')}
        </span>
      </a>
    </li>
  )
}

function MrGroup({ title, items, empty, showAuthor }: { title: string; items: MergeRequest[]; empty: string; showAuthor?: boolean }) {
  return (
    <div>
      <h3 className="text-muted-foreground px-1.5 pt-1 pb-0.5 text-xs font-medium">
        {title} <span className="font-normal tabular-nums">{items.length}</span>
      </h3>
      {items.length ? (
        <ul>
          {items.map((mr) => (
            <MrRow key={mr.reference} mr={mr} showAuthor={showAuthor} />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground px-1.5 text-sm">{empty}</p>
      )}
    </div>
  )
}

/** One source's part of the expanded bar: its title, when its data is from, then its body. */
function SourceSection({
  id,
  title,
  source,
  children,
}: {
  id: string
  title: string
  source: SourceStatus | undefined
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-1">
      <h2 id={id} className="flex items-baseline justify-between gap-2 px-1.5 text-xs font-semibold">
        <span className="min-w-0 truncate">{title}</span>
        {source?.updatedAt && (
          <span className={cn('text-muted-foreground shrink-0 font-normal', source.stale && 'text-destructive')}>
            {source.stale ? 'Stale, from' : 'Updated'} {format(source.updatedAt, 'HH:mm')}
          </span>
        )}
      </h2>
      {children}
    </section>
  )
}

/** The body of a source without data: why it is off (and how to set it up) or failing, or skeleton rows while it loads. */
function NoData({ source, label, setUp }: { source: SourceStatus | undefined; label: string; setUp: string }) {
  if (source?.state === 'off') {
    return (
      <p className="text-muted-foreground px-1.5 text-sm">
        {source.reason} {setUp}
      </p>
    )
  }
  if (source?.state === 'failing') return <p className="text-destructive px-1.5 text-sm wrap-anywhere">{source.reason}</p>
  return (
    <div aria-label={`Loading ${label}`} className="flex flex-col gap-2 p-1.5">
      {[60, 45, 70].map((width) => (
        <Skeleton key={width} className="h-4" style={{ width: `${width}%` }} />
      ))}
    </div>
  )
}

/** The expanded GitLab section: MRs I review, then MRs I opened, each with its head pipeline. */
function GitLabDetails({ gitlab }: { gitlab: SourceStatus<GitLabOverview> | undefined }) {
  return (
    <SourceSection id="work-gitlab" title="GitLab · open MRs" source={gitlab}>
      {gitlab?.data ? (
        <>
          <MrGroup title="Reviewing" items={gitlab.data.reviewing} empty="No MRs waiting for your review." showAuthor />
          <MrGroup title="Authored" items={gitlab.data.authored} empty="No open MRs of yours." />
        </>
      ) : (
        <NoData
          source={gitlab}
          label="GitLab"
          setUp="Set gitlab.base_url in config.yml and add the ostraka-gitlab Keychain item (see the README)."
        />
      )}
    </SourceSection>
  )
}

function TicketRow({ ticket }: { ticket: JiraTicket }) {
  const className = cn(
    'flex min-h-8 min-w-0 items-center gap-2 rounded-md px-1.5 text-sm',
    ticket.url && 'hover:bg-muted/70 focus-visible:ring-ring/50 outline-none focus-visible:ring-3',
    ticket.category === 'done' && 'opacity-60',
  )
  const content = (
    <>
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', CATEGORY_DOT[ticket.category])} />
      <span className="text-muted-foreground hidden shrink-0 text-xs tabular-nums @md:inline">{ticket.key}</span>
      <span className="min-w-0 flex-1 truncate">{ticket.summary}</span>
      <span className="text-muted-foreground max-w-[40%] shrink-0 truncate text-xs">{ticket.status}</span>
    </>
  )
  return (
    <li>
      {ticket.url ? (
        <a href={ticket.url} target="_blank" rel="noreferrer" title={ticket.key} className={className}>
          {content}
        </a>
      ) : (
        <div title={ticket.key} className={className}>
          {content}
        </div>
      )}
    </li>
  )
}

/** Days left in the sprint, today included. */
function daysLeftText(daysLeft: number) {
  if (daysLeft === 0) return 'ended'
  return daysLeft === 1 ? 'last day' : `${daysLeft} days left`
}

/** The expanded sprint: open count and days left, then each of my tickets with a status dot and its real Jira status. */
function JiraDetails({ jira }: { jira: SourceStatus<JiraOverview> | undefined }) {
  const data = jira?.data
  const sprint = data?.sprint
  return (
    <SourceSection id="work-jira" title={sprint ? `Jira · ${sprint.name}` : 'Jira · sprint'} source={jira}>
      {data ? (
        <>
          <p className="text-muted-foreground px-1.5 pt-1 pb-0.5 text-xs">
            <b className="text-foreground font-medium tabular-nums">{data.counts.open}</b> open
            {sprint?.daysLeft !== undefined && (
              <span title={sprint.endDate && `Ends ${format(sprint.endDate, 'EEE d MMM, HH:mm')}`}>
                {' · '}
                {daysLeftText(sprint.daysLeft)}
              </span>
            )}
          </p>
          {data.tickets.length ? (
            <ul>
              {data.tickets.map((ticket) => (
                <TicketRow key={ticket.key} ticket={ticket} />
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground px-1.5 text-sm">No tickets of yours in an open sprint.</p>
          )}
        </>
      ) : (
        <NoData
          source={jira}
          label="Jira"
          setUp="Set jira.cloud_id and jira.email in config.yml and add the ostraka-jira Keychain item (see the README)."
        />
      )}
    </SourceSection>
  )
}

/** What the top bar expands to, in place: one section per Activity source. */
export function WorkDetails() {
  const { gitlab, jira } = useWorkSources()
  return (
    <div id={WORK_DETAILS_ID} className="grid max-h-[60vh] gap-3 overflow-y-auto border-t p-2 @3xl:grid-cols-2">
      <GitLabDetails gitlab={gitlab} />
      <JiraDetails jira={jira} />
    </div>
  )
}
