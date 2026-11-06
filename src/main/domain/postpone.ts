import { oldestOpenSignal } from './signal'
import type { WorkDesk } from './types'

export interface PostponeOption {
  label: string
  /** when the WorkDesk comes back, ms since the epoch */
  until: number
}

const HOUR = 3_600_000
/** the hour of the day that "Tomorrow" means: early, but after a late night */
export const TOMORROW_HOUR = 6

/** Tomorrow morning in local time. */
export function tomorrow(now: number): number {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(TOMORROW_HOUR, 0, 0, 0)
  return d.getTime()
}

/**
 * The times a WorkDesk can be postponed to, narrowed by what was typed: a word of the label, or a number of hours
 * ("3" offers "3 hours" next to the fixed ones that match).
 */
export function postponeOptions(query: string, now: number): PostponeOption[] {
  const fixed: PostponeOption[] = [1, 2, 4, 6].map((h) => ({ label: h === 1 ? '1 hour' : `${h} hours`, until: now + h * HOUR }))
  fixed.push({ label: 'Tomorrow', until: tomorrow(now) })
  const q = query.trim().toLowerCase()
  if (!q) return fixed
  const n = /^(\d{1,2})(\s*h(ours?)?)?$/.exec(q)
  const hours = n ? Number(n[1]) : 0
  if (hours >= 1 && hours <= 48) return [{ label: hours === 1 ? '1 hour' : `${hours} hours`, until: now + hours * HOUR }]
  return fixed.filter((o) => q.split(/\s+/).every((w) => o.label.toLowerCase().includes(w)))
}

/** Is the WorkDesk put out of the way for now? A new Signal ends it, since a postponed review would otherwise miss the answer. */
export const isPostponed = (desk: WorkDesk, now: number = Date.now()): boolean => (desk.postponedUntil ?? 0) > now && !oldestOpenSignal(desk)

/** "14:30", or "tomorrow 06:00" / "Mon 06:00" when it is not today. */
export function untilLabel(until: number, now: number = Date.now()): string {
  const d = new Date(until)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  if (d.toDateString() === new Date(now).toDateString()) return time
  const t = new Date(now)
  t.setDate(t.getDate() + 1)
  return `${d.toDateString() === t.toDateString() ? 'tomorrow' : d.toLocaleDateString([], { weekday: 'short' })} ${time}`
}
