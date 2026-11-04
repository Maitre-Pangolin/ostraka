// What the `whats-up` skill reads from the Todos for the Briefing: today's Todos, and the References open Todos
// already mention, so it doesn't suggest a Todo twice. Pure and free of Node and zod.
import { findReferences } from './references.ts'
import type { Priority, Todo } from './todo-schema.ts'
import { compareOpenTodos } from './todo-order.ts'

/** How many high-priority Todos without a due date the Briefing shows. */
const HIGH_PRIORITY_UNDATED = 3

/** A Todo in the Briefing; a Sub-todo's title is `Parent › Sub-todo`. */
export type BriefingTodo = {
  id: string
  title: string
  due?: string
  priority: Priority
  tags: string[]
  why: 'overdue' | 'due today' | 'high priority'
}

/** Open Todos and open Sub-todos, a Sub-todo titled `Parent › Sub-todo`. */
function openItems(todos: Todo[]) {
  return todos
    .filter((todo) => todo.status === 'open')
    .flatMap((todo) => [
      { item: todo, title: todo.title },
      ...todo.subTodos.filter((sub) => sub.status === 'open').map((sub) => ({ item: sub, title: `${todo.title} › ${sub.title}` })),
    ])
}

/**
 * Today's Todos: overdue ones, then those due today, then the top 3 high-priority ones without a due date. A
 * Sub-todo shows on its own merit, not its parent's.
 */
export function todaysTodos(todos: Todo[], today: string): BriefingTodo[] {
  const compare = compareOpenTodos(today)
  const items = openItems(todos).toSorted((a, b) => compare(a.item, b.item))
  const dueBy = items.filter(({ item }) => item.due !== undefined && item.due <= today)
  const high = items.filter(({ item }) => item.due === undefined && item.priority === 'high').slice(0, HIGH_PRIORITY_UNDATED)
  return [...dueBy, ...high].map(({ item, title }) => ({
    id: item.id,
    title,
    ...(item.due !== undefined && { due: item.due }),
    priority: item.priority,
    tags: item.tags,
    why: item.due === undefined ? 'high priority' : item.due < today ? 'overdue' : 'due today',
  }))
}

/** Every MR and Jira token in the titles and descriptions of open Todos and open Sub-todos, each once, in order. */
export function mentionedReferences(todos: Todo[]): string[] {
  const texts = openItems(todos).flatMap(({ item }) => [item.title, item.description ?? ''])
  return [...new Set(texts.flatMap((text) => findReferences(text).map((found) => found.token)))]
}
