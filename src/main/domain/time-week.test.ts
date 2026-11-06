import { describe, expect, it } from 'vitest'
import { isoWeek, mergeDeskTime, weekDays, weekSummary } from './time-tracking'

describe('weeks', () => {
  it('lists Monday to Sunday, for this and other weeks', () => {
    const wed = new Date(2026, 10, 4, 10).getTime() // Wednesday 2026-11-04
    expect(weekDays(wed)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'])
    expect(weekDays(wed, -1)[0]).toBe('2026-10-26')
    expect(weekDays(new Date(2026, 10, 8, 23).getTime())[0]).toBe('2026-11-02')
    expect(weekDays(new Date(2026, 10, 2, 0, 5).getTime())[0]).toBe('2026-11-02')
  })
  it('adds a week up per day and per WorkDesk, cleared ones apart', () => {
    const days = weekDays(new Date(2026, 10, 4, 10).getTime())
    const log = { '2026-11-02': { a: 600, b: 60, gone: 120 }, '2026-11-04': { a: 300 }, '2026-10-30': { a: 9999 } }
    const w = weekSummary(log, days, { a: 'Alpha', b: 'Beta' })
    expect(w.total).toBe(1080)
    expect(w.cleared).toBe(120)
    expect(w.days.map((d) => d.seconds)).toEqual([780, 0, 300, 0, 0, 0, 0])
    expect(w.rows).toEqual([
      { deskId: 'a', name: 'Alpha', perDay: [600, 0, 300, 0, 0, 0, 0], seconds: 900 },
      { deskId: 'b', name: 'Beta', perDay: [60, 0, 0, 0, 0, 0, 0], seconds: 60 }
    ])
    expect(weekSummary(log, days, { a: 'Alpha', b: 'Beta' }, true).total).toBe(960)
  })
})

describe('time of a WorkDesk that went into another', () => {
  it('counts for the other one, day by day, and leaves the rest alone', () => {
    const log = { '2026-11-02': { a: 600, b: 60, c: 5 }, '2026-11-03': { b: 30 }, '2026-11-04': { a: 1 } }
    expect(mergeDeskTime(log, 'b', 'a')).toEqual({ '2026-11-02': { a: 660, c: 5 }, '2026-11-03': { a: 30 }, '2026-11-04': { a: 1 } })
    expect(mergeDeskTime(log, 'a', 'a')).toBe(log)
    expect(mergeDeskTime(log, 'zzz', 'a')).toEqual(log)
  })
})

describe('week of the year', () => {
  it('counts ISO weeks: Monday first, week 1 holds the first Thursday', () => {
    expect(isoWeek(new Date(2026, 10, 3))).toBe(45)
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1)
    expect(isoWeek(new Date(2025, 11, 29))).toBe(1) // Monday before 2026's first Thursday
    expect(isoWeek(new Date(2021, 0, 3))).toBe(53) // Sunday of the last week of 2020
    expect(isoWeek(new Date(2024, 11, 31))).toBe(1)
  })
})
