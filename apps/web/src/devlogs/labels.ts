// How the Dev logs view writes days, months and ranges.
import { dayToDate } from '@/todos/due'

export const dayLabel = (day: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  dayToDate(day).toLocaleDateString('en-GB', options)
export const longDay = (day: string) => dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
export const monthLabel = (month: string) => dayToDate(`${month}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
export const monthName = (month: string) => dayToDate(`${month}-01`).toLocaleDateString('en-GB', { month: 'long' })
export const rangeLabel = (from: string, to: string) =>
  `${dayLabel(from, { day: 'numeric', month: 'short' })} – ${dayLabel(to, { day: 'numeric', month: 'short', year: 'numeric' })}`
