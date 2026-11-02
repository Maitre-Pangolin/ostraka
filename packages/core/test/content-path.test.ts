import { describe, expect, it } from 'vitest'
import { CONTENT_KINDS, contentPath } from '../src/index.ts'

const env = { OSTRAKA_HOME: '/content' }

describe('contentPath', () => {
  it.each([
    ['todos', '/content/todos.json'],
    ['notes', '/content/notes'],
    ['devlogs', '/content/devlogs'],
    ['sketches', '/content/sketches'],
    ['people', '/content/people.json'],
    ['tags', '/content/tags.yml'],
  ] as const)('puts %s at %s', async (kind, expected) => {
    expect(await contentPath(kind, { env })).toBe(expected)
  })

  it('lists every kind', () => {
    expect(CONTENT_KINDS).toEqual(['todos', 'notes', 'devlogs', 'sketches', 'people', 'tags'])
  })
})
