// Mentions highlighted in the Notes editor (and a Dev log being edited), beside References in the same
// `tokenHighlight`: core's grammar finds them, and only a Mention of a Person in the People directory is highlighted,
// with their name as its title. The text stays `@<person id>`.
import { findMentions } from '@ostraka/core/mentions'
import type { TokenHighlighter } from '../notes/token-highlight'

/** The Person's id in a Mention's token. */
const idOf = (token: string) => token.slice(1)

/** Highlights each Mention of a known Person; `nameOf` gives their name, or undefined for an id not in the directory. */
export function mentionHighlighter(nameOf: (id: string) => string | undefined): TokenHighlighter {
  return {
    find: (text) => findMentions(text).filter((found) => nameOf(found.id) !== undefined),
    attrs: (token) => ({ class: 'ostraka-mention', 'data-mention': idOf(token), title: nameOf(idOf(token)) ?? '' }),
  }
}
