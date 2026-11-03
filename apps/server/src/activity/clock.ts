/** Wall-clock time and timers, injected so tests can move time (and simulate sleep) without waiting. */
export type Clock = {
  /** Wall-clock milliseconds, as `Date.now()`. */
  now(): number
  /** Runs `run` after `ms`; returns the function that cancels it. A fake clock waits for the promise `run` returns. */
  setTimeout(run: () => unknown, ms: number): () => void
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout(run, ms) {
    const timer = setTimeout(run, ms)
    // A pending poll never keeps the process alive on its own.
    timer.unref()
    return () => clearTimeout(timer)
  },
}
