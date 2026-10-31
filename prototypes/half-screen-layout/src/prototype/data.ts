// PROTOTYPE: in-memory mock data for the half-screen shell prototype (#10, #17). Throw away.

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

// Tag -> palette slot (1..8). New tags get the next slot.
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
    title: 'Review pay/api!812',
    description: 'Asked by @milena-senechal, focus on idempotency keys. Tracks PAY-1418.',
    priority: 'high',
    due: '2026-10-29',
    tags: ['code-review', 'sprint-42'],
  }),
  t({
    title: 'Migrate staging Redis to 7.4',
    description: 'PAY-1432. Terraform in infra/terraform!798, runbook in Confluence.',
    priority: 'high',
    due: TODAY,
    tags: ['infra', 'sprint-42'],
    subs: [
      t({ title: 'Snapshot current instance', status: 'done', tags: ['infra'], finishedAt: '2026-10-29' }),
      t({ title: 'Update Terraform module', priority: 'med', due: TODAY, tags: ['infra'], description: 'Bump engine_version, keep parameter group.' }),
      t({ title: 'Smoke test checkout flow with @lea-martin', priority: 'low', due: '2026-11-03', tags: ['infra', 'sprint-42'] }),
    ],
  }),
  t({ title: 'Answer @paul-roche about rate limits', priority: 'med', due: TODAY, tags: ['oncall'] }),
  t({
    title: 'Write ADR for todo storage',
    description: 'Plain JSON file, written through the shared core.',
    priority: 'med',
    due: '2026-11-04',
    tags: ['ostraka'],
    subs: [
      t({ title: 'Compare atomic write options', priority: 'low', tags: ['ostraka'] }),
      t({ title: 'Ask about backup remote', tags: ['admin', 'ostraka'] }),
    ],
  }),
  t({
    title: 'Profile slow invoice export PAY-1440',
    priority: 'low',
    due: '2026-11-06',
    tags: ['perf', 'sprint-42'],
  }),
  t({
    title: 'Fix failing pipeline on pay/api!809',
    priority: 'high',
    due: TODAY,
    tags: ['infra'],
  }),
  t({ title: 'Book train for Lyon offsite', due: '2026-11-12', tags: ['admin'] }),
  t({ title: 'Try Visimer for sequence diagrams', tags: ['idea', 'ostraka'], createdAt: '2026-10-28' }),
  t({ title: 'Renew VPN certificate', priority: 'low', tags: ['admin'] }),
  t({ title: 'Update CI cache keys', status: 'done', tags: ['infra'], finishedAt: '2026-10-29' }),
  t({ title: 'Pair with @lea-martin on flaky test', status: 'done', tags: ['code-review'], finishedAt: '2026-10-28' }),
  t({ title: 'Spike GraphQL gateway', status: 'dropped', dropReason: 'Superseded by REST v2 plan', tags: ['idea'], finishedAt: '2026-10-27' }),
]

export type Person = { id: string; name: string; email: string; slack: string; gitlab: string; jira: string }

export const PEOPLE: Record<string, Person> = {
  'milena-senechal': { id: 'milena-senechal', name: 'Milena Sénéchal', email: 'milena.senechal@corp.example', slack: '@milena', gitlab: 'msenechal', jira: '5f1a…c2' },
  'paul-roche': { id: 'paul-roche', name: 'Paul Roche', email: 'paul.roche@corp.example', slack: '@paul.r', gitlab: 'proche', jira: '61b0…9e' },
  'lea-martin': { id: 'lea-martin', name: 'Léa Martin', email: 'lea.martin@corp.example', slack: '@lea', gitlab: 'lmartin', jira: '60d2…11' },
}

// Every open MR where I am the author or a reviewer.
export type MR = {
  iid: number
  project: string
  title: string
  author: string // person id or 'me'
  role: 'author' | 'reviewer'
  draft?: boolean
  pipeline: 'passed' | 'failed' | 'running'
  approvals: string // "1/2"
  approvedByMe?: boolean
  updated: string
  threads: number
}

export const MRS: MR[] = [
  { iid: 812, project: 'pay/api', title: 'Retry failed payments with idempotency keys', author: 'milena-senechal', role: 'reviewer', pipeline: 'passed', approvals: '1/2', updated: '2h', threads: 3 },
  { iid: 455, project: 'web/checkout', title: 'Fix currency rounding on summary', author: 'paul-roche', role: 'reviewer', pipeline: 'running', approvals: '0/2', updated: '35m', threads: 0 },
  { iid: 447, project: 'web/checkout', title: 'Extract price formatter', author: 'lea-martin', role: 'reviewer', pipeline: 'passed', approvals: '2/2', approvedByMe: true, updated: '1d', threads: 0 },
  { iid: 809, project: 'pay/api', title: 'Bump Redis client to 5.x', author: 'me', role: 'author', pipeline: 'failed', approvals: '0/2', updated: '1d', threads: 1 },
  { iid: 798, project: 'infra/terraform', title: 'Redis 7.4 module for staging', author: 'me', role: 'author', pipeline: 'passed', approvals: '2/2', updated: '4h', threads: 0 },
  { iid: 815, project: 'pay/api', title: 'Invoice export streaming', author: 'me', role: 'author', draft: true, pipeline: 'running', approvals: '0/2', updated: '10m', threads: 0 },
]

// Jira statuses keep their real names; the category drives the bullet colour.
export type SprintIssue = { key: string; title: string; status: string; category: 'todo' | 'doing' | 'done' }

