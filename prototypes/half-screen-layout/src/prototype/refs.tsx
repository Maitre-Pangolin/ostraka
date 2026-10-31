// PROTOTYPE: MR and Jira references for #17 — recognition, chips, hover cards and the picker. Throw away.
//
// Decided in #17: a reference is stored as GitLab's or Jira's own token (`pay/api!812`, `PAY-1432`) in plain text,
// and shown as a chip with live status.
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ExternalLink, GitMerge, SquareKanban } from 'lucide-react'
import { CONFIG, MRS, PEOPLE, SPRINT, type MR, type SprintIssue } from './data'

// ---------------------------------------------------------------- the reference model

// Canonical token, the same syntax GitLab and Jira use: `pay/api!812` (iids are per project) or `PAY-1432`.
export type Ref = { kind: 'mr'; project: string; iid: number } | { kind: 'jira'; key: string }

export const refToken = (r: Ref) => (r.kind === 'mr' ? `${r.project}!${r.iid}` : r.key)
export const refShort = (r: Ref) => (r.kind === 'mr' ? `!${r.iid}` : r.key)
export const refUrl = (r: Ref) =>
  r.kind === 'mr' ? `https://${CONFIG.gitlab.host}/${r.project}/-/merge_requests/${r.iid}` : `https://${CONFIG.jira.site}/browse/${r.key}`

export const TOKEN_RE = /\b([a-z0-9-]+\/[a-z0-9-]+)!(\d+)|\b([A-Z][A-Z0-9]+-\d+)\b/g

export function parseToken(s: string): Ref | null {
  const mr = s.match(/^([a-z0-9-]+\/[a-z0-9-]+)!(\d+)$/)
  if (mr) return { kind: 'mr', project: mr[1], iid: +mr[2] }
  if (/^[A-Z][A-Z0-9]+-\d+$/.test(s)) return { kind: 'jira', key: s }
  return null
}

// A pasted GitLab MR or Jira issue URL (any project on the configured hosts).
export function parseUrl(url: string): Ref | null {
  const u = url.trim()
  const mr = u.match(new RegExp(`^https?://${CONFIG.gitlab.host.replace('.', '\\.')}/(.+?)/-/merge_requests/(\\d+)`))
  if (mr) return { kind: 'mr', project: mr[1], iid: +mr[2] }
  const j = u.match(new RegExp(`^https?://${CONFIG.jira.site.replace('.', '\\.')}/browse/([A-Z][A-Z0-9]+-\\d+)`))
  if (j) return { kind: 'jira', key: j[1] }
  return null
}

export type Resolved = { ref: Ref; title: string; mr?: MR; issue?: SprintIssue }

// The app resolves from what it already fetched for the top bar; anything else is fetched on hover.
export function resolve(r: Ref): Resolved {
  if (r.kind === 'mr') {
    const mr = MRS.find((m) => m.iid === r.iid && m.project === r.project)
    return { ref: r, title: mr?.title ?? `${r.project} merge request`, mr }
  }
  const issue = SPRINT.mine.find((i) => i.key === r.key)
  return { ref: r, title: issue?.title ?? 'Jira issue', issue }
}

// ---------------------------------------------------------------- picker items

// What is being typed right before the caret, if it looks like a reference.
// `!` + digits or words searches open MRs; `ABC-` searches sprint tickets. (Priority moved to `*high`.)
export function refQuery(before: string): { q: string; kind: 'mr' | 'jira' } | null {
  const m = before.match(/(?:^|\s)(![\w-]*|[A-Z][A-Z0-9]+-\d*)$/)
  if (!m) return null
  const q = m[1]
  if (q.startsWith('!')) return { q, kind: 'mr' }
  return { q, kind: 'jira' }
}

export function refItems(query: { q: string; kind: 'mr' | 'jira' }): Resolved[] {
  const w = query.q.replace(/^!/, '').toLowerCase()
  if (query.kind === 'mr')
    return MRS.filter((m) => !w || String(m.iid).startsWith(w) || m.title.toLowerCase().includes(w) || m.project.includes(w)).map((m) =>
      resolve({ kind: 'mr', project: m.project, iid: m.iid }),
    )
  return SPRINT.mine.filter((i) => i.key.toLowerCase().startsWith(w) && i.category !== 'done').map((i) => resolve({ kind: 'jira', key: i.key }))
}

