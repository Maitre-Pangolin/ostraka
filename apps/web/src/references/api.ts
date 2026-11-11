// References over the server API. Status comes from what the server already polled for the top bar (`['activity']`);
// a Reference it didn't poll is fetched on demand, when its hover card opens (`GET /api/references?token=`).
import type { ReferenceCandidates, ReferenceSites } from '@ostraka/core/references'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { request } from '@/lib/api'
import { useSettings } from '@/settings/api'
import { useWorkSources, type JiraTicket, type MergeRequest, type StatusCategory } from '@/work/api'

/** On-demand details (apps/server/src/references.ts). */
export type ReferenceDetails =
  | {
      kind: 'mr'
      token: string
      title: string
      url: string
      /** `opened`, `merged`, `closed` or `locked`. */
      state: string
      draft: boolean
      author: string
      approvals: number
      pipeline?: { status: string }
    }
  | { kind: 'jira'; token: string; title: string; status: string; category: StatusCategory; url?: string }

/** What the top bar polled, by token: my open MRs and my sprint's tickets. */
export type PolledReference = { kind: 'mr'; mr: MergeRequest } | { kind: 'jira'; ticket: JiraTicket; sprint?: string }

export type ReferenceIndex = {
  polled: Map<string, PolledReference>
  /** For suggestions while typing. */
  candidates: ReferenceCandidates
  /** My open MRs' tokens, so a typed `!<iid>` finds its MR. */
  openMergeRequests: string[]
}

export function useReferenceIndex(): ReferenceIndex {
  const { gitlab, jira } = useWorkSources()
  const mrs = gitlab?.data
  const sprint = jira?.data
  return useMemo(() => {
    const mergeRequests = [...(mrs?.authored ?? []), ...(mrs?.reviewing ?? [])]
    const tickets = sprint?.tickets ?? []
    const polled = new Map<string, PolledReference>()
    for (const mr of mergeRequests) polled.set(mr.reference, { kind: 'mr', mr })
    for (const ticket of tickets) polled.set(ticket.key, { kind: 'jira', ticket, sprint: sprint?.sprint?.name })
    return {
      polled,
      candidates: { mergeRequests, tickets },
      openMergeRequests: mergeRequests.map((mr) => mr.reference),
    }
  }, [mrs, sprint])
}

/** Where References open, from config.yml. */
export function useReferenceSites(): ReferenceSites {
  const { data } = useSettings()
  return { gitlab: data?.gitlab.base_url, jira: data?.jira.site }
}

/** Details for a Reference the top bar didn't poll; fetched only while `enabled` (its hover card is open). */
export function useReferenceDetails(token: string, enabled: boolean) {
  return useQuery({
    queryKey: ['references', token],
    queryFn: () => request<ReferenceDetails>(`/references?token=${encodeURIComponent(token)}`),
    enabled,
    staleTime: 60_000,
  })
}
