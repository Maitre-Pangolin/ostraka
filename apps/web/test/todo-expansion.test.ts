// Which Todo rows can expand, and what Expand all / Collapse all does with them.
import { describe, expect, it } from 'vitest'
import type { SubTodo, Todo } from '@ostraka/core/todo-schema'
import { expandAll, isExpandable } from '../src/todos/expansion.ts'

const subTodo = (id: string, extra: Partial<SubTodo> = {}): SubTodo => ({
  id,
  title: id,
  priority: 'none',
  tags: [],
  status: 'open',
  createdAt: '2026-11-01T09:00:00.000Z',

  ...extra,
})

const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({ ...subTodo(id), subTodos: [], ...extra })

describe('isExpandable', () => {
  it('expands a Todo with a description or Sub-todos, never one with only a title, Tags, a date or a priority', () => {
    expect(isExpandable(todo('a', { description: 'Notes' }))).toBe(true)
    expect(isExpandable(todo('b', { subTodos: [subTodo('c')] }))).toBe(true)
    expect(isExpandable(todo('d', { tags: ['work'], due: '2026-11-12', priority: 'high' }))).toBe(false)
    expect(isExpandable(subTodo('e', { description: 'Why' }))).toBe(true)
    expect(isExpandable(subTodo('f'))).toBe(false)
  })
})

describe('expandAll', () => {
  const plain = todo('plain', { tags: ['work'] })
  const described = todo('described', { description: 'Notes' })
  const parent = todo('parent', { subTodos: [subTodo('child')] })

  it('offers Expand all for the rows that can expand, leaving title-only ones collapsed', () => {
    const button = expandAll([plain, described, parent], new Set())
    expect(button?.label).toBe('Expand all')
    expect([...(button?.next ?? [])].toSorted()).toEqual(['described', 'parent'])
  })

  it('reads Collapse all while an expandable row is expanded, and collapses everything', () => {
    const button = expandAll([plain, described, parent], new Set(['parent']))
    expect(button?.label).toBe('Collapse all')
    expect(button?.next.size).toBe(0)
  })

  it('ignores a title-only row left open, and hides when no row can expand', () => {
    expect(expandAll([plain, described], new Set(['plain']))?.label).toBe('Expand all')
    expect(expandAll([plain], new Set(['plain']))).toBeUndefined()
  })
})
