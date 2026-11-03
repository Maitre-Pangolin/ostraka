// Sub-todo rules that need no file access, so the web app can share them.
import type { SubTodo } from './todo-schema.ts'

/** An open Sub-todo due after its parent: a plan that can't hold, worth a warning. */
export function dueAfterParent(sub: SubTodo, parent: SubTodo): boolean {
  return sub.status === 'open' && sub.due !== undefined && parent.due !== undefined && sub.due > parent.due
}
