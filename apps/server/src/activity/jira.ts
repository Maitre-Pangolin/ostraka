// Jira as an Activity source: my tickets in the open sprint, each with its real status, and the sprint's days left.
// One `search/jql` call through the Atlassian gateway, which scoped API tokens require, with Basic auth (email + token).
import type { Config } from '@ostraka/core/config-schema'
import type { Secret } from '../keychain.ts'
import { getJson, type Fetch } from './http.ts'
import { SourceOffError, type ActivitySource, type Job } from './poller.ts'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

export const JIRA_RATES = { sprint: { visibleMs: 3 * MINUTE, hiddenMs: 15 * MINUTE } }

/** Used when config.yml has no `jira.my_tickets_jql`. */
export const DEFAULT_MY_TICKETS_JQL = 'assignee = currentUser()'
/** Board order, when the configured JQL has no ORDER BY of its own. */
const DEFAULT_ORDER = 'ORDER BY Rank ASC'
const PAGE = 100
const MAX_PAGES = 5
/** The Sprint field's type; its id (`customfield_…`) differs per site. */
const SPRINT_FIELD_TYPE = 'com.pyxis.greenhopper.jira:gh-sprint'

/** Jira's status category: `new` (to do), `indeterminate` (in progress) or `done`. */
export type StatusCategory = 'new' | 'indeterminate' | 'done'

export type JiraTicket = {
  /** `PAY-1432`, the Reference token. */
  key: string
  summary: string
  /** The status as the board names it, such as "In review". */
  status: string
  category: StatusCategory
  /** Its page on `jira.site`; absent without one. */
  url?: string
}

export type JiraOverview = {
  counts: { open: number }
  /** The active sprint (the configured board's, when several are open); absent when no ticket is in one. */
  sprint?: { name: string; endDate?: string; daysLeft?: number }
  tickets: JiraTicket[]
}

type SprintValue = { id: number; name: string; state: string; boardId?: number; endDate?: string }

type SearchAnswer = {
  issues: {
    key: string
    fields: {
      summary: string
      status: { name: string; statusCategory: { key: string } }
      [field: string]: unknown
    }
  }[]
  isLast?: boolean
  nextPageToken?: string
}

type Field = { id: string; schema?: { custom?: string } }

/** `sprint in openSprints()` and the configured JQL, its ORDER BY (or board order) kept last. */
export function sprintJql(myTickets = DEFAULT_MY_TICKETS_JQL): string {
  const orderAt = myTickets.search(/\border\s+by\b/i)
  const where = (orderAt === -1 ? myTickets : myTickets.slice(0, orderAt)).trim()
  const order = orderAt === -1 ? DEFAULT_ORDER : myTickets.slice(orderAt).trim()
  return `sprint in openSprints()${where ? ` AND (${where})` : ''} ${order}`
}

/** Days left in the sprint, today included: any part of a day counts, and an ended sprint has 0. */
function daysLeft(endDate: string | undefined, now: number): number | undefined {
  const end = endDate === undefined ? NaN : Date.parse(endDate)
  return Number.isNaN(end) ? undefined : Math.max(0, Math.ceil((end - now) / DAY))
}

function activeSprint(values: SprintValue[], boardId: number | undefined): SprintValue | undefined {
  const active = values.filter((sprint) => sprint.state === 'active')
  const byEnd = (a: SprintValue, b: SprintValue) => Date.parse(a.endDate ?? '') - Date.parse(b.endDate ?? '')
  return active.find((sprint) => sprint.boardId === boardId) ?? active.toSorted(byEnd)[0]
}

const CATEGORIES = new Set<string>(['new', 'indeterminate', 'done'])

export type JiraOptions = {
  fetch: Fetch
  token: Secret | undefined
  /** The `jira` section of config.yml, read before each poll so an edit applies without a restart. */
  config: () => Promise<Config['jira']>
  now: () => number
}

export function jiraSource({ fetch, token, config, now }: JiraOptions): ActivitySource<JiraOverview> {
  /** The Sprint field's id, found once. */
  let sprintField: string | undefined

  const sprint: Job<JiraOverview> = {
    rates: JIRA_RATES.sprint,
    async run() {
      const jira = (await config()) ?? {}
      if (!jira.cloud_id) throw new SourceOffError('No jira.cloud_id in config.yml.')
      if (!jira.email) throw new SourceOffError('No jira.email in config.yml.')
      if (!token) throw new SourceOffError('No ostraka-jira item in the Keychain.')
      const api = `https://api.atlassian.com/ex/jira/${jira.cloud_id}/rest/api/3`
      const authorization = `Basic ${Buffer.from(`${jira.email}:${token.reveal()}`).toString('base64')}`

      if (!sprintField) {
        const fields = await getJson<Field[]>(fetch, `${api}/field`, 'Jira', { headers: { authorization, accept: 'application/json' } })
        sprintField = fields.find((field) => field.schema?.custom === SPRINT_FIELD_TYPE)?.id
      }

      const issues: SearchAnswer['issues'] = []
      let nextPageToken: string | undefined
      for (let page = 0; page < MAX_PAGES; page++) {
        const answer = await getJson<SearchAnswer>(fetch, `${api}/search/jql`, 'Jira', {
          method: 'POST',
          headers: { authorization, accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({
            jql: sprintJql(jira.my_tickets_jql),
            fields: ['summary', 'status', ...(sprintField ? [sprintField] : [])],
            maxResults: PAGE,
            ...(nextPageToken && { nextPageToken }),
          }),
        })
        issues.push(...answer.issues)
        nextPageToken = answer.nextPageToken
        if (answer.isLast !== false || !nextPageToken) break
      }

      const site = jira.site?.replace(/\/+$/, '')
      const tickets = issues.map(({ key, fields }): JiraTicket => {
        const category = fields.status.statusCategory.key
        return {
          key,
          summary: fields.summary,
          status: fields.status.name,
          category: CATEGORIES.has(category) ? (category as StatusCategory) : 'new',
          ...(site && { url: `${site}/browse/${key}` }),
        }
      })
      const sprints = issues.flatMap(({ fields }) =>
        sprintField && Array.isArray(fields[sprintField]) ? (fields[sprintField] as SprintValue[]) : [],
      )
      const current = activeSprint(sprints, jira.board_id)
      const fresh: JiraOverview = {
        counts: { open: tickets.filter((ticket) => ticket.category !== 'done').length },
        ...(current && {
          sprint: {
            name: current.name,
            ...(current.endDate && { endDate: current.endDate, daysLeft: daysLeft(current.endDate, now()) }),
          },
        }),
        tickets,
      }
      return () => fresh
    },
  }

  return { name: 'jira', jobs: [sprint] }
}
