// The top bar's work overview: GitLab counts that expand in place to the MRs, and a chip for each failing source.
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
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAfter } from '@/lib/use-after'
import { cn } from '@/lib/utils'
import { SOURCE_LABEL, useActivity, useGitLab, type GitLabOverview, type MergeRequest, type PipelineStatus, type SourceStatus } from './api'

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

/**
 * MRs to review · MRs opened · failed pipelines. Clicking expands the MRs in place. While GitLab is failing, the
 * last numbers stay but are marked stale (muted, and said so to screen readers).
 */
export function WorkCounts({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { gitlab, isPending } = useGitLab()
  const showSkeleton = useAfter(300, isPending)
  const counts = gitlab?.data?.counts
  const stale = gitlab?.stale ?? false

  let content: ReactNode
  if (counts) {
    content = (
      <span data-stale={stale || undefined} className={cn('flex items-center gap-3', stale && 'italic opacity-50')}>
        <Stat icon={GitPullRequest} value={counts.toReview} label="to review" />
        <Stat icon={GitPullRequestArrow} value={counts.opened} label="opened" />
        <Stat icon={CircleX} value={counts.failedPipelines} label="failed" alert={counts.failedPipelines > 0} />
        {stale && <span className="sr-only">(stale)</span>}
      </span>
    )
  } else if (gitlab?.state === 'off') {
    content = <span>GitLab not set up</span>
  } else if (isPending || gitlab?.state === 'loading') {
    content = showSkeleton ? <Skeleton aria-label="Loading GitLab" className="h-3 w-32" /> : null
  } else {
    content = <span>GitLab</span>
  }

  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={WORK_DETAILS_ID}
      aria-label={
        counts
          ? `GitLab: ${counts.toReview} to review, ${counts.opened} opened, ${counts.failedPipelines} failed${stale ? ' (stale)' : ''}`
          : undefined
      }
      onClick={onToggle}
      className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 -mx-1.5 flex h-7 min-w-0 shrink-0 items-center gap-2 rounded-md px-1.5 outline-none focus-visible:ring-3"
    >
      {content}
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

/** The expanded GitLab section: MRs I review, then MRs I opened, each with its head pipeline. */
function GitLabDetails({ gitlab }: { gitlab: SourceStatus<GitLabOverview> | undefined }) {
  let body: ReactNode
  if (gitlab?.state === 'off') {
    body = (
      <p className="text-muted-foreground px-1.5 text-sm">
        {gitlab.reason} Set gitlab.base_url in config.yml and add the ostraka-gitlab Keychain item (see the README).
      </p>
    )
  } else if (gitlab?.data) {
    body = (
      <>
        <MrGroup title="Reviewing" items={gitlab.data.reviewing} empty="No MRs waiting for your review." showAuthor />
        <MrGroup title="Authored" items={gitlab.data.authored} empty="No open MRs of yours." />
      </>
    )
  } else if (gitlab?.state === 'failing') {
    body = <p className="text-destructive px-1.5 text-sm wrap-anywhere">{gitlab.reason}</p>
  } else {
    body = (
      <div aria-label="Loading GitLab" className="flex flex-col gap-2 p-1.5">
        {[60, 45, 70].map((width) => (
          <Skeleton key={width} className="h-4" style={{ width: `${width}%` }} />
        ))}
      </div>
    )
  }
  return (
    <section aria-labelledby="work-gitlab" className="flex min-w-0 flex-col gap-1">
      <h2 id="work-gitlab" className="flex items-baseline justify-between gap-2 px-1.5 text-xs font-semibold">
        GitLab · open MRs
        {gitlab?.updatedAt && (
          <span className={cn('text-muted-foreground font-normal', gitlab.stale && 'text-destructive')}>
            {gitlab.stale ? 'Stale, from' : 'Updated'} {format(gitlab.updatedAt, 'HH:mm')}
          </span>
        )}
      </h2>
      {body}
    </section>
  )
}

/** What the top bar expands to, in place: one section per Activity source. */
export function WorkDetails() {
  const { gitlab } = useGitLab()
  return (
    <div id={WORK_DETAILS_ID} className="grid max-h-[60vh] gap-3 overflow-y-auto border-t p-2 @3xl:grid-cols-2">
      <GitLabDetails gitlab={gitlab} />
    </div>
  )
}
