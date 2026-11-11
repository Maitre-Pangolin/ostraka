// Due dates are local days (YYYY-MM-DD). How they read relative to today, and how they map to the calendar's Dates.
import { localDay } from '@ostraka/core/todo-order'
import { useEffect, useState } from 'react'

export { localDay }

export type DueTone = 'overdue' | 'today' | 'soon' | 'later'

/** The local midnight of a YYYY-MM-DD day. */
export function dayToDate(day: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year!, month! - 1, date)
}

export function addDays(day: string, days: number): string {
  const date = dayToDate(day)
  date.setDate(date.getDate() + days)
  return localDay(date)
}

const daysBetween = (from: string, to: string) => Math.round((dayToDate(to).getTime() - dayToDate(from).getTime()) / 86_400_000)

/** "Today", "Tomorrow", "Fri", "6 Nov", "Yesterday", "3 days late": short enough for a collapsed row. */
export function dueLabel(due: string, today: string): { text: string; tone: DueTone } {
  const days = daysBetween(today, due)
  if (days < 0) return { text: days === -1 ? 'Yesterday' : `${-days} days late`, tone: 'overdue' }
  if (days === 0) return { text: 'Today', tone: 'today' }
  if (days === 1) return { text: 'Tomorrow', tone: 'soon' }
  const date = dayToDate(due)
  if (days < 7) return { text: date.toLocaleDateString(undefined, { weekday: 'short' }), tone: 'soon' }
  const sameYear = due.slice(0, 4) === today.slice(0, 4)
  return {
    text: date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(!sameYear && { year: 'numeric' }) }),
    tone: 'later',
  }
}

/** The full date, for labels and tooltips. */
export const longDate = (due: string) =>
  dayToDate(due).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

/** Quick picks offered above the calendar. */
export function quickDays(today: string): { label: string; day: string }[] {
  const weekday = dayToDate(today).getDay()
  return [
    { label: 'Today', day: today },
    { label: 'Tomorrow', day: addDays(today, 1) },
    { label: 'Next Monday', day: addDays(today, (8 - weekday) % 7 || 7) },
    { label: 'In a week', day: addDays(today, 7) },
  ]
}

/** Today as YYYY-MM-DD, kept current when the app stays open past midnight. */
export function useToday(): string {
  const [today, setToday] = useState(() => localDay(new Date()))
  useEffect(() => {
    const timer = setInterval(() => setToday(localDay(new Date())), 60_000)
    return () => clearInterval(timer)
  }, [])
  return today
}
