// GitLab as an Activity source: my open MRs and review requests with their head pipelines, from one GraphQL
// `currentUser` query, plus REST for pipelines while they run. Plain `fetch`, a PAT with `read_api`.
import type { Secret } from '../keychain.ts'
import { getJson, type Fetch } from './http.ts'
import { SourceOffError, type ActivitySource, type Job } from './poller.ts'

const SECOND = 1000
const MINUTE = 60 * SECOND

export const GITLAB_RATES = {
  mergeRequests: { visibleMs: MINUTE, hiddenMs: 10 * MINUTE },
  runningPipelines: { visibleMs: 15 * SECOND, hiddenMs: 2 * MINUTE },
}

/** At most this many running pipelines are followed over REST; the rest wait for the next MR poll. */
const MAX_RUNNING_PIPELINES = 5
/** Kept small: GitLab caps a query's complexity at 250. */
const PAGE = 20

/** A pipeline status as GitLab's REST API spells it: `running`, `pending`, `success`, `failed`, `canceled`… */
export type PipelineStatus = string

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
  projectId: number
  pipeline?: { id: number; status: PipelineStatus; url: string }
}

export type GitLabOverview = {
  counts: { toReview: number; opened: number; failedPipelines: number }
  reviewing: MergeRequest[]
  authored: MergeRequest[]
}

const STILL_RUNNING = new Set(['created', 'waiting_for_resource', 'preparing', 'pending', 'running'])
export const isRunning = (status: PipelineStatus) => STILL_RUNNING.has(status)

const MR_FIELDS = `
  iid title webUrl draft updatedAt reference(full: true) projectId
  author { name username }
  approvedBy { nodes { username } }
  headPipeline { id status webUrl }`

const QUERY = `query WorkOverview {
  currentUser {
    username
    authoredMergeRequests(state: opened, sort: UPDATED_DESC, first: ${PAGE}) { nodes { ${MR_FIELDS} } }
    reviewRequestedMergeRequests(state: opened, sort: UPDATED_DESC, first: ${PAGE}) { nodes { ${MR_FIELDS} } }
  }
}`

type MrNode = {
  title: string
  webUrl: string
  draft: boolean
  updatedAt: string
  reference: string
  projectId: number
  author: { name: string; username: string } | null
  approvedBy: { nodes: { username: string }[] } | null
  headPipeline: { id: string; status: string; webUrl: string } | null
}

type QueryAnswer = {
  data?: {
    currentUser: {
      username: string
      authoredMergeRequests: { nodes: MrNode[] }
      reviewRequestedMergeRequests: { nodes: MrNode[] }
    } | null
  }
  errors?: { message: string }[]
}

function overview(reviewing: MergeRequest[], authored: MergeRequest[]): GitLabOverview {
  return {
    counts: {
      toReview: reviewing.filter((mr) => !mr.approvedByMe).length,
      opened: authored.length,
      failedPipelines: authored.filter((mr) => mr.pipeline?.status === 'failed').length,
    },
    reviewing,
    authored,
  }
}

function mergeRequest(node: MrNode, me: string): MergeRequest {
  const pipeline = node.headPipeline
  return {
    reference: node.reference,
    title: node.title,
    url: node.webUrl,
    draft: node.draft,
    updatedAt: node.updatedAt,
    author: node.author?.name ?? '',
    approvedByMe: node.approvedBy?.nodes.some((user) => user.username === me) ?? false,
    approvals: node.approvedBy?.nodes.length ?? 0,
    projectId: Number(node.projectId),
    ...(pipeline && {
      // The GraphQL id is a global id, `gid://gitlab/Ci::Pipeline/123`; REST wants the number.
      pipeline: { id: Number(pipeline.id.split('/').pop()), status: pipeline.status.toLowerCase(), url: pipeline.webUrl },
    }),
  }
}

export type GitLabOptions = {
  fetch: Fetch
  token: Secret | undefined
  /** `gitlab.base_url` from config.yml, read before each poll so an edit applies without a restart. */
  baseUrl: () => Promise<string | undefined>
}

/** Where GitLab answers and how to sign in; off without a base URL or a token. */
export function gitlabConnection(base: string | undefined, token: Secret | undefined) {
  if (!base) throw new SourceOffError('No gitlab.base_url in config.yml.')
  if (!token) throw new SourceOffError('No ostraka-gitlab item in the Keychain.')
  return { base: base.replace(/\/+$/, ''), headers: { authorization: `Bearer ${token.reveal()}` } }
}

export function gitlabSource({ fetch, token, baseUrl }: GitLabOptions): ActivitySource<GitLabOverview> {
  const connection = async () => gitlabConnection(await baseUrl(), token)

  const mergeRequests: Job<GitLabOverview> = {
    rates: GITLAB_RATES.mergeRequests,
    async run() {
      const { base, headers } = await connection()
      const answer = await getJson<QueryAnswer>(fetch, `${base}/api/graphql`, 'GitLab', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ query: QUERY }),
      })
      const user = answer.data?.currentUser
      if (answer.errors?.length) throw new Error(`GitLab: ${answer.errors[0]!.message}`)
      if (!user) throw new Error('GitLab did not recognise the token as a user.')
      const fresh = overview(
        user.reviewRequestedMergeRequests.nodes.map((node) => mergeRequest(node, user.username)),
        user.authoredMergeRequests.nodes.map((node) => mergeRequest(node, user.username)),
      )
      return () => fresh
    },
  }

  const running = (data: GitLabOverview | undefined) => {
    const pipelines = new Map<number, number>()
    for (const mr of [...(data?.authored ?? []), ...(data?.reviewing ?? [])]) {
      if (mr.pipeline && isRunning(mr.pipeline.status)) pipelines.set(mr.pipeline.id, mr.projectId)
    }
    return [...pipelines].slice(0, MAX_RUNNING_PIPELINES)
  }

  const runningPipelines: Job<GitLabOverview> = {
    rates: GITLAB_RATES.runningPipelines,
    active: (data) => running(data).length > 0,
    async run(data) {
      const { base, headers } = await connection()
      const statuses = new Map<number, PipelineStatus>()
      for (const [id, projectId] of running(data)) {
        const pipeline = await getJson<{ status: string }>(fetch, `${base}/api/v4/projects/${projectId}/pipelines/${id}`, 'GitLab', {
          headers,
        })
        statuses.set(id, pipeline.status)
      }
      const update = (mr: MergeRequest): MergeRequest => {
        const status = mr.pipeline && statuses.get(mr.pipeline.id)
        return status === undefined ? mr : { ...mr, pipeline: { ...mr.pipeline!, status } }
      }
      // Applied to the latest MRs: an MR poll may have landed while these calls ran.
      return (latest) => overview((latest?.reviewing ?? []).map(update), (latest?.authored ?? []).map(update))
    },
  }

  return { name: 'gitlab', jobs: [mergeRequests, runningPipelines] }
}
