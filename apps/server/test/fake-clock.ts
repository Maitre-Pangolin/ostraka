import type { Clock } from '../src/index.ts'

type Timer = { at: number; run: () => unknown }

/** Lets pending promises (a fake fetch, a JSON body) settle before the clock moves on. */
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve))
}

/**
 * A clock that moves only when told. `advance` runs timers in order as time passes, each to completion; `sleep` is the machine asleep:
 * the wall clock jumps, but timers (on a monotonic clock that stops during sleep) are due that much later.
 */
export function fakeClock(start = Date.parse('2026-11-02T09:00:00Z')) {
  let now = start
  const timers = new Set<Timer>()

  const clock: Clock = {
    now: () => now,
    setTimeout(run, ms) {
      const timer = { at: now + Math.max(0, ms), run }
      timers.add(timer)
      return () => void timers.delete(timer)
    },
  }

  return {
    clock,
    /** Moves time forward by `ms`, running each timer when it falls due. */
    async advance(ms: number) {
      const end = now + ms
      await settle()
      for (;;) {
        const due = [...timers].filter((timer) => timer.at <= end).toSorted((a, b) => a.at - b.at)[0]
        if (!due) break
        timers.delete(due)
        now = due.at
        await due.run()
        await settle()
      }
      now = end
      await settle()
    },
    /** The machine sleeps for `ms`. */
    sleep(ms: number) {
      now += ms
      for (const timer of timers) timer.at += ms
    },
  }
}

export type FakeResponse = { status?: number; body?: unknown; headers?: Record<string, string> }

/** A `fetch` that answers from `respond` and records each request; it never reaches the network. */
export function fakeFetch(respond: (url: URL, init: RequestInit) => FakeResponse | Error) {
  const calls: { url: URL; init: RequestInit }[] = []
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input)
    calls.push({ url, init })
    const answer = respond(url, init)
    if (answer instanceof Error) throw answer
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json', ...answer.headers },
    })
  }) as typeof globalThis.fetch
  return { fetch, calls }
}
