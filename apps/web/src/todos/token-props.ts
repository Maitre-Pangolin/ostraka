// Values pulled out of the text while typing a new Todo or Sub-todo, held until it is added.
import type { TokenProps } from '@ostraka/core/todo-tokens'

export const NO_PROPS: TokenProps = { tags: [] }

/** Tokens pulled out later win: Tags add up, a priority or date replaces the one before. */
export const mergeProps = (before: TokenProps, added: TokenProps): TokenProps => ({
  tags: [...new Set([...before.tags, ...added.tags])],
  priority: added.priority ?? before.priority,
  due: added.due ?? before.due,
})
