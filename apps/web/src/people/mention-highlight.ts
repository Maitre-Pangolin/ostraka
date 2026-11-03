// Mentions highlighted in the Notes editor (and a Dev log being edited): `@<person id>` stays plain text in the
// Markdown, and a Mention of a Person in the People directory is decorated in place (`.ostraka-mention`, their name
// as its title). Its own ProseMirror plugin, so it sits beside other token highlighting in the same editor. Kept free
// of React so the editor's tests run it as the app does.
import { findMentions } from '@ostraka/core/mentions'
import type { Node } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'

/** The People directory as the highlighting needs it: name by id. */
export type MentionNames = ReadonlyMap<string, string>

type HighlightState = { names: MentionNames; decorations: DecorationSet }

const key = new PluginKey<HighlightState>('ostraka-mentions')

function decorate(doc: Node, names: MentionNames): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'code_block') return false
    if (!node.isText || !node.text || node.marks.some((mark) => mark.type.name === 'inlineCode')) return
    for (const found of findMentions(node.text)) {
      const name = names.get(found.id)
      if (name === undefined) continue
      decorations.push(
        Decoration.inline(pos + found.start, pos + found.end, { class: 'ostraka-mention', title: name, 'data-mention': found.id }),
      )
    }
  })
  return DecorationSet.create(doc, decorations)
}

/** The plugin; the names come later, through `setMentionNames`, once the People directory has loaded. */
export const mentionHighlight = () =>
  new Plugin<HighlightState>({
    key,
    state: {
      init: (_config, state) => ({ names: new Map(), decorations: DecorationSet.create(state.doc, []) }),
      apply(tr, previous) {
        const names = (tr.getMeta(key) as MentionNames | undefined) ?? previous.names
        if (names === previous.names && !tr.docChanged) return previous
        return { names, decorations: decorate(tr.doc, names) }
      },
    },
    props: { decorations: (state: EditorState) => key.getState(state)?.decorations },
  })

/** Highlights Mentions of these Persons from now on. */
export function setMentionNames(view: EditorView, names: MentionNames): void {
  view.dispatch(view.state.tr.setMeta(key, names))
}
