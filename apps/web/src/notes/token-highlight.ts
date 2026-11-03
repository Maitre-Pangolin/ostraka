// Tokens highlighted in place in the Notes editor: decorated text, never a node, so the Markdown stays the plain
// token. Each kind of token (References; Mentions join with their own highlighter) brings how to find it, how it
// looks, and optionally a small dot after it. Code and link text are left alone.
import type { Node } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'

export type TokenHighlighter = {
  /** The tokens in a run of plain text, `end` exclusive. */
  find(text: string): { token: string; start: number; end: number }[]
  /** Attributes of the highlighted text: its class, `data-*` naming the token. */
  attrs(token: string): Record<string, string>
  /** The class of a dot shown after the token (a status), or none. */
  dot?(token: string): string | undefined
}

const key = new PluginKey<DecorationSet>('token-highlight')

/** Stands in for what no token may cross or include: code, link text, an inline node. */
const BLOCKED = '￼'

/** A textblock's text, one character per position, with code and link text blocked out. */
function plainText(block: Node): string {
  let text = ''
  block.forEach((child) => {
    const skipped = !child.isText || child.marks.some((mark) => mark.type.name === 'link' || mark.type.spec.code)
    text += skipped ? BLOCKED.repeat(child.nodeSize) : child.text!
  })
  return text
}

const DOT = 'ostraka-token-dot inline-block size-1.5 shrink-0 rounded-full align-middle ml-0.5'

function decorate(state: EditorState, highlighters: TokenHighlighter[]): DecorationSet {
  const decorations: Decoration[] = []
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (node.type.spec.code) return false
    const text = plainText(node)
    for (const highlighter of highlighters) {
      for (const { token, start, end } of highlighter.find(text)) {
        if (text.slice(start, end).includes(BLOCKED)) continue
        const from = pos + 1 + start
        const to = pos + 1 + end
        decorations.push(Decoration.inline(from, to, highlighter.attrs(token)))
        const dot = highlighter.dot?.(token)
        if (dot)
          decorations.push(
            Decoration.widget(to, () => Object.assign(document.createElement('span'), { className: `${DOT} ${dot}` }), {
              side: -1,
              key: `${token} ${dot}`,
              ignoreSelection: true,
            }),
          )
      }
    }
    return false
  })
  return DecorationSet.create(state.doc, decorations)
}

/**
 * Highlights the tokens `highlighters()` find, read again on each change and on `refreshTokenHighlight` (for a
 * status that changed outside the editor).
 */
export function tokenHighlight(highlighters: () => TokenHighlighter[]): Plugin<DecorationSet> {
  return new Plugin({
    key,
    state: {
      init: (_config, state) => decorate(state, highlighters()),
      apply: (tr, previous, _old, state) => (tr.docChanged || tr.getMeta(key) ? decorate(state, highlighters()) : previous),
    },
    props: { decorations: (state) => key.getState(state) },
  })
}

/** Draws the highlights again, as when a Reference's status changed. */
export function refreshTokenHighlight(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(key, true))
}
