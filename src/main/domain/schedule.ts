import { nextDue, type Repeat } from './recurrence'
import type { WorkDesk } from './types'

/** A repeating WorkDesk: not a copy, a schedule that makes a planned WorkDesk from a template when it is time. */
export interface Schedule {
  id: string
  templateId: string
  /** name of the WorkDesks it makes */
  name: string
  repeat: Repeat
  /** time of day, "HH:MM" local */
  time: string
  /** when the next WorkDesk is due (epoch ms) */
  nextAt: number
  /** the Profile the WorkDesks it makes belong to */
  profileId?: string
  paused?: boolean
  /** why it is paused when the tool did it (its template is gone) */
  pausedReason?: string
}

export const parseTime = (time: string): { h: number; m: number } | undefined => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  return m ? { h: Number(m[1]), m: Number(m[2]) } : undefined
}

/** The first run: the next time after `after` that is at `time` on a day the repeat allows (weekly: the weekday of `after`). */
export function firstRun(repeat: Repeat, time: string, after: number): number {
  const t = parseTime(time)
  if (!t) throw new Error('The time must look like 09:30')
  const today = new Date(after)
  today.setHours(t.h, t.m, 0, 0)
  const todayAt = today.getTime()
  if (todayAt > after && (repeat !== 'weekdays' || ![0, 6].includes(today.getDay()))) return todayAt
  // the next one counts from today's time, so weekends are skipped the same way as later
  return nextDue(todayAt, repeat, after)
}

export function createSchedule(id: string, input: { templateId: string; name: string; repeat: Repeat; time: string }, now: number): Schedule {
  const name = input.name.trim()
  if (!name) throw new Error('A repeating WorkDesk needs a name')
  return { id, templateId: input.templateId, name, repeat: input.repeat, time: input.time, nextAt: firstRun(input.repeat, input.time, now) }
}

/** The WorkDesk of a schedule is still open (planned, running or parked; not cleared). */
export const hasOpenDesk = (schedule: Pick<Schedule, 'id'>, desks: readonly Pick<WorkDesk, 'scheduleId'>[]): boolean => desks.some((d) => d.scheduleId === schedule.id)

/** Schedules to make a WorkDesk for now: time has come, not paused, and none from it is open. */
export const dueSchedules = (schedules: readonly Schedule[], desks: readonly Pick<WorkDesk, 'scheduleId'>[], now: number): Schedule[] =>
  schedules.filter((s) => !s.paused && s.nextAt <= now && !hasOpenDesk(s, desks))

/** After a run: the next occurrence after now. Runs missed while the app was closed are skipped, never made up. */
export const advance = (s: Schedule, now: number): Schedule => ({ ...s, nextAt: nextDue(s.nextAt, s.repeat, now) })

/** Resuming a paused schedule does not make up the pause: its next run is the next occurrence from now. */
export const resume = (s: Schedule, now: number): Schedule => {
  const { paused: _p, pausedReason: _r, ...rest } = s
  return { ...rest, nextAt: s.nextAt > now ? s.nextAt : firstRun(s.repeat, s.time, now) }
}

export const pause = (s: Schedule): Schedule => ({ ...s, paused: true })

/** Point a schedule at another template. A schedule paused for a missing template stays paused until resumed. */
export const retarget = (s: Schedule, templateId: string): Schedule => {
  const { pausedReason: _r, ...rest } = s
  return { ...rest, templateId }
}