// ---------------------------------------------------------------- display

const PIPE = { passed: 'bg-emerald-500', failed: 'bg-destructive', running: 'bg-amber-500' } as const
const CAT = { todo: 'bg-muted-foreground/60', doing: 'bg-sky-500', done: 'bg-emerald-500' } as const

export const dotClass = (r: Resolved) => cn('inline-block size-1.5 shrink-0 rounded-full', r.mr ? PIPE[r.mr.pipeline] : r.issue ? CAT[r.issue.category] : 'bg-muted-foreground/30')

export function StatusDot({ r }: { r: Resolved }) {
  return <span className={dotClass(r)} />
}

export const RefIcon = ({ r, className }: { r: Ref; className?: string }) =>
  r.kind === 'mr' ? <GitMerge className={cn('size-3', className)} /> : <SquareKanban className={cn('size-3', className)} />

export function RefCard({ r }: { r: Resolved }) {
  const author = r.mr && (r.mr.author === 'me' ? 'you' : (PEOPLE[r.mr.author]?.name ?? r.mr.author))
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <RefIcon r={r.ref} />
        {refToken(r.ref)}
        <span className="flex-1" />
        <a href={refUrl(r.ref)} onClick={(e) => e.preventDefault()} className="flex items-center gap-0.5 hover:text-foreground">
          Open <ExternalLink className="size-3" />
        </a>
      </div>
      <div className="text-sm font-medium leading-snug">{r.title}</div>
      {r.mr && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <StatusDot r={r} /> pipeline {r.mr.pipeline}
          </span>
          <span>{r.mr.approvals} approvals</span>
          <span>by {author}</span>
          {r.mr.threads > 0 && <span>{r.mr.threads} threads</span>}
        </div>
      )}
      {r.issue && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <StatusDot r={r} /> {r.issue.status} · {SPRINT.name}
        </div>
      )}
      {!r.mr && !r.issue && <div className="text-xs text-muted-foreground">Not in the open MRs or the sprint: details fetched on hover.</div>}
    </div>
  )
}

// A reference rendered as a chip.
export function RefChip({ r }: { r: Ref }) {
  const res = resolve(r)
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        nativeButton={false}
        delay={300}
        onClick={(e) => e.stopPropagation()}
        render={
          <span className="inline-flex h-5 shrink-0 cursor-default items-center gap-1 rounded-md bg-muted px-1.5 align-middle text-[11px] font-medium leading-none text-foreground/80 ring-1 ring-border hover:bg-accent" />
        }
      >
        <RefIcon r={r} className="text-muted-foreground" />
        {refShort(r)}
        <StatusDot r={res} />
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start" onClick={(e) => e.stopPropagation()}>
        <RefCard r={res} />
      </PopoverContent>
    </Popover>
  )
}

export function RefRow({ r, active }: { r: Resolved; active?: boolean }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <RefIcon r={r.ref} className="text-muted-foreground" />
      <span className="w-[4.5rem] shrink-0 whitespace-nowrap text-xs font-medium tabular-nums">{refShort(r.ref)}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{r.title}</span>
      <StatusDot r={r} />
      <span className="hidden w-20 shrink-0 truncate text-right text-[11px] text-muted-foreground @md:inline">
        {r.mr ? r.mr.project : r.issue?.status}
      </span>
      {active && <kbd className="text-[10px] text-muted-foreground">Tab</kbd>}
    </span>
  )
}

// The floating picker list used by the Notes editor (Milkdown).
export function RefPickerList({ items, sel, onPick }: { items: Resolved[]; sel: number; onPick: (r: Resolved) => void }) {
  return (
    <div className="w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
      {items.slice(0, 8).map((r, i) => (
        <div key={refToken(r.ref)} onMouseDown={(e) => (e.preventDefault(), onPick(r))} className={cn('flex cursor-pointer rounded-md px-2 py-1', i === sel && 'bg-accent')}>
          <RefRow r={r} active={i === sel} />
        </div>
      ))}
      {!items.length && <div className="px-2 py-1 text-xs text-muted-foreground">No open MR or sprint ticket matches.</div>}
    </div>
  )
}
