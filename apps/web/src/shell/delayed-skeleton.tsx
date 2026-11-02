import { useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

/** The loading state: `rows` skeleton rows, shown only once loading has taken 300 ms. */
export function DelayedSkeleton({ rows = 3 }: { rows?: number }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), 300)
    return () => clearTimeout(timer)
  }, [])
  if (!shown) return null
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  )
}
