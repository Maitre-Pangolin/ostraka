// Suggestions for the word being typed in the Notes editor: References after `!` or `KEY-` (Mentions join with
// their own `suggest`). The plugin only watches the caret and reports what to offer; the list, the keys and the
// picking live with the editor's React component. Picking writes the plain token, followed by a space.
import { Plugin, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

/** What is offered for the word before the caret, which runs from `from` to `to`. */
export type OpenSuggestions<S> = { fragment: string; from: number; to: number; suggestions: S[] }

/** The word before the caret: back to a space, an opening bracket or quote, or something not text. */
function fragmentAt(state: EditorState): { fragment: string; from: number; to: number } | undefined {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type.spec.code) return undefined
  if ($from.marks().some((mark) => mark.type.name === 'link' || mark.type.spec.code)) return undefined
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
  const fragment = /[^\s￼([{"'“‘]*$/.exec(before)?.[0] ?? ''
  return fragment ? { fragment, from: $from.pos - fragment.length, to: $from.pos } : undefined
}

export function tokenSuggest<S extends { token: string }>({
  suggest,
  onChange,
}: {
  /** What to offer for a word being typed; nothing for most words. */
  suggest: (fragment: string) => S[]
  /** Called when what is offered changes, `undefined` when nothing is. */
  onChange: (open: OpenSuggestions<S> | undefined, view: EditorView) => void
}): Plugin {
  return new Plugin({
    view: () => {
      let last: string | undefined
      return {
        update: (view) => {
          const at = view.hasFocus() ? fragmentAt(view.state) : undefined
          const suggestions = at ? suggest(at.fragment) : []
          const open = at && suggestions.length > 0 ? { ...at, suggestions } : undefined
          const seen = open && `${open.from} ${open.fragment} ${open.suggestions.map((suggestion) => suggestion.token).join(' ')}`
          if (seen === last) return
          last = seen
          onChange(open, view)
        },
      }
    },
  })
}

/** Replaces the word being typed with `suggestion`'s token and a space. */
export function pickSuggestion<S extends { token: string }>(view: EditorView, open: OpenSuggestions<S>, suggestion: S) {
  view.dispatch(view.state.tr.insertText(`${suggestion.token} `, open.from, open.to))
  view.focus()
}
