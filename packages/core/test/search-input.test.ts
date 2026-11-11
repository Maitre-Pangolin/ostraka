import { describe, expect, it } from 'vitest'
import { pullSearchChips, searchDateRange, searchQuery } from '../src/search-input.ts'

describe('pullSearchChips', () => {
  it('takes a #tag or @person followed by a space out of the text', () => {
    expect(pullSearchChips('rollout #Infra @alice-martin kafka')).toEqual({
      text: 'rollout kafka',
      tags: ['infra'],
      people: ['alice-martin'],
    })
  })

  it('leaves a token still being typed, and anything that is not one, in the text', () => {
    expect(pullSearchChips('#infra')).toEqual({ text: '#infra', tags: [], people: [] })
    expect(pullSearchChips('mail bob@example.com # x @ #-- ')).toEqual({ text: 'mail bob@example.com # x @ #-- ', tags: [], people: [] })
  })

  it('takes each Tag and Person once', () => {
    expect(pullSearchChips('#api #api @bob @bob ')).toEqual({ text: '', tags: ['api'], people: ['bob'] })
  })
})

describe('searchDateRange', () => {
  const today = '2026-11-03'

  it('reads the last 7 and 30 days up to today, today included', () => {
    expect(searchDateRange('week', today)).toEqual({ from: '2026-10-28', to: today })
    expect(searchDateRange('month', today)).toEqual({ from: '2026-10-05', to: today })
  })

  it('reads this year from 1 January', () => {
    expect(searchDateRange('year', today)).toEqual({ from: '2026-01-01', to: today })
  })

  it('takes a custom range as it is, and any date as no range', () => {
    expect(searchDateRange({ from: '2026-09-01', to: '2026-09-30' }, today)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(searchDateRange('any', today)).toEqual({})
  })
})

describe('searchQuery', () => {
  const today = '2026-11-03'

  it('searches the text with each Person as a whole Mention, the Tags, the kind and the dates', () => {
    expect(
      searchQuery({ text: 'rollout', tags: ['infra', 'api'], tagMatch: 'any', people: ['alice'], kind: 'note', dates: 'week' }, today),
    ).toEqual({ text: 'rollout @alice', tags: ['infra', 'api'], tagMatch: 'any', kinds: ['note'], from: '2026-10-28', to: today })
  })

  it('leaves out what does not narrow', () => {
    expect(searchQuery({ text: ' ', tags: ['infra'], tagMatch: 'all', people: [], kind: 'any', dates: 'any' }, today)).toEqual({
      text: '',
      tags: ['infra'],
    })
  })

  it('is nothing to search when nothing is typed or chosen', () => {
    expect(searchQuery({ text: '', tags: [], tagMatch: 'all', people: [], kind: 'any', dates: 'any' }, today)).toBeUndefined()
  })
})
