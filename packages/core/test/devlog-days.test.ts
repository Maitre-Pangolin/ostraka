import { describe, expect, it } from 'vitest'
import type { DevlogListing, DevlogSummary } from '../src/devlog-schema.ts'
import {
  devlogCounts,
  devlogDays,
  devlogList,
  devlogRangeList,
  devlogRangePresets,
  devlogYears,
  groupDevlogDays,
  isoWeek,
  weekRange,
  devlogSectionProblems,
  filterDevlogDays,
  missingDevlogWeeks,
  parseDevlogsView,
  searchDevlogList,
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

describe('isoWeek and weekRange', () => {
  it('numbers Weeks by ISO 8601, Monday to Sunday', () => {
    expect(isoWeek('2026-11-16')).toEqual({ year: 2026, number: 47, id: '2026-W47' })
    expect(isoWeek('2026-11-22')).toEqual({ year: 2026, number: 47, id: '2026-W47' })
    expect(weekRange('2026-W47')).toEqual({ from: '2026-11-16', to: '2026-11-22' })
  })

  it('puts late December in Week 1 of the next year, or early January in Week 53 of the last', () => {
    expect(isoWeek('2025-12-29').id).toBe('2026-W01')
    expect(weekRange('2026-W01')).toEqual({ from: '2025-12-29', to: '2026-01-04' })
    expect(isoWeek('2027-01-03').id).toBe('2026-W53')
    expect(isoWeek('2027-01-04').id).toBe('2027-W01')
  })

  it('knows no Week a year does not have', () => {
    expect(weekRange('2027-W53')).toBeUndefined()
    expect(weekRange('2026-W00')).toBeUndefined()
    expect(weekRange('2026-11')).toBeUndefined()
  })
})

describe('groupDevlogDays and devlogYears', () => {
  it('shows a Week running over two months under both, with the same id and each month its own days', () => {
    // Week 40 of 2026 runs from Monday 28 September to Sunday 4 October.
    const months = groupDevlogDays(devlogDays({ from: '2026-09-28', to: '2026-10-02' }, [], TODAY))
    expect(months.map((month) => [month.month, month.weeks.map((week) => [week.id, week.number, week.start, dates(week.days)])])).toEqual([
      ['2026-10', [['2026-W40', 40, '2026-09-28', ['2026-10-02', '2026-10-01']]]],
      ['2026-09', [['2026-W40', 40, '2026-09-28', ['2026-09-30', '2026-09-29', '2026-09-28']]]],
    ])
  })

  it('puts months under their calendar year, newest first, even a Week numbered in the next year', () => {
    const months = groupDevlogDays(devlogDays({ from: '2025-12-29', to: '2026-01-02' }, [], TODAY))
    const years = devlogYears(months)
    expect(years.map((year) => [year.year, year.months.map((month) => [month.month, month.weeks.map((week) => week.id)])])).toEqual([
      ['2026', [['2026-01', ['2026-W01']]]],
      ['2025', [['2025-12', ['2026-W01']]]],
    ])
  })
})

describe('devlogRangeList', () => {
  const logs = [day('2026-10-30', { tags: ['billing'] }), day('2026-10-29')]
  const listing: DevlogListing[] = [...logs, summary('2026-10'), summary('2026-09')]

  it('keeps the days of the range, gaps included, and the summaries of the months it touches', () => {
    const months = devlogRangeList({ from: '2026-10-29', to: '2026-11-03' }, logs, listing, {}, TODAY)
    expect(months.map((month) => [month.month, month.summary?.id, month.weeks.map((week) => dates(week.days))])).toEqual([
      ['2026-11', undefined, [['2026-11-03', '2026-11-02']]],
      ['2026-10', '2026-10', [['2026-10-30', '2026-10-29']]],
    ])
  })

  it('keeps only the matching Dev logs once a Tag is chosen, without gaps or summaries', () => {
    const months = devlogRangeList({ from: '2026-10-01', to: '2026-11-03' }, logs, listing, { tag: ['billing'] }, TODAY)
    expect(months.map((month) => [month.month, month.summary?.id, month.weeks.map((week) => dates(week.days))])).toEqual([
      ['2026-10', undefined, [['2026-10-30']]],
    ])
  })

  it('keeps the summaries a search found', () => {
    const months = devlogRangeList({ from: '2026-09-01', to: '2026-10-31' }, logs, listing, {}, TODAY, new Set(['2026-09', '2026-10-29']))
    expect(months.map((month) => [month.month, month.summary?.id, month.weeks.map((week) => dates(week.days))])).toEqual([
      ['2026-10', undefined, [['2026-10-29']]],
      ['2026-09', '2026-09', []],
    ])
  })
})

describe('devlogCounts', () => {
  it('counts the days written, off and broken ones too, and the days missing', () => {
    const broken = { id: '2026-10-29', version: 'v', modifiedAt: '', error: 'Broken YAML header' }
    const entries = devlogDays({ from: '2026-10-26', to: '2026-10-30' }, [day('2026-10-30', { off: true }), broken], TODAY)
    expect(devlogCounts(entries)).toEqual({ written: 2, missing: 3 })
  })
})

describe('searchDevlogList', () => {
  it('keeps only the days and summaries a search found, in their order, without gaps or empty weeks and months', () => {
    const logs: DevlogListing[] = [day('2026-11-03'), day('2026-10-30'), day('2026-10-29'), summary('2026-10'), summary('2026-09')]
    const months = searchDevlogList(devlogList(logs, TODAY), new Set(['2026-10-29', '2026-11-03', '2026-09']))
    expect(months.map((month) => [month.month, month.summary?.id, month.weeks.map((week) => [week.start, dates(week.days)])])).toEqual([
      ['2026-11', undefined, [['2026-11-02', ['2026-11-03']]]],
      ['2026-10', undefined, [['2026-10-26', ['2026-10-29']]]],
      ['2026-09', '2026-09', []],
    ])
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

describe('missingDevlogWeeks', () => {
  it('lists the weekdays with no Dev log by week, oldest first, from the first Dev log to today', () => {
    const logs = [day('2026-10-21'), day('2026-10-23'), day('2026-10-24'), day('2026-10-26'), day('2026-10-27')]
    const offDay = day('2026-10-28', { off: true, label: 'Holiday' })
    const broken = { id: '2026-10-29', version: 'v', modifiedAt: '', error: 'Broken YAML header' }
    expect(missingDevlogWeeks([...logs, offDay, broken, summary('2026-10')], TODAY)).toEqual([
      { start: '2026-10-19', days: ['2026-10-22'] },
      { start: '2026-10-26', days: ['2026-10-30'] },
      { start: '2026-11-02', days: ['2026-11-02', '2026-11-03', '2026-11-04'] },
    ])
  })

  it('narrows to a range, which may start before the first Dev log', () => {
    expect(missingDevlogWeeks([day('2026-10-28')], TODAY, { from: '2026-10-23', to: '2026-10-30' })).toEqual([
      { start: '2026-10-19', days: ['2026-10-23'] },
      { start: '2026-10-26', days: ['2026-10-26', '2026-10-27', '2026-10-29', '2026-10-30'] },
    ])
  })

  it('never lists a day after today, and nothing without a Dev log or a start', () => {
    expect(missingDevlogWeeks([day('2026-11-03')], TODAY, { to: '2026-11-06' })).toEqual([{ start: '2026-11-02', days: ['2026-11-04'] }])
    expect(missingDevlogWeeks([], TODAY)).toEqual([])
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

  it('keeps only the Dev logs a search found, with the other filters', () => {
    expect(dates(filterDevlogDays(entries, {}, new Set(['2026-10-29', '2026-10-27'])))).toEqual(['2026-10-29', '2026-10-27'])
    expect(dates(filterDevlogDays(entries, { tag: ['auth'] }, new Set(['2026-10-29', '2026-10-27'])))).toEqual(['2026-10-27'])
  })
})

describe('devlogRangePresets', () => {
  it('offers this and last week (Monday to Sunday), month and year, around today', () => {
    expect(devlogRangePresets(TODAY)).toEqual([
      { label: 'This week', from: '2026-11-02', to: '2026-11-08' },
      { label: 'Last week', from: '2026-10-26', to: '2026-11-01' },
      { label: 'This month', from: '2026-11-01', to: '2026-11-30' },
      { label: 'Last month', from: '2026-10-01', to: '2026-10-31' },
      { label: 'This year', from: '2026-01-01', to: '2026-12-31' },
      { label: 'Last year', from: '2025-01-01', to: '2025-12-31' },
    ])
  })
})

describe('parseDevlogsView', () => {
  it('keeps the open Dev log, a whole date range and the Tag filter, leaving out anything invalid', () => {
    expect(parseDevlogsView({})).toEqual({})
    expect(parseDevlogsView({ log: '2026-10-29' })).toEqual({ log: '2026-10-29' })
    expect(parseDevlogsView({ log: '2026-10' })).toEqual({ log: '2026-10' })
    expect(parseDevlogsView({ log: 'notes' })).toEqual({})
    expect(parseDevlogsView({ log: '2026-W47' })).toEqual({ log: '2026-W47' })
    expect(parseDevlogsView({ log: '2027-W53' })).toEqual({})
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

  it('keeps the search text as typed, leaving out a blank one', () => {
    expect(parseDevlogsView({ log: '2026-10-29', q: 'rollout ' })).toEqual({ log: '2026-10-29', q: 'rollout ' })
    expect(parseDevlogsView({ q: ' ' })).toEqual({})
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
