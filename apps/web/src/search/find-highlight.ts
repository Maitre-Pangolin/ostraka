// Search matches highlighted in what a view shows (a list, a rendered Dev log, the Notes editor), without touching
// its DOM: the CSS Custom Highlight API paints ranges over its text nodes (`::highlight(ostraka-search)` in
// index.css). Where the text matches is core's (`findMatches`); a Mention or Reference chip matches by its token, so
// `@jane-doe` paints the chip showing Jane's name. The ranges are found again whenever the view's DOM
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

/** Chips showing a Mention or a Reference as something other than its token: a name, `!809`. */
const CHIPS = '[data-mention-chip], [data-reference-chip]'
const chipToken = (chip: HTMLElement) => chip.dataset.referenceChip ?? `@${chip.dataset.mentionChip}`

/**
 * Where `query` matches under `root`, in document order: in its text, outside fields, scripts, styles and the
 * server's own `<mark>`s, and on each chip whose token matches (the whole chip, its own text left out).
 */
export function findRanges(root: HTMLElement, query: string): Range[] {
  const ranges: Range[] = []
  const chips = new Set<Element>()
  for (const chip of root.querySelectorAll<HTMLElement>(CHIPS)) {
    if (!findMatches(chipToken(chip), query).length) continue
    chips.add(chip)
    const range = document.createRange()
    range.selectNodeContents(chip)
    ranges.push(range)
  }
  const inMatchedChip = (node: Node) => [...chips].some((chip) => chip.contains(node))
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('input, textarea, script, style, mark') || inMatchedChip(node)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const { start, end } of findMatches(node.textContent ?? '', query)) {
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, end)
      ranges.push(range)
    }
  }
  return ranges.toSorted((a, b) => a.compareBoundaryPoints(Range.START_TO_START, b))
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
      const ranges = findRanges(element, query)
      painted.set(id, ranges)
      paint()
      const [first] = ranges
      if (scrollKey !== undefined && scrolledFor.current !== scrollKey && first) {
        scrolledFor.current = scrollKey
        const at = first.startContainer
        const target = at instanceof Element ? at : at.parentElement // A chip's range starts in the chip itself.
        target?.scrollIntoView({ block: 'center' })
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
