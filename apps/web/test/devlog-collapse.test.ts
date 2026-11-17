// Which groups of the Dev logs list are open: the default, what the viewer set apart from it, and what a link opens.
import { describe, expect, it } from 'vitest'
import { groupsOf, isGroupOpen, isOpenByDefault, setGroup } from '../src/devlogs/collapse.ts'

const TODAY = '2026-11-16'

describe('isOpenByDefault', () => {
  it('opens the current year and month, and every Week', () => {
    expect(isOpenByDefault('2026', TODAY)).toBe(true)
    expect(isOpenByDefault('2025', TODAY)).toBe(false)
    expect(isOpenByDefault('2026-11', TODAY)).toBe(true)
    expect(isOpenByDefault('2026-10', TODAY)).toBe(false)
    expect(isOpenByDefault('2026-W40', TODAY)).toBe(true)
  })
})

describe('setGroup', () => {
  it('keeps only the groups set apart from their default, with the state chosen', () => {
    const state = setGroup(setGroup({}, '2026-11', false, TODAY), '2026-10', true, TODAY)
    expect(state).toEqual({ '2026-11': false, '2026-10': true })
    expect(setGroup(state, '2026-11', true, TODAY)).toEqual({ '2026-10': true })
  })

  it('keeps a choice as the default moves on: a month closed stays closed once it is past', () => {
    const state = setGroup({}, '2026-11', false, TODAY)
    expect(isGroupOpen(state, '2026-11', '2026-12-01')).toBe(false)
    expect(isGroupOpen(state, '2026-12', '2026-12-01')).toBe(true)
  })
})

describe('groupsOf', () => {
  it('names the year, month and Week holding a day, summary or Week', () => {
    expect(groupsOf('2026-11-16')).toEqual(['2026', '2026-11', '2026-W47'])
    expect(groupsOf('2026-11')).toEqual(['2026', '2026-11'])
    // Week 1 of 2026 starts on Monday 29 December 2025.
    expect(groupsOf('2026-W01')).toEqual(['2025', '2025-12', '2026', '2026-01', '2026-W01'])
  })
})
