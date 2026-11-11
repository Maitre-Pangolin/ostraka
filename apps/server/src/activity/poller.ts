// The work overview's schedule: every Activity source the app polls (GitLab, Jira) runs its jobs here.
// The server owns the schedule; the UI only reports whether a window is visible.
import type { Clock } from './clock.ts'

/** How often the poller checks the wall clock, and how late a check must be to mean the machine slept. */
const HEARTBEAT_MS = 30_000
const WAKE_LATENESS_MS = 60_000

/** How often a job runs while a window shows the app, and while none does. */
export type Rates = { visibleMs: number; hiddenMs: number }

/** Turns the data a job last saw into the data after this run, applied to the source's latest data. */
export type Update<T> = (latest: T | undefined) => T

export type Job<T> = {
  rates: Rates
  /** Whether the job runs at all, given the source's latest data. Re-checked after every run; always when omitted. */
  active?: (data: T | undefined) => boolean
  run(data: T | undefined): Promise<Update<T>>
}

export type ActivitySource<T> = {
  /** Its name in `/api/activity` and in live updates (`{ kind: 'activity', id: name }`). */
  name: string
  jobs: Job<T>[]
}

/** One source as the app sees it. Data from before a failure is kept, and marked stale. */
export type SourceStatus = {
  source: string
  /** `loading` before the first answer; `off` when it is not set up. */
  state: 'loading' | 'ok' | 'failing' | 'off'
  /** Why it is failing or off. */
  reason?: string
  data?: unknown
  /** When data last arrived, as an ISO date. */
  updatedAt?: string
  stale: boolean
}

export type ActivityChange = { kind: 'activity'; id: string }
export type ActivityListener = (change: ActivityChange) => void

export type Activity = {
  start(): void
  stop(): void
  statuses(): SourceStatus[]
  /** Called with `{ kind: 'activity', id }` whenever a source's status changes. */
  subscribe(listener: ActivityListener): () => void
  /** A window opened the app (its live-updates stream); hidden until it reports otherwise. Returns its disconnect. */
  connect(client: string): () => void
  /** A connected window became visible or hidden. Sources poll at their visible rates while any window is visible. */
  setVisibility(client: string, visible: boolean): void
}

/** A source that is not set up (no base URL, no token): it is off, not failing, and holds no data. */
export class SourceOffError extends Error {}

/** When a `Retry-After` value (seconds or an HTTP date), carried by an error as `retryAfter`, lets calls resume. */
function retryAt(error: unknown, now: number): number | undefined {
  const value = (error as { retryAfter?: unknown } | null)?.retryAfter
  if (typeof value !== 'string' || !value.trim()) return undefined
  const at = /^\d+$/.test(value.trim()) ? now + Number(value) * 1000 : Date.parse(value)
  return Number.isNaN(at) ? undefined : at
}

type JobState<T> = {
  job: Job<T>
  /** When it last started, or when it became active: the data that made it active is that fresh. */
  lastRun?: number
  active: boolean
  running: boolean
  error?: string
  cancel?: () => void
}

type SourceState<T> = {
  source: ActivitySource<T>
  jobs: JobState<T>[]
  data?: T
  updatedAt?: number
  off?: string
  /** No call before this time: the source answered with `Retry-After`. */
  notBefore?: number
}

