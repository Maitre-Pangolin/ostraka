import { useEffect, useState } from 'react'

/** True once `active` has stayed true for `ms`. Loading skeletons use it so they show only when loading is slow (300 ms). */
export function useAfter(ms: number, active: boolean): boolean {
  const [elapsed, setElapsed] = useState(false)
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => setElapsed(true), ms)
    return () => {
      clearTimeout(timer)
      setElapsed(false)
    }
  }, [ms, active])
  return active && elapsed
}
