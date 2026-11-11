// The work overview over the server API. The server polls GitLab and Jira on its own schedule and says
// when a source changed over live updates (`{ kind: 'activity', id }`), which invalidates `['activity']`.
import { useQuery } from '@tanstack/react-query'
import { request } from '@/lib/api'

/** A pipeline status as GitLab spells it: `running`, `pending`, `success`, `failed`, `canceled`… */
export type PipelineStatus = string

/** One open MR (apps/server/src/activity/gitlab.ts). */
export type MergeRequest = {
  /** `group/project!iid`, the Reference token. */
  reference: string
  title: string
  url: string
  draft: boolean
  updatedAt: string
  author: string
  approvedByMe: boolean
  /** How many have approved it. */
  approvals: number
  pipeline?: { id: number; status: PipelineStatus; url: string }
}

export type GitLabOverview = {
  counts: { toReview: number; opened: number; failedPipelines: number }
  reviewing: MergeRequest[]
  authored: MergeRequest[]
}

/** Jira's status category: `new` (to do), `indeterminate` (in progress) or `done`. */
export type StatusCategory = 'new' | 'indeterminate' | 'done'

/** One ticket of mine in the open sprint (apps/server/src/activity/jira.ts). */
export type JiraTicket = {
  /** `PAY-1432`, the Reference token. */
  key: string
  summary: string
  /** The status as the board names it, such as "In review". */
  status: string
  category: StatusCategory
  url?: string
}

export type JiraOverview = {
  counts: { open: number }
  /** Absent when none of my tickets is in an active sprint. `daysLeft` counts today. */
  sprint?: { name: string; endDate?: string; daysLeft?: number }
  tickets: JiraTicket[]
}

/** One Activity source, as GET /api/activity answers it. Data from before a failure is kept, and `stale`. */
export type SourceStatus<T = unknown> = {
  source: string
  state: 'loading' | 'ok' | 'failing' | 'off'
  /** Why it is failing or off. */
  reason?: string
  data?: T
  updatedAt?: string
  stale: boolean
}

export const SOURCE_LABEL: Record<string, string> = { gitlab: 'GitLab', jira: 'Jira' }

export function useActivity() {
  return useQuery({ queryKey: ['activity'], queryFn: () => request<{ sources: SourceStatus[] }>('/activity') })
}

/** GitLab's and Jira's statuses, from the one `['activity']` query. */
export function useWorkSources() {
  const { data, ...query } = useActivity()
  const find = (name: string) => data?.sources.find((source) => source.source === name)
  return {
    ...query,
    gitlab: find('gitlab') as SourceStatus<GitLabOverview> | undefined,
    jira: find('jira') as SourceStatus<JiraOverview> | undefined,
  }
}
