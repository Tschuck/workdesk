import { describe, expect, it } from 'vitest'
import { advance, createSchedule, dueSchedules, firstRun, parseTime, pause, resume } from './schedule'

// November 2026: the 1st is a Sunday
const at = (d: number, h = 9, m = 0) => new Date(2026, 10, d, h, m).getTime()
const input = { templateId: 'release', name: 'Weekly release', repeat: 'weekly' as const, time: '09:00' }

describe('schedule', () => {
  it('first run is today when the time is still to come, else the next fitting day', () => {
    expect(firstRun('daily', '09:00', at(2, 8))).toBe(at(2))
    expect(firstRun('daily', '09:00', at(2, 10))).toBe(at(3))
    expect(firstRun('weekly', '09:00', at(2, 10))).toBe(at(9))
    expect(firstRun('weekdays', '09:00', at(6, 10))).toBe(at(9)) // Friday evening -> Monday
    expect(firstRun('weekdays', '09:00', at(1, 8))).toBe(at(2)) // Sunday -> Monday
  })

  it('rejects a bad time and an empty name', () => {
    expect(parseTime('9:00')).toBeUndefined()
    expect(() => firstRun('daily', '25:00', 0)).toThrow()
    expect(() => createSchedule('s', { ...input, name: ' ' }, 0)).toThrow()
  })

  it('is due when its time has come, and not before', () => {
    const s = createSchedule('s', input, at(2, 10))
    expect(s.nextAt).toBe(at(9))
    expect(dueSchedules([s], [], at(9, 8, 59))).toEqual([])
    expect(dueSchedules([s], [], at(9))).toEqual([s])
  })

  it('is not due while a WorkDesk from it is open, nor when paused', () => {
    const s = createSchedule('s', input, at(2, 10))
    expect(dueSchedules([s], [{ scheduleId: 's' }], at(10))).toEqual([])
    expect(dueSchedules([s], [{ scheduleId: 'other' }, {}], at(10))).toEqual([s])
    expect(dueSchedules([pause(s)], [], at(10))).toEqual([])
  })

  it('catching up after a long pause gives one WorkDesk and the next run is in the future', () => {
    const s = createSchedule('s', { ...input, repeat: 'daily' }, at(2, 10))
    const now = at(20, 12) // app was closed for 17 days
    expect(dueSchedules([s], [], now)).toHaveLength(1)
    const next = advance(s, now)
    expect(next.nextAt).toBe(at(21))
    expect(dueSchedules([next], [], now)).toEqual([])
  })

  it('a run that waited for the open WorkDesk to be cleared still makes just one', () => {
    const s = createSchedule('s', { ...input, repeat: 'daily' }, at(2, 10))
    expect(dueSchedules([s], [{ scheduleId: 's' }], at(8))).toEqual([])
    expect(dueSchedules([s], [], at(8))).toEqual([s])
  })

  it('resuming does not make up the pause', () => {
    const s = pause(createSchedule('s', { ...input, repeat: 'daily' }, at(2, 10)))
    const r = resume(s, at(10, 12))
    expect(r.paused).toBeUndefined()
    expect(r.nextAt).toBe(at(11))
  })
})
