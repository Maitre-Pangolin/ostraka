// Mentions highlighted in the Notes editor (and a Dev log being edited), beside References in the same
// `tokenHighlight`: core's grammar finds them, and only a Mention of a Person in the People directory (or a new one
// picked in this window) is highlighted, with their name as its title, a Stub Person's underlined with dots. The text
// stays `@<person id>`.
import { findMentions } from '@ostraka/core/mentions'
import type { TokenHighlighter } from '../notes/token-highlight'

/** The Person's id in a Mention's token. */
const idOf = (token: string) => token.slice(1)

/** What the highlight shows of a mentioned Person: their name, and whether they are a Stub Person. */
export type MentionedPerson = { name: string; stub: boolean }

/** Highlights each Mention of a known Person; `personOf` gives them, or undefined for an id not in the directory. */
export function mentionHighlighter(personOf: (id: string) => MentionedPerson | undefined): TokenHighlighter {
  return {
    find: (text) => findMentions(text).filter((found) => personOf(found.id) !== undefined),
    attrs: (token) => {
      const person = personOf(idOf(token))
      return {
        class: person?.stub ? 'ostraka-mention ostraka-mention-stub' : 'ostraka-mention',
        'data-mention': idOf(token),
        title: person ? `${person.name}${person.stub ? ' (incomplete)' : ''}` : '',
      }
    },
  }
}
