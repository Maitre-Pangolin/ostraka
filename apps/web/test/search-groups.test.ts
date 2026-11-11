import { describe, expect, it } from 'vitest'
import type { SearchHit } from '@ostraka/core/search-types'
import { groupHits } from '../src/search/groups'

const hit = (kind: SearchHit['kind'], id: string): SearchHit => ({ kind, id, title: id, date: '2026-11-01', tags: [], snippet: [] })

describe('groupHits', () => {
  it('groups hits by kind, kinds in the order of their best hit, keeping the ranking within each', () => {
    const groups = groupHits([hit('note', 'a'), hit('devlog', 'b'), hit('note', 'c'), hit('todo', 'd'), hit('devlog', 'e')])
    expect(groups.map((group) => [group.kind, group.hits.map((found) => found.id)])).toEqual([
      ['note', ['a', 'c']],
      ['devlog', ['b', 'e']],
      ['todo', ['d']],
    ])
  })
})
