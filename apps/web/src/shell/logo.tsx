import { MARK_PATHS, MARK_SIZE, TILE_RADIUS } from './logo-mark'

/** The ostraka mark in the theme's colours: a `primary` tile with the ring in `primary-foreground`. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`} aria-hidden className={className}>
      <rect width={MARK_SIZE} height={MARK_SIZE} rx={TILE_RADIUS} className="fill-primary" />
      {MARK_PATHS.map((d) => (
        <path key={d} d={d} className="fill-primary-foreground" />
      ))}
    </svg>
  )
}
