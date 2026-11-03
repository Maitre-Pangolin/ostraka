// The live preview's drawing: Mermaid text → SVG, redrawn after a short pause in typing and on a theme change.
import { useEffect, useRef, useState } from 'react'
import { isDark, mermaidErrorMessage, renderMermaid } from '@/lib/mermaid'

/** How long typing pauses before the preview is redrawn. */
const DRAW_AFTER_MS = 250

/** Whether `<html>` is dark: the diagram is redrawn in the other theme when it switches. */
function useDark() {
  const [dark, setDark] = useState(isDark)
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDark()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

/**
 * The diagram for `text`: the last one that drew, kept on screen while the text doesn't parse, and the current
 * text's error, if any. The first drawing starts at once; later ones wait for a pause in typing.
 */
export function useMermaid(text: string): { svg?: string; error?: string } {
  const dark = useDark()
  const [drawn, setDrawn] = useState<{ svg?: string; error?: string }>({})
  const latest = useRef(0)
  const started = useRef(false)
  useEffect(() => {
    const draw = ++latest.current
    const wait = started.current ? DRAW_AFTER_MS : 0
    started.current = true
    const timer = setTimeout(async () => {
      if (!text.trim()) return setDrawn({})
      try {
        const svg = await renderMermaid(text, dark)
        if (draw === latest.current) setDrawn({ svg })
      } catch (error) {
        if (draw === latest.current) setDrawn((current) => ({ svg: current.svg, error: mermaidErrorMessage(error) }))
      }
    }, wait)
    return () => clearTimeout(timer)
  }, [text, dark])
  return drawn
}
