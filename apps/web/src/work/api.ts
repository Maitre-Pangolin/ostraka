// The work overview over the server API. The server polls GitLab (and later Jira) on its own schedule and says
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
  pipeline?: { id: number; status: PipelineStatus; url: string }
}

export type GitLabOverview = {
  counts: { toReview: number; opened: number; failedPipelines: number }
  reviewing: MergeRequest[]
  authored: MergeRequest[]
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

export function useGitLab() {
  const { data, ...query } = useActivity()
  return { ...query, gitlab: data?.sources.find((source) => source.source === 'gitlab') as SourceStatus<GitLabOverview> | undefined }
}
