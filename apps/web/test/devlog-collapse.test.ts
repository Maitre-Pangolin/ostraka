// Which groups of the Dev logs list are open: the default, what the viewer set apart from it, and what a link opens.
import { describe, expect, it } from 'vitest'
import { groupsToReveal, isGroupOpen, isOpenByDefault, setGroup } from '../src/devlogs/collapse.ts'

const TODAY = '2026-11-16'

describe('isOpenByDefault', () => {
  it('opens the current year, month and Week only', () => {
    expect(isOpenByDefault('2026', TODAY)).toBe(true)
    expect(isOpenByDefault('2025', TODAY)).toBe(false)
    expect(isOpenByDefault('2026-11', TODAY)).toBe(true)
    expect(isOpenByDefault('2026-10', TODAY)).toBe(false)
    expect(isOpenByDefault('2026-W47', TODAY)).toBe(true)
    expect(isOpenByDefault('2026-W46', TODAY)).toBe(false)
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

/** These groups open, the rest closed. */
const open = (...ids: string[]) => Set.prototype.has.bind(new Set(ids))

describe('groupsToReveal', () => {
  it('names the year and month holding a day or summary, leaving its Week as it is', () => {
    expect(groupsToReveal('2026-11-16', open())).toEqual(['2026', '2026-11'])
    expect(groupsToReveal('2026-11', open())).toEqual(['2026', '2026-11'])
  })

  it('opens no month for a Week already showing under one of its two', () => {
    // Week 5 of 2026 runs from Monday 26 January to Sunday 1 February.
    expect(groupsToReveal('2026-W05', open('2026', '2026-01'))).toEqual([])
    expect(groupsToReveal('2026-W05', open('2026', '2026-02'))).toEqual([])
  })

  it("opens its Monday's month for a Week showing under neither, across a new year too", () => {
    expect(groupsToReveal('2026-W05', open())).toEqual(['2026', '2026-01'])
    // Week 1 of 2026 starts on Monday 29 December 2025.
    expect(groupsToReveal('2026-W01', open())).toEqual(['2025', '2025-12'])
  })
})
