// Search matches highlighted in what a view shows (a list, a rendered Dev log, the Notes editor), without touching
// its DOM: the CSS Custom Highlight API paints ranges over its text nodes (`::highlight(ostraka-search)` in
// index.css). Where the text matches is core's (`findMatches`). The ranges are found again whenever the view's DOM
// changes, so an editor redrawing its text keeps them right. A browser without the API shows no highlight.
import { findMatches } from '@ostraka/core/search-match'
import { useEffect, useRef, useState } from 'react'

const NAME = 'ostraka-search'

/** Every view's ranges, painted together under one name. */
const painted = new Map<symbol, Range[]>()

function paint() {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return
  const ranges = [...painted.values()].flat()
  if (ranges.length) CSS.highlights.set(NAME, new Highlight(...ranges))
  else CSS.highlights.delete(NAME)
}

/** Where `query` matches in the text under `root`, outside fields, scripts, styles and the server's own `<mark>`s. */
function rangesIn(root: HTMLElement, query: string): Range[] {
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('input, textarea, script, style, mark') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const { start, end } of findMatches(node.textContent ?? '', query)) {
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, end)
      ranges.push(range)
    }
  }
  return ranges
}

/**
 * Highlights where `query` matches in the element given the returned ref, kept current as it changes. With
 * `scrollKey`, the first match found is scrolled to the middle of the view, once for each key (an item opened at its
 * match).
 */
export function useFindHighlight(query: string | undefined, scrollKey?: string): (element: HTMLElement | null) => void {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const scrolledFor = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!element || !query?.trim()) return
    const id = Symbol(NAME)
    let frame = 0
    const update = () => {
      frame = 0
      const ranges = rangesIn(element, query)
      painted.set(id, ranges)
      paint()
      const [first] = ranges
      if (scrollKey !== undefined && scrolledFor.current !== scrollKey && first) {
        scrolledFor.current = scrollKey
        first.startContainer.parentElement?.scrollIntoView({ block: 'center' })
      }
    }
    update()
    // An editor or a list redrawing: found again once per frame.
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(update)
    })
    observer.observe(element, { subtree: true, childList: true, characterData: true })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      painted.delete(id)
      paint()
    }
  }, [element, query, scrollKey])
  return setElement
}
