import { describe, expect, it } from 'vitest'
import { pullCompletedTokens, pullTokens, suggestTokens } from '../src/todo-tokens.ts'

// Monday 2 November 2026.
const today = '2026-11-02'

describe('pullTokens', () => {
  it('pulls #tag, *prio and ^date out of the text', () => {
    expect(pullTokens('Fix login #auth *high ^fri', { today })).toEqual({
      text: 'Fix login',
      tags: ['auth'],
      priority: 'high',
      due: '2026-11-06',
    })
  })
})

describe('pullTokens: Tags', () => {
  it.each([
    ['#Auth', 'auth'],
    ['#Code_Review', 'code-review'],
    ['#code--review-', 'code-review'],
    ['#v2', 'v2'],
  ])('stores %s lowercased and hyphenated as %s', (token, tag) => {
    expect(pullTokens(`Ship ${token}`, { today }).tags).toEqual([tag])
  })

  it('keeps each Tag once, in the order typed', () => {
    expect(pullTokens('#infra Ship #auth #Infra', { today }).tags).toEqual(['infra', 'auth'])
  })

  it.each(['#', '#-', '#café', 'C#', 'a#b'])('leaves %s in the text', (word) => {
    expect(pullTokens(`Ship ${word}`, { today })).toEqual({ text: `Ship ${word}`, tags: [] })
  })
})

describe('pullTokens: priority', () => {
  it.each([
    ['*high', 'high'],
    ['*med', 'medium'],
    ['*low', 'low'],
    ['*HIGH', 'high'],
  ])('reads %s as %s', (token, priority) => {
    expect(pullTokens(`Ship ${token}`, { today })).toEqual({ text: 'Ship', tags: [], priority })
  })

  it('takes the last one typed', () => {
    expect(pullTokens('*low Ship *high', { today }).priority).toBe('high')
  })

  it.each(['*', '*hi', '*bold*', '*urgent'])('leaves %s in the text', (word) => {
    expect(pullTokens(`Ship ${word}`, { today })).toEqual({ text: `Ship ${word}`, tags: [] })
  })
})

describe('pullTokens: due date', () => {
  // Today is Monday 2 November 2026.
  it.each([
    ['^today', '2026-11-02'],
    ['^tomorrow', '2026-11-03'],
    ['^tue', '2026-11-03'],
    ['^fri', '2026-11-06'],
    ['^Friday', '2026-11-06'],
    ['^sun', '2026-11-08'],
    ['^mon', '2026-11-09'], // the next Monday, not today
    ['^2026-11-05', '2026-11-05'],
    ['^2025-12-31', '2025-12-31'],
  ])('reads %s as %s', (token, due) => {
    expect(pullTokens(`Ship ${token}`, { today })).toEqual({ text: 'Ship', tags: [], due })
  })

  it('crosses month and year ends', () => {
    expect(pullTokens('^tomorrow', { today: '2026-12-31' }).due).toBe('2027-01-01')
    expect(pullTokens('^fri', { today: '2027-02-27' }).due).toBe('2027-03-05')
  })

  it.each(['^', '^fr', '^someday', '^2026-02-30', '^2026-1-5', '^5'])('leaves %s in the text', (word) => {
    expect(pullTokens(`Ship ${word}`, { today })).toEqual({ text: `Ship ${word}`, tags: [] })
  })
})

describe('pullTokens: text', () => {
  it('keeps the lines of a description and their indentation', () => {
    expect(pullTokens('First line #auth\n  - second ^fri\n\nlast *low', { today })).toEqual({
      text: 'First line\n  - second\n\nlast',
      tags: ['auth'],
      priority: 'low',
      due: '2026-11-06',
    })
  })

  it('leaves the spacing between other words as typed', () => {
    expect(pullTokens('a  b #x c', { today }).text).toBe('a  b c')
  })

  it('is empty when the text was only tokens', () => {
    expect(pullTokens('#auth *high', { today })).toEqual({ text: '', tags: ['auth'], priority: 'high' })
  })
})

