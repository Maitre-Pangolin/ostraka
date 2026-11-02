// Narrowing the Todo list by priority and Tags. Pure and free of Node and zod, so the web app can share it.
import type { Priority, SubTodo, Todo } from './todo-schema.ts'
import { normalizeTag } from './todo-tokens.ts'

/** What the list is narrowed to. A missing group doesn't narrow. */
export type TodoFilter = {
  /** Any of these priorities. */
  priority?: Priority[]
  /** All of these Tags, or any of them with `match: 'any'`. */
  tag?: string[]
  match?: 'any'
}

/**
 * A Todo the filter keeps, with its matching Sub-todos. `dimmed` marks a parent that doesn't match itself and is
 * there only for context around them.
 */
export type FilteredTodo = { todo: Todo; dimmed: boolean; subTodos: SubTodo[] }

function matches(todo: SubTodo, { priority = [], tag = [], match }: TodoFilter): boolean {
  const hasTag = (name: string) => todo.tags.includes(name)
  return (!priority.length || priority.includes(todo.priority)) && (!tag.length || (match === 'any' ? tag.some(hasTag) : tag.every(hasTag)))
}

/** Whether the filter narrows anything: a priority or a Tag is chosen. */
export const isFiltering = (filter: TodoFilter) => Boolean(filter.priority?.length || filter.tag?.length)

// The schema's PRIORITIES come with zod; this module stays free of it.
const PRIORITIES: readonly Priority[] = ['high', 'medium', 'low', 'none']
const isPriority = (value: unknown): value is Priority => PRIORITIES.includes(value as Priority)

/** Each valid value once; a single value counts as a list of one. */
function values<T>(raw: unknown, valid: (value: unknown) => T | undefined): T[] {
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]
  return [...new Set(list.map(valid).filter((value) => value !== undefined))]
}

/**
 * The filter in URL search params, checked: unknown values are left out, and so are empty groups and the default
 * all-of match, so an unfiltered list has no search params.
 */
export function parseTodoFilter(search: Record<string, unknown>): TodoFilter {
  const priority = values(search.priority, (value) => (isPriority(value) ? value : undefined))
  const tag = values(search.tag, (value) => (typeof value === 'string' ? normalizeTag(value) : undefined))
  return {
    ...(priority.length > 0 && { priority }),
    ...(tag.length > 0 && { tag }),
    ...(search.match === 'any' && { match: 'any' }),
  }
}

/** The Todos the filter keeps, in the order given: those that match, and parents of Sub-todos that match. */
export function filterTodos(todos: Todo[], filter: TodoFilter): FilteredTodo[] {
  return todos.flatMap((todo) => {
    const subTodos = todo.subTodos.filter((subTodo) => matches(subTodo, filter))
    const dimmed = !matches(todo, filter)
    return dimmed && !subTodos.length ? [] : [{ todo, dimmed, subTodos }]
  })
}
