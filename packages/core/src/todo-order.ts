import type { Priority, SubTodo } from './todo-schema.ts'

const pad = (n: number) => String(n).padStart(2, '0')

/** The local calendar day of a moment, as YYYY-MM-DD. Due dates are local days, so "today" is too. */
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2, none: 3 }

/** Open Todos: overdue, then due today, then priority (none last), then due date (none last), then newest. */
export function compareOpenTodos(today: string): (a: SubTodo, b: SubTodo) => number {
  const urgency = (todo: SubTodo) => (todo.due === undefined || todo.due > today ? 2 : todo.due < today ? 0 : 1)
  return (a, b) =>
    urgency(a) - urgency(b) ||
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    (a.due ?? '9999-99-99').localeCompare(b.due ?? '9999-99-99') ||
    b.createdAt.localeCompare(a.createdAt)
}

/** Done and Dropped Todos: newest-finished first. */
export const compareFinishedTodos = (a: SubTodo, b: SubTodo) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? '')
