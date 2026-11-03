// Mermaid code blocks drawn in place in the Notes editor. Mermaid loads on the first diagram, not with the app.
import type { RenderPreview } from './note-editor-setup'

let renders = 0

/** The Notes editor's code-block preview: Mermaid blocks render as their diagram; other code has no preview. */
export const renderMermaidPreview: RenderPreview = (language, code, apply) => {
  if (language.toLowerCase() !== 'mermaid' || !code.trim()) return null
  void (async () => {
    const { default: mermaid } = await import('mermaid')
    const dark = document.documentElement.classList.contains('dark')
    mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'neutral', fontFamily: 'Geist Variable, sans-serif' })
    try {
      const { svg } = await mermaid.render(`note-mermaid-${++renders}`, code)
      apply(svg)
    } catch (error) {
      const message = document.createElement('p')
      message.className = 'text-destructive text-xs'
      message.textContent = `Diagram can't be drawn: ${String((error as Error)?.message ?? error).split('\n')[0]}`
      apply(message)
    }
  })()
  return undefined
}
