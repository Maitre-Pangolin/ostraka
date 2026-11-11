// Mermaid code blocks drawn in place in the Notes editor. Mermaid loads on the first diagram, not with the app.
import { mermaidErrorMessage, renderMermaid } from '@/lib/mermaid'
import type { RenderPreview } from './note-editor-setup'

/** The Notes editor's code-block preview: Mermaid blocks render as their diagram; other code has no preview. */
export const renderMermaidPreview: RenderPreview = (language, code, apply) => {
  if (language.toLowerCase() !== 'mermaid' || !code.trim()) return null
  void (async () => {
    try {
      apply(await renderMermaid(code))
    } catch (error) {
      const message = document.createElement('p')
      message.className = 'text-destructive text-xs'
      message.textContent = mermaidErrorMessage(error)
      apply(message)
    }
  })()
  return undefined
}
