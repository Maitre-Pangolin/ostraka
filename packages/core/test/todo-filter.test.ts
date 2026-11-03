import { describe, expect, it } from 'vitest'
import type { SubTodo, Todo } from '../src/todo-schema.ts'
import { filterTodos, isFiltering, parseTodoFilter } from '../src/todo-filter.ts'

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

const titles = (todos: Todo[], filter: Parameters<typeof filterTodos>[1]) => filterTodos(todos, filter).map((kept) => kept.todo.title)

describe('filterTodos', () => {
  it('keeps the Todos with one of the chosen priorities, in the order given', () => {
    const todos = [todo('Ship', { priority: 'high' }), todo('Plan', { priority: 'low' }), todo('Read'), todo('Fix', { priority: 'high' })]
    expect(titles(todos, { priority: ['high', 'none'] })).toEqual(['Ship', 'Read', 'Fix'])
  })

  const tagged = [
    todo('Both', { tags: ['api', 'auth'] }),
    todo('Api', { tags: ['api'] }),
    todo('Auth', { tags: ['auth', 'ux'] }),
    todo('None'),
  ]

  it('keeps the Todos with all of the chosen Tags by default', () => {
    expect(titles(tagged, { tag: ['auth', 'api'] })).toEqual(['Both'])
  })

  it('keeps the Todos with any of the chosen Tags when asked', () => {
    expect(titles(tagged, { tag: ['auth', 'api'], match: 'any' })).toEqual(['Both', 'Api', 'Auth'])
  })

  it('combines priority and Tags with AND', () => {
    const todos = [
      todo('Urgent api', { priority: 'high', tags: ['api'] }),
      todo('Calm api', { tags: ['api'] }),
      todo('Urgent', { priority: 'high' }),
    ]
    expect(titles(todos, { priority: ['high'], tag: ['api'] })).toEqual(['Urgent api'])
  })

  it('keeps a parent dimmed for context when only some of its Sub-todos match, with just those', () => {
    const parent = todo('Release', { subTodos: [sub('Notes', { tags: ['docs'] }), sub('Tag build'), sub('Blog', { tags: ['docs'] })] })
    expect(filterTodos([parent, todo('Other')], { tag: ['docs'] })).toEqual([
      { todo: parent, dimmed: true, subTodos: [parent.subTodos[0], parent.subTodos[2]] },
    ])
  })

  it('shows a matching parent as it is, with its matching Sub-todos', () => {
    const parent = todo('Release', { tags: ['docs'], subTodos: [sub('Notes', { tags: ['docs'] }), sub('Tag build')] })
    expect(filterTodos([parent], { tag: ['docs'] })).toEqual([{ todo: parent, dimmed: false, subTodos: [parent.subTodos[0]] }])
  })

  it('keeps the Todos that mention all of the chosen Persons, in the title or the description', () => {
    const todos = [
      todo('Pair with @ilse-vantongeren', { description: 'and @bram' }),
      todo('Ask @bram'),
      todo('Sync', { description: 'Loop in @ilse-vantongeren' }),
      todo('Email ilse@corp.example'),
    ]
    expect(titles(todos, { person: ['ilse-vantongeren'] })).toEqual(['Pair with @ilse-vantongeren', 'Sync'])
    expect(titles(todos, { person: ['ilse-vantongeren', 'bram'] })).toEqual(['Pair with @ilse-vantongeren'])
    expect(titles(todos, { person: ['bram'], tag: ['api'] })).toEqual([])
  })

  it('keeps a parent dimmed when only a Sub-todo mentions the chosen Person', () => {
    const parent = todo('Release', { subTodos: [sub('Review with @bram'), sub('Tag build')] })
    expect(filterTodos([parent], { person: ['bram'] })).toEqual([{ todo: parent, dimmed: true, subTodos: [parent.subTodos[0]] }])
  })

  it('keeps everything when nothing is chosen', () => {
    expect(titles(tagged, { priority: [], tag: [] })).toEqual(['Both', 'Api', 'Auth', 'None'])
  })
})

describe('isFiltering', () => {
  it('is true only once a priority or a Tag is chosen', () => {
    expect(isFiltering({})).toBe(false)
    expect(isFiltering({ priority: [], tag: [], match: 'any' })).toBe(false)
    expect(isFiltering({ priority: ['low'] })).toBe(true)
    expect(isFiltering({ tag: ['api'] })).toBe(true)
    expect(isFiltering({ person: ['bram'] })).toBe(true)
    expect(isFiltering({ person: [] })).toBe(false)
  })
})

// The filter lives in the Todos view's URL search params, so whatever is there is checked before use.
describe('parseTodoFilter', () => {
  it('reads priorities, Tags and the any-of toggle', () => {
    expect(parseTodoFilter({ priority: ['high', 'none'], tag: ['api', 'auth'], match: 'any' })).toEqual({
      priority: ['high', 'none'],
      tag: ['api', 'auth'],
      match: 'any',
    })
  })

  it('reads mentioned Persons by id, each once, leaving out what is not an id', () => {
    expect(parseTodoFilter({ person: ['bram', 'ilse-vantongeren', 'bram', 'Not An Id', 3] })).toEqual({ person: ['bram', 'ilse-vantongeren'] })
    expect(parseTodoFilter({ person: 'bram' })).toEqual({ person: ['bram'] })
    expect(parseTodoFilter({ person: [] })).toEqual({})
  })

  it('leaves out what is empty or unknown, so a plain list has no search params', () => {
    expect(parseTodoFilter({ priority: [], tag: [], match: 'all', other: 1 })).toEqual({})
    expect(parseTodoFilter({ priority: ['urgent', 3], tag: ['Not a tag!', null], match: true })).toEqual({})
  })

  it('takes a single value typed by hand, and each value once', () => {
    expect(parseTodoFilter({ priority: 'low', tag: ['api', 'api'] })).toEqual({ priority: ['low'], tag: ['api'] })
  })
})
