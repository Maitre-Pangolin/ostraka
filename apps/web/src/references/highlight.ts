// References highlighted in the Notes editor: core's grammar finds them, the dot shows their status.
import { findReferences } from '@ostraka/core/references'
import type { TokenHighlighter } from '../notes/token-highlight'

/** Highlights each Reference, followed by the dot `dot(token)` gives (its status class). */
export function referenceHighlighter(dot: (token: string) => string): TokenHighlighter {
  return {
    find: findReferences,
    attrs: (token) => ({ class: 'ostraka-reference', 'data-reference': token }),
    dot,
  }
}
