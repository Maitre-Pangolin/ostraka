// PROTOTYPE: in-memory mock data for the half-screen layout prototype (#10). Throw away.

export type Priority = 'high' | 'med' | 'low' | null
export type Status = 'open' | 'done' | 'dropped'

export type Todo = {
  id: string
  title: string
  description?: string
  priority: Priority
  due?: string // YYYY-MM-DD
  tags: string[]
  status: Status
  createdAt: string
  finishedAt?: string
  dropReason?: string
  subs: Todo[]
}

export const TODAY = '2026-10-30'

// Tag -> palette slot (1..8). New tags get the next free slot.
export const TAG_COLORS: Record<string, number> = {
  'code-review': 1,
  infra: 2,
  ostraka: 3,
  'sprint-42': 4,
  oncall: 5,
  admin: 6,
  idea: 7,
  perf: 8,
}

let n = 0
const t = (p: Partial<Todo> & { title: string }): Todo => ({
  id: `t${++n}`,
  priority: null,
  tags: [],
  status: 'open',
  createdAt: '2026-10-20',
  subs: [],
  ...p,
})

export const INITIAL_TODOS: Todo[] = [
  t({
    title: 'Review payment retry MR',
    description:
      'https://gitlab.example.com/pay/api/-/merge_requests/812\nAsked by @milena-senechal, focus on idempotency keys.',
    priority: 'high',
    due: '2026-10-29',
    tags: ['code-review', 'sprint-42'],
  }),
  t({
    title: 'Migrate staging Redis to 7.4',
    description: 'PAY-1432. Runbook in Confluence.',
    priority: 'high',
    due: TODAY,
    tags: ['infra', 'sprint-42'],
    subs: [
      t({ title: 'Snapshot current instance', status: 'done', tags: ['infra'], finishedAt: '2026-10-29' }),
      t({ title: 'Update Terraform module', priority: 'med', due: TODAY, tags: ['infra'] }),
      t({ title: 'Smoke test checkout flow', due: '2026-11-03', tags: ['infra'] }),
    ],
  }),
  t({
    title: 'Answer @paul-roche about rate limits',
    priority: 'med',
    due: TODAY,
    tags: ['oncall'],
  }),
  t({
    title: 'Write ADR for todo storage',
    description: 'Plain JSON file, written through the shared core.',
    priority: 'med',
    due: '2026-11-04',
    tags: ['ostraka'],
    subs: [
      t({ title: 'Compare atomic write options', priority: 'low', tags: ['ostraka'] }),
      t({ title: 'Ask about backup remote', tags: ['ostraka', 'admin'] }),
    ],
  }),
  t({ title: 'Profile slow invoice export', priority: 'low', due: '2026-11-06', tags: ['perf', 'sprint-42'] }),
  t({ title: 'Book train for Lyon offsite', due: '2026-11-12', tags: ['admin'] }),
  t({ title: 'Try Visimer for sequence diagrams', tags: ['idea', 'ostraka'], createdAt: '2026-10-28' }),
  t({ title: 'Renew VPN certificate', priority: 'low', tags: ['admin'] }),
  t({ title: 'Update CI cache keys', status: 'done', tags: ['infra'], finishedAt: '2026-10-29' }),
  t({ title: 'Pair with Léa on flaky test', status: 'done', tags: ['code-review'], finishedAt: '2026-10-28' }),
  t({
    title: 'Spike GraphQL gateway',
    status: 'dropped',
    dropReason: 'Superseded by REST v2 plan',
    tags: ['idea'],
    finishedAt: '2026-10-27',
  }),
]

export type MR = {
  iid: number
  project: string
  title: string
  author: string
  role: 'mine' | 'review'
  pipeline: 'passed' | 'failed' | 'running'
  approvals: string // e.g. "1/2"
  updated: string
  threads: number
}

export const MRS: MR[] = [
  { iid: 812, project: 'pay/api', title: 'Retry failed payments with idempotency keys', author: 'milena-senechal', role: 'review', pipeline: 'passed', approvals: '1/2', updated: '2h', threads: 3 },
  { iid: 455, project: 'web/checkout', title: 'Fix currency rounding on summary', author: 'paul-roche', role: 'review', pipeline: 'running', approvals: '0/2', updated: '35m', threads: 0 },
  { iid: 809, project: 'pay/api', title: 'Bump Redis client to 5.x', author: 'me', role: 'mine', pipeline: 'failed', approvals: '0/2', updated: '1d', threads: 1 },
  { iid: 798, project: 'infra/terraform', title: 'Redis 7.4 module for staging', author: 'me', role: 'mine', pipeline: 'passed', approvals: '2/2', updated: '4h', threads: 0 },
]

export type SprintIssue = { key: string; title: string; status: 'todo' | 'doing' | 'review' | 'done' }

export const SPRINT = {
  name: 'Sprint 42',
  start: '2026-10-21',
  end: '2026-11-03',
  daysLeft: 2,
  teamDone: 9,
  teamTotal: 17,
  mine: [
    { key: 'PAY-1432', title: 'Redis 7.4 on staging', status: 'doing' },
    { key: 'PAY-1418', title: 'Payment retry idempotency', status: 'review' },
    { key: 'PAY-1440', title: 'Invoice export timeouts', status: 'todo' },
    { key: 'PAY-1401', title: 'CI cache keys', status: 'done' },
  ] as SprintIssue[],
}

export const PEOPLE: Record<string, string> = {
  'milena-senechal': 'Milena Sénéchal',
  'paul-roche': 'Paul Roche',
  'lea-martin': 'Léa Martin',
}
