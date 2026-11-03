// Mermaid, drawn in the app's theme: Mermaid blocks in Notes and the Sketch preview. Mermaid loads with the first
// diagram, not with the app.

let renders = 0

/** Whether the app shows its dark theme. */
export const isDark = () => document.documentElement.classList.contains('dark')

/** Draws Mermaid text as an SVG string, in the light or dark theme; throws when the text doesn't parse. */
export async function renderMermaid(code: string, dark = isDark()): Promise<string> {
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'neutral', fontFamily: 'Geist Variable, sans-serif' })
  // Parsing first keeps a failed render from leaving Mermaid's error diagram in the page.
  await mermaid.parse(code)
  const { svg } = await mermaid.render(`mermaid-${++renders}`, code)
  return svg
}

/** A Mermaid error as one line to show in place of the diagram. */
export const mermaidErrorMessage = (error: unknown) =>
  `Diagram can't be drawn: ${String((error as Error | undefined)?.message ?? error).split('\n')[0]}`
