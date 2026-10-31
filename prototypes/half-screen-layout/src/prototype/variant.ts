// PROTOTYPE (#17): which variant is showing, from ?variant=. Throw away.
export type Variant = 'A' | 'B' | 'C'
export const VARIANTS: { key: Variant; name: string }[] = [
  { key: 'A', name: 'Plain-text tokens' },
  { key: 'B', name: 'Markdown links (rich text)' },
  { key: 'C', name: 'Links as properties' },
]
export const VARIANT: Variant = (['A', 'B', 'C'] as const).find((v) => v === new URLSearchParams(location.search).get('variant')) ?? 'A'

// Seed text per variant: the same content stored the way that variant would store it.
export const pick = <T,>(by: Record<Variant, T>): T => by[VARIANT]
