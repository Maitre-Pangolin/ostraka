// Which Todo rows expand. Tags, the date and the priority show on the row itself, so only a description or
// Sub-todos give a row something to show under it.
import type { SubTodo, Todo } from '@ostraka/core/todo-schema'

/** A Todo or a Sub-todo, as stored or as the app holds it. */
type Item = Pick<SubTodo, 'id' | 'description'> & Partial<Pick<Todo, 'subTodos'>>

export const isExpandable = (todo: Item) => Boolean(todo.description) || (todo.subTodos?.length ?? 0) > 0

/**
 * The list's Expand all / Collapse all: it reads Collapse all while an expandable row is expanded, Expand all expands
 * only rows that can, and it hides (undefined) when none can. Rows left open without anything to show don't count.
 */
export function expandAll(
  todos: Item[],
  open: ReadonlySet<string>,
): { label: 'Expand all' | 'Collapse all'; next: Set<string> } | undefined {
  const expandable = todos.filter(isExpandable)
  if (!expandable.length) return undefined
  if (expandable.some((todo) => open.has(todo.id))) return { label: 'Collapse all', next: new Set() }
  return { label: 'Expand all', next: new Set(expandable.map((todo) => todo.id)) }
}
