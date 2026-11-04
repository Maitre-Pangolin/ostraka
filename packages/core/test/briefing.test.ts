import { describe, expect, it } from 'vitest'
import { mentionedReferences, todaysTodos } from '../src/briefing.ts'
import type { SubTodo, Todo } from '../src/todo-schema.ts'

let created = 0
const sub = (title: string, props: Partial<SubTodo> = {}): SubTodo => ({
  id: title.slice(0, 5).toLowerCase().padEnd(5, '0'),
  title,
  priority: 'none',
  tags: [],
  status: 'open',
  createdAt: new Date(Date.UTC(2026, 10, 1, 0, created++)).toISOString(),
  ...props,
})
const todo = (title: string, props: Partial<Todo> = {}): Todo => ({ ...sub(title), subTodos: [], ...props })

const TODAY = '2026-11-04'
const lines = (todos: Todo[]) => todaysTodos(todos, TODAY).map(({ title, why }) => `${title} (${why})`)

describe('todaysTodos', () => {
  it('is the overdue Todos, then those due today, then the top 3 high-priority ones without a due date', () => {
    const todos = [
      todo('Later', { due: '2026-11-06', priority: 'high' }),
      todo('Today', { due: TODAY }),
      todo('Late', { due: '2026-11-02', priority: 'low' }),
      todo('Urgent a', { priority: 'high' }),
      todo('Urgent b', { priority: 'high' }),
      todo('Urgent c', { priority: 'high' }),
      todo('Urgent d', { priority: 'high' }),
      todo('Someday', { priority: 'medium' }),
    ]
    expect(lines(todos)).toEqual([
      'Late (overdue)',
      'Today (due today)',
      'Urgent d (high priority)',
      'Urgent c (high priority)',
      'Urgent b (high priority)',
    ])
  })

  it('shows an open Sub-todo as Parent › Sub-todo, on its own merit, and leaves finished ones out', () => {
    const todos = [
      todo('Release', {
        subTodos: [
          sub('Write notes', { due: '2026-11-03' }),
          sub('Tag it', { due: '2026-11-03', status: 'done' }),
          sub('Announce', { priority: 'high' }),
        ],
      }),
    ]
    expect(lines(todos)).toEqual(['Release › Write notes (overdue)', 'Release › Announce (high priority)'])
  })

  it('keeps what the CLI prints for each: id, due date, priority and Tags', () => {
    const [first] = todaysTodos([todo('Fix login', { id: 'ab12c', due: TODAY, priority: 'high', tags: ['auth'] })], TODAY)
    expect(first).toEqual({ id: 'ab12c', title: 'Fix login', due: TODAY, priority: 'high', tags: ['auth'], why: 'due today' })
  })
})

describe('mentionedReferences', () => {
  it('is every MR and Jira token in open Todos and open Sub-todos, titles and descriptions, each once', () => {
    const todos = [
      todo('Review acme/billing/api!412', {
        description: 'For BILL-231, see also acme/web!7',
        subTodos: [sub('Reply on BILL-231'), sub('Close OPS-9', { status: 'dropped' })],
      }),
      todo('Plan the week'),
    ]
    expect(mentionedReferences(todos)).toEqual(['acme/billing/api!412', 'BILL-231', 'acme/web!7'])
  })
})
