import { describe, expect, it } from 'vitest'
import type { DevlogListing, DevlogSummary } from '../src/devlog-schema.ts'
import {
  devlogDays,
  devlogList,
  devlogRangePresets,
  devlogSectionProblems,
  filterDevlogDays,
  parseDevlogsView,
} from '../src/devlog-days.ts'

const day = (date: string, extra: Partial<DevlogSummary> = {}): DevlogSummary => ({
  kind: 'day',
  id: date,
  date,
  tags: [],
  sources: [],
  version: 'v',
  modifiedAt: '2026-11-01T00:00:00.000Z',
  ...extra,
})
const summary = (month: string) => ({ kind: 'month' as const, id: month, month, tags: [], version: 'v', modifiedAt: '' })
const dates = (entries: { date: string }[]) => entries.map((entry) => entry.date)

// 2026-11-02 is a Monday.
const TODAY = '2026-11-04'

describe('devlogList', () => {
  it('groups days by week, newest first, each month under its summary when there is one', () => {
    const logs: DevlogListing[] = [day('2026-11-03'), day('2026-10-30'), day('2026-10-29'), summary('2026-10')]
    const months = devlogList(logs, TODAY)
    expect(months.map((month) => [month.month, month.summary?.id])).toEqual([
      ['2026-11', undefined],
      ['2026-10', '2026-10'],
    ])
    expect(months[0]!.weeks.map((week) => [week.start, dates(week.days)])).toEqual([
      ['2026-11-02', ['2026-11-04', '2026-11-03', '2026-11-02']],
    ])
    expect(months[1]!.weeks.map((week) => [week.start, dates(week.days)])).toEqual([['2026-10-26', ['2026-10-30', '2026-10-29']]])
  })

  it('shows a weekday without a Dev log as missing, up to today, skipping weekends without one', () => {
    const months = devlogList([day('2026-10-30'), day('2026-11-01')], TODAY)
    const entries = months.flatMap((month) => month.weeks.flatMap((week) => week.days))
    expect(entries.map((entry) => [entry.date, entry.log?.id])).toEqual([
      ['2026-11-04', undefined],
      ['2026-11-03', undefined],
      ['2026-11-02', undefined],
      ['2026-11-01', '2026-11-01'],
      ['2026-10-30', '2026-10-30'],
    ])
  })

  it('lists nothing before there is a Dev log, and keeps a broken file in its day', () => {
    expect(devlogList([], TODAY)).toEqual([])
    const broken = { id: '2026-11-03', version: 'v', modifiedAt: '', error: 'Broken YAML header' }
    const months = devlogList([day('2026-11-02'), broken], TODAY)
    expect(months[0]!.weeks[0]!.days.find((entry) => entry.date === '2026-11-03')?.log).toEqual(broken)
  })
})

describe('devlogDays', () => {
  it('stacks every day of a range newest first: Dev logs, missing weekdays up to today, weekends only with a Dev log', () => {
    const logs = [day('2026-10-31'), day('2026-10-29')]
    expect(devlogDays({ from: '2026-10-28', to: '2026-11-06' }, logs, TODAY).map((entry) => [entry.date, entry.log?.id])).toEqual([
      ['2026-11-04', undefined],
      ['2026-11-03', undefined],
      ['2026-11-02', undefined],
      ['2026-10-31', '2026-10-31'],
      ['2026-10-30', undefined],
      ['2026-10-29', '2026-10-29'],
      ['2026-10-28', undefined],
    ])
  })
})

describe('filterDevlogDays', () => {
  const entries = devlogDays(
    { from: '2026-10-26', to: '2026-10-30' },
    [day('2026-10-30', { tags: ['billing', 'auth'] }), day('2026-10-29', { tags: ['billing'] }), day('2026-10-27', { tags: ['auth'] })],
    TODAY,
  )

  it('keeps every day without a Tag chosen', () => {
    expect(filterDevlogDays(entries, {})).toEqual(entries)
  })

  it('keeps only Dev logs with all the chosen Tags, or any of them', () => {
    expect(dates(filterDevlogDays(entries, { tag: ['billing', 'auth'] }))).toEqual(['2026-10-30'])
    expect(dates(filterDevlogDays(entries, { tag: ['billing', 'auth'], match: 'any' }))).toEqual(['2026-10-30', '2026-10-29', '2026-10-27'])
  })

  it('keeps only Dev logs whose text mentions all the chosen Persons', () => {
    const withBodies = devlogDays(
      { from: '2026-10-26', to: '2026-10-30' },
      [
        { ...day('2026-10-30', { tags: ['billing'] }), body: '## Done\n\n- Paired with @ilse-vantongeren and @bram\n' },
        { ...day('2026-10-29'), body: '## Meetings & discussions\n\n- 1:1 with @bram\n' },
        { ...day('2026-10-27'), body: '## Notes\n\n- Wrote to ilse@corp.example\n' },
      ],
      TODAY,
    )
    expect(dates(filterDevlogDays(withBodies, { person: ['bram'] }))).toEqual(['2026-10-30', '2026-10-29'])
    expect(dates(filterDevlogDays(withBodies, { person: ['bram', 'ilse-vantongeren'] }))).toEqual(['2026-10-30'])
    expect(dates(filterDevlogDays(withBodies, { person: ['bram'], tag: ['billing'] }))).toEqual(['2026-10-30'])
  })
})

describe('devlogRangePresets', () => {
  it('offers this and last week (Monday to Sunday) and this and last month, around today', () => {
    expect(devlogRangePresets(TODAY)).toEqual([
      { label: 'This week', from: '2026-11-02', to: '2026-11-08' },
      { label: 'Last week', from: '2026-10-26', to: '2026-11-01' },
      { label: 'This month', from: '2026-11-01', to: '2026-11-30' },
      { label: 'Last month', from: '2026-10-01', to: '2026-10-31' },
    ])
  })
})

describe('parseDevlogsView', () => {
  it('keeps the open Dev log, a whole date range and the Tag filter, leaving out anything invalid', () => {
    expect(parseDevlogsView({})).toEqual({})
    expect(parseDevlogsView({ log: '2026-10-29' })).toEqual({ log: '2026-10-29' })
    expect(parseDevlogsView({ log: '2026-10' })).toEqual({ log: '2026-10' })
    expect(parseDevlogsView({ log: 'notes' })).toEqual({})
    expect(parseDevlogsView({ from: '2026-10-01', to: '2026-10-31', tag: ['Billing', 'bad tag!'], match: 'any' })).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      tag: ['billing'],
      match: 'any',
    })
    expect(parseDevlogsView({ from: '2026-10-01', to: '2026-10-31', person: ['bram', 'Bad Id', 'bram'] })).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      person: ['bram'],
    })
    expect(parseDevlogsView({ from: '2026-10-01' })).toEqual({})
    expect(parseDevlogsView({ from: '2026-10-31', to: '2026-10-01' })).toEqual({ from: '2026-10-01', to: '2026-10-31' })
  })
})

describe('devlogSectionProblems', () => {
  it('accepts the sections in order, any of them left out', () => {
    expect(devlogSectionProblems('## Done\n\n- One\n\n## Notes\n\n- Two\n')).toEqual([])
    expect(devlogSectionProblems('')).toEqual([])
  })

  it('names a section that is unknown, repeated or out of order', () => {
    expect(devlogSectionProblems('## Notes\n\n## Done\n\n## Context\n\n## Done\n')).toEqual([
      'Done comes before Notes.',
      'Context is not a Dev log section: use Done, Meetings & discussions or Notes.',
      'Done appears twice.',
    ])
  })
})