export function activityPoller({ sources, clock }: { sources: ActivitySource<any>[]; clock: Clock }): Activity {
  const listeners = new Set<ActivityListener>()
  const states: SourceState<unknown>[] = sources.map((source) => ({
    source,
    jobs: source.jobs.map((job) => ({ job, active: false, running: false })),
  }))
  let started = false
  /** Each connected window, and whether it is visible. */
  const windows = new Map<string, { visible: boolean }>()

  const visible = () => [...windows.values()].some((window) => window.visible)
  const interval = (job: Job<unknown>) => (visible() ? job.rates.visibleMs : job.rates.hiddenMs)
  // An off source keeps its schedule: each run checks the config again, without calling out.
  const isActive = (state: SourceState<unknown>, job: Job<unknown>) => job.active?.(state.data) ?? true

  const notify = (state: SourceState<unknown>) => {
    for (const listener of listeners) listener({ kind: 'activity', id: state.source.name })
  }

  const schedule = (state: SourceState<unknown>, jobState: JobState<unknown>) => {
    jobState.cancel?.()
    jobState.cancel = undefined
    const wasActive = jobState.active
    jobState.active = isActive(state, jobState.job)
    if (!jobState.active) {
      if (jobState.job.active) jobState.error = undefined
      return
    }
    if (!wasActive && jobState.job.active) jobState.lastRun = clock.now()
    if (!started || jobState.running) return
    const due = Math.max(jobState.lastRun === undefined ? clock.now() : jobState.lastRun + interval(jobState.job), state.notBefore ?? 0)
    jobState.cancel = clock.setTimeout(() => run(state, jobState), Math.max(0, due - clock.now()))
  }

  const run = async (state: SourceState<unknown>, jobState: JobState<unknown>) => {
    jobState.cancel = undefined
    jobState.running = true
    jobState.lastRun = clock.now()
    try {
      const update = await jobState.job.run(state.data)
      if (!started) return
      state.data = update(state.data)
      state.updatedAt = clock.now()
      state.off = undefined
      jobState.error = undefined
    } catch (error) {
      if (!started) return
      if (error instanceof SourceOffError) {
        state.off = error.message
        state.data = undefined
        state.updatedAt = undefined
      } else {
        jobState.error = error instanceof Error ? error.message : String(error)
        const resume = retryAt(error, clock.now())
        if (resume !== undefined) state.notBefore = Math.max(state.notBefore ?? 0, resume)
      }
    } finally {
      jobState.running = false
    }
    // The new data may start or stop another job (running pipelines).
    for (const other of state.jobs) schedule(state, other)
    notify(state)
  }

  const status = (state: SourceState<unknown>): SourceStatus => {
    const failure = state.jobs.find((jobState) => jobState.error !== undefined)?.error
    const base = {
      source: state.source.name,
      data: state.data,
      updatedAt: state.updatedAt === undefined ? undefined : new Date(state.updatedAt).toISOString(),
    }
    if (state.off !== undefined) return { source: state.source.name, state: 'off', reason: state.off, stale: false }
    if (failure !== undefined) return { ...base, state: 'failing', reason: failure, stale: state.data !== undefined }
    if (state.updatedAt === undefined) return { ...base, state: 'loading', stale: false }
    return { ...base, state: 'ok', stale: false }
  }

  const rescheduleAll = () => {
    for (const state of states) for (const jobState of state.jobs) schedule(state, jobState)
  }

  // Node has no sleep event, but timers stop while the machine sleeps: a heartbeat that fires much later than
  // planned (by the wall clock) means it just woke, and every source refreshes once, Retry-After permitting.
  let stopHeartbeat: (() => void) | undefined
  const heartbeat = (expected: number) => {
    stopHeartbeat = clock.setTimeout(() => {
      if (clock.now() - expected > WAKE_LATENESS_MS) {
        for (const state of states) for (const jobState of state.jobs) if (jobState.active) jobState.lastRun = undefined
        rescheduleAll()
      }
      heartbeat(clock.now() + HEARTBEAT_MS)
    }, HEARTBEAT_MS)
  }

  /** Applies a change to the windows; a change of overall visibility moves every job to its new rate. */
  const changeWindows = (change: () => void) => {
    const before = visible()
    change()
    if (visible() !== before) rescheduleAll()
  }

  return {
    start() {
      if (started) return
      started = true
      rescheduleAll()
      heartbeat(clock.now() + HEARTBEAT_MS)
    },
    stop() {
      started = false
      stopHeartbeat?.()
      for (const state of states) for (const jobState of state.jobs) jobState.cancel?.()
    },
    statuses: () => states.map(status),
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    connect(client) {
      const window = { visible: false }
      changeWindows(() => windows.set(client, window))
      // A reconnecting window may open its new stream before the old one is seen to close.
      return () => changeWindows(() => windows.get(client) === window && windows.delete(client))
    },
    setVisibility(client, isVisible) {
      const window = windows.get(client)
      if (window) changeWindows(() => (window.visible = isVisible))
    },
  }
}
