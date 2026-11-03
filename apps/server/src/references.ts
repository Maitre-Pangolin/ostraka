// Hover details for a Reference the work overview didn't poll (an MR not open for me, a ticket outside my sprint),
// fetched from GitLab or Jira when the app asks: `GET /api/references?token=`.
import { loadConfig, type ConfigOptions } from '@ostraka/core'
import { parseReference, referenceUrl, type Reference } from '@ostraka/core/references'
import { Hono } from 'hono'
import { gitlabConnection } from './activity/gitlab.ts'
import { getJson, SourceHttpError, type Fetch } from './activity/http.ts'
import { jiraConnection, statusCategory, type StatusCategory } from './activity/jira.ts'
import { SourceOffError } from './activity/poller.ts'
import type { Credentials } from './keychain.ts'

export type MergeRequestDetails = {
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

export type IssueDetails = {
  kind: 'jira'
  token: string
  title: string
  status: string
  category: StatusCategory
  url?: string
}

export type ReferenceDetails = MergeRequestDetails | IssueDetails

/** GitLab or Jira doesn't know the Reference. */
export class ReferenceNotFoundError extends Error {}

export type ReferenceLookup = { details(reference: Reference, token: string): Promise<ReferenceDetails> }

export type ReferenceLookupOptions = {
  /** Calls to GitLab and Jira; a fake in tests, which never reach a real instance. */
  fetch: Fetch
  credentials: Credentials
  /** Where config.yml lives. */
  content?: ConfigOptions
}

const MR_QUERY = `query Reference($path: ID!, $iid: String!) {
  project(fullPath: $path) {
    mergeRequest(iid: $iid) {
      title webUrl state draft
      author { name }
      approvedBy { nodes { username } }
      headPipeline { status }
    }
  }
}`

type MrAnswer = {
  data?: {
    project: {
      mergeRequest: {
        title: string
        webUrl: string
        state: string
        draft: boolean
        author: { name: string } | null
        approvedBy: { nodes: unknown[] } | null
        headPipeline: { status: string } | null
      } | null
    } | null
  }
  errors?: { message: string }[]
}

type IssueAnswer = { fields: { summary: string; status: { name: string; statusCategory: { key: string } } } }

export function referenceLookup({ fetch, credentials, content = {} }: ReferenceLookupOptions): ReferenceLookup {
  const config = () => loadConfig({ homeDir: content.homeDir })

  async function mergeRequest(reference: Extract<Reference, { kind: 'mr' }>, token: string): Promise<MergeRequestDetails> {
    const { base, headers } = gitlabConnection((await config()).gitlab?.base_url, credentials.gitlab)
    const answer = await getJson<MrAnswer>(fetch, `${base}/api/graphql`, 'GitLab', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ query: MR_QUERY, variables: { path: reference.project, iid: String(reference.iid) } }),
    })
    if (answer.errors?.length) throw new Error(`GitLab: ${answer.errors[0]!.message}`)
    const mr = answer.data?.project?.mergeRequest
    if (!mr) throw new ReferenceNotFoundError(`GitLab has no merge request ${token}.`)
    return {
      kind: 'mr',
      token,
      title: mr.title,
      url: mr.webUrl,
      state: mr.state,
      draft: mr.draft,
      author: mr.author?.name ?? '',
      approvals: mr.approvedBy?.nodes.length ?? 0,
      ...(mr.headPipeline && { pipeline: { status: mr.headPipeline.status.toLowerCase() } }),
    }
  }

  async function issue(reference: Extract<Reference, { kind: 'jira' }>, token: string): Promise<IssueDetails> {
    const jira = (await config()).jira
    const { api, authorization } = jiraConnection(jira, credentials.jira)
    const query = new URLSearchParams({ fields: 'summary,status' })
    let answer: IssueAnswer
    try {
      answer = await getJson<IssueAnswer>(fetch, `${api}/issue/${encodeURIComponent(reference.key)}?${query}`, 'Jira', {
        headers: { authorization, accept: 'application/json' },
      })
    } catch (error) {
      if (error instanceof SourceHttpError && error.status === 404) throw new ReferenceNotFoundError(`Jira has no issue ${token}.`)
      throw error
    }
    const url = referenceUrl(reference, { jira: jira?.site })
    return {
      kind: 'jira',
      token,
      title: answer.fields.summary,
      status: answer.fields.status.name,
      category: statusCategory(answer.fields.status.statusCategory.key),
      ...(url && { url }),
    }
  }

  return {
    details: (reference, token) => (reference.kind === 'mr' ? mergeRequest(reference, token) : issue(reference, token)),
  }
}

/** A lookup for when none is configured: every source reads as not set up. */
export const noReferenceLookup: ReferenceLookup = {
  details: async () => {
    throw new SourceOffError('Reference details are not available.')
  },
}

export function referenceRoutes(lookup: ReferenceLookup) {
  return new Hono().get('/', async (c) => {
    const token = c.req.query('token')?.trim() ?? ''
    const reference = parseReference(token)
    if (!reference) return c.json({ error: `Not a Reference: ${JSON.stringify(token)}` }, 400)
    try {
      return c.json(await lookup.details(reference, token))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof ReferenceNotFoundError) return c.json({ error: message }, 404)
      if (error instanceof SourceOffError) return c.json({ error: message }, 503)
      return c.json({ error: message }, 502)
    }
  })
}