export const SPRINT = {
  name: 'PAY Sprint 42',
  end: '2026-11-03',
  daysLeft: 2,
  mine: [
    { key: 'PAY-1432', title: 'Redis 7.4 on staging', status: 'In Progress', category: 'doing' },
    { key: 'PAY-1418', title: 'Payment retry idempotency', status: 'Code Review', category: 'doing' },
    { key: 'PAY-1440', title: 'Invoice export timeouts', status: 'To Do', category: 'todo' },
    { key: 'PAY-1445', title: 'Rate-limit headers on public API', status: 'Blocked', category: 'todo' },
    { key: 'PAY-1401', title: 'CI cache keys', status: 'Done', category: 'done' },
  ] as SprintIssue[],
}

// What the app would read from ~/.config/ostraka/config.yml (no secrets: tokens live in the Keychain).
export const CONFIG = {
  contentDir: '~/ostraka-content',
  gitlab: { host: 'gitlab.example.com' },
  jira: { site: 'corp.atlassian.net', board: 'PAY board (id 142)', mine: 'assignee = currentUser()' },
}

export type Doc = { id: string; title: string; tags: string[]; updated: string; body: string }

export const NOTES: Doc[] = [
  {
    id: 'n1',
    title: 'Redis 7.4 upgrade notes',
    tags: ['infra'],
    updated: '2026-10-29',
    body: `# Redis 7.4 upgrade notes

Things to check before the **staging** switch:

- Client lib must be \`>= 5.0\` (see pay/api!809, PAY-1432)
- Parameter group: keep \`maxmemory-policy allkeys-lru\`
- Ask @paul-roche whether checkout caches TTLs

> Rollback = restore yesterday's snapshot, ~10 min.
`,
  },
  {
    id: 'n2',
    title: 'Idea: auto-link Jira keys in todos',
    tags: ['idea', 'ostraka'],
    updated: '2026-10-28',
    body: `# Idea: auto-link Jira keys in todos

Typing \`PAY-1432\` in a todo could turn into a link, with fuzzy suggestions from the current sprint on **Tab**.
`,
  },
  {
    id: 'n3',
    title: 'Offsite agenda draft',
    tags: ['admin'],
    updated: '2026-10-21',
    body: `# Offsite agenda draft

1. Payments roadmap
2. On-call retro
3. Team dinner 🍷
`,
  },
]

export const DEVLOGS: Doc[] = [
  {
    id: '2026-10-29',
    title: 'Thursday 29 October',
    tags: ['infra', 'code-review'],
    updated: '2026-10-29',
    body: `## Done

- Snapshotted staging Redis ahead of the 7.4 upgrade (PAY-1432)
- Opened !798 *Redis 7.4 module for staging*
- Reviewed !447 *Extract price formatter* from Léa Martin, approved
- Updated CI cache keys

## Notes

- Agreed with Paul Roche to keep the old parameter group until Monday
- Payments sync: retry MR needs a second reviewer
`,
  },
  {
    id: '2026-10-28',
    title: 'Wednesday 28 October',
    tags: ['code-review'],
    updated: '2026-10-28',
    body: `## Done

- Paired with Léa Martin on the flaky checkout test, fixed the clock mock
- Commented on !812 (3 threads)

## Notes

- Flaky test came from a timezone default in CI
`,
  },
  {
    id: '2026-10-26',
    title: 'Monday 26 October',
    tags: ['oncall'],
    updated: '2026-10-26',
    body: `## Done

- On-call handover, no incidents over the weekend
- Triaged 4 alerts, silenced the noisy disk one
`,
  },
]

export const MISSING_DEVLOGS = ['2026-10-27']

export const SKETCHES: Doc[] = [
  {
    id: 's1',
    title: 'Payment retry flow',
    tags: ['code-review'],
    updated: '2026-10-29',
    body: `sequenceDiagram
  participant C as Checkout
  participant A as Pay API
  participant P as PSP
  C->>A: POST /payments (Idempotency-Key)
  A->>P: charge
  P-->>A: timeout
  A->>P: retry with same key
  P-->>A: 200 already captured
  A-->>C: 201 Created`,
  },
  {
    id: 's2',
    title: 'Ostraka content flow',
    tags: ['ostraka'],
    updated: '2026-10-27',
    body: `flowchart LR
  App[App server] -->|atomic write| F[(~/ostraka-content)]
  CLI[ostraka CLI] -->|atomic write| F
  Agent[Claude / Cursor skills] --> CLI
  F -->|watch + SSE| App
  F -->|auto snapshot| Git[(local git)]`,
  },
]

// Monthly Dev log: a summary written by the agent from the daily logs, saved as its own editable file.
export const MONTHLY_DEVLOGS: Doc[] = [
  {
    id: '2026-10',
    title: 'October 2026',
    tags: ['infra', 'code-review', 'oncall'],
    updated: '2026-10-30',
    body: `## Highlights

- **Redis 7.4 on staging** (PAY-1432): snapshot taken, Terraform module in !798, switch planned for Monday
- **Payment retry idempotency** (PAY-1418): reviewed !812, waiting on a second reviewer
- Fixed the flaky checkout test with Léa Martin (timezone default in CI)

## Reviews

- 2 MRs approved, 3 threads opened

## On-call

- Quiet weekend handover, noisy disk alert silenced

## Gaps

- No Dev log on Tuesday 27 October
`,
  },
]
