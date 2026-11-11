import type { Priority } from '@ostraka/core/todo-schema'

export const PRIORITY_LABEL: Record<Priority, string> = { high: 'High', medium: 'Medium', low: 'Low', none: 'No priority' }

/**
 * The round checkbox (or dot) of a prioritised Todo: a 2px ring in its priority colour with a light tint inside. No
 * priority keeps the plain 1px input ring. The checkbox's own checked and focus styles still win.
 */
export const PRIORITY_RING: Record<Priority, string> = {
  high: 'border-2 border-prio-high bg-prio-high/12 dark:bg-prio-high/20',
  medium: 'border-2 border-prio-med bg-prio-med/12 dark:bg-prio-med/20',
  low: 'border-2 border-prio-low bg-prio-low/12 dark:bg-prio-low/20',
  none: 'border border-input',
}