describe('pullCompletedTokens (while typing)', () => {
  it('takes only tokens followed by a space or a new line, and keeps the rest as typed', () => {
    expect(pullCompletedTokens('Fix #auth login *hi', { today, caret: 19 })).toEqual({
      text: 'Fix login *hi',
      caret: 13,
      tags: ['auth'],
    })
  })

  it('keeps the space before the caret so typing can go on', () => {
    expect(pullCompletedTokens('Fix login #auth ', { today, caret: 16 })).toEqual({ text: 'Fix login ', caret: 10, tags: ['auth'] })
  })

  it('takes a token finished by a new line in a description', () => {
    expect(pullCompletedTokens('Notes ^fri\nmore', { today, caret: 11 })).toEqual({
      text: 'Notes\nmore',
      caret: 6,
      tags: [],
      due: '2026-11-06',
    })
  })

  it('moves the caret only for what left before it', () => {
    expect(pullCompletedTokens('ab #x cd #y ef', { today, caret: 1 })).toEqual({ text: 'ab cd ef', caret: 1, tags: ['x', 'y'] })
    expect(pullCompletedTokens('ab #x cd #y ef', { today, caret: 7 })).toEqual({ text: 'ab cd ef', caret: 4, tags: ['x', 'y'] })
  })

  it('leaves the caret at the start of a token it was inside', () => {
    expect(pullCompletedTokens('a #xyz b', { today, caret: 4 })).toEqual({ text: 'a b', caret: 2, tags: ['xyz'] })
  })

  it('changes nothing when no token is complete', () => {
    expect(pullCompletedTokens('Fix #au', { today, caret: 7 })).toEqual({ text: 'Fix #au', caret: 7, tags: [] })
  })
})

describe('suggestTokens', () => {
  const tags = ['api', 'auth', 'infra']

  it('suggests existing Tags that start with what is typed', () => {
    expect(suggestTokens('#a', { today, tags })).toEqual([
      { token: '#api', kind: 'tag', tag: 'api' },
      { token: '#auth', kind: 'tag', tag: 'auth' },
    ])
    expect(suggestTokens('#', { today, tags }).map((s) => s.token)).toEqual(['#api', '#auth', '#infra'])
  })

  it('offers a new Tag when no existing one starts like that', () => {
    expect(suggestTokens('#Code_R', { today, tags })).toEqual([{ token: '#code-r', kind: 'tag', tag: 'code-r', isNew: true }])
    expect(suggestTokens('#Au', { today, tags })).toEqual([{ token: '#auth', kind: 'tag', tag: 'auth' }])
  })

  it('leaves out Tags the Todo already has', () => {
    expect(suggestTokens('#a', { today, tags, exclude: ['auth'] }).map((s) => s.token)).toEqual(['#api'])
  })

  it('suggests priorities', () => {
    expect(suggestTokens('*', { today, tags })).toEqual([
      { token: '*high', kind: 'priority', priority: 'high' },
      { token: '*med', kind: 'priority', priority: 'medium' },
      { token: '*low', kind: 'priority', priority: 'low' },
    ])
    expect(suggestTokens('*L', { today, tags }).map((s) => s.token)).toEqual(['*low'])
  })

  it('suggests dates with the day they mean', () => {
    expect(suggestTokens('^t', { today, tags })).toEqual([
      { token: '^today', kind: 'due', due: '2026-11-02' },
      { token: '^tomorrow', kind: 'due', due: '2026-11-03' },
      { token: '^tue', kind: 'due', due: '2026-11-03' },
      { token: '^thu', kind: 'due', due: '2026-11-05' },
    ])
    expect(suggestTokens('^', { today, tags })).toHaveLength(9)
    expect(suggestTokens('^2026-11-20', { today, tags })).toEqual([{ token: '^2026-11-20', kind: 'due', due: '2026-11-20' }])
    expect(suggestTokens('^friday', { today, tags })).toEqual([{ token: '^friday', kind: 'due', due: '2026-11-06' }])
  })

  it.each(['', 'fix', '#café', '*x', '^x', '@lea'])('suggests nothing for %j', (fragment) => {
    expect(suggestTokens(fragment, { today, tags })).toEqual([])
  })
})
