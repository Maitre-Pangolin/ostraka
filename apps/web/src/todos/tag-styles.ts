import type { TagColor } from '@ostraka/core/tag-color'

/** Each Tag colour is one of the `tag-1`…`tag-8` tokens: as a pill's text and tint, or as a dot or swatch. */
export const TAG_STYLES: Record<TagColor, { pill: string; dot: string }> = {
  orange: { pill: 'text-tag-1 bg-tag-1/12', dot: 'bg-tag-1' },
  yellow: { pill: 'text-tag-2 bg-tag-2/12', dot: 'bg-tag-2' },
  green: { pill: 'text-tag-3 bg-tag-3/12', dot: 'bg-tag-3' },
  teal: { pill: 'text-tag-4 bg-tag-4/12', dot: 'bg-tag-4' },
  blue: { pill: 'text-tag-5 bg-tag-5/12', dot: 'bg-tag-5' },
  violet: { pill: 'text-tag-6 bg-tag-6/12', dot: 'bg-tag-6' },
  pink: { pill: 'text-tag-7 bg-tag-7/12', dot: 'bg-tag-7' },
  red: { pill: 'text-tag-8 bg-tag-8/12', dot: 'bg-tag-8' },
}
