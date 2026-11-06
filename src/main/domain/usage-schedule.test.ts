import { describe, expect, it } from 'vitest'
import { UsageSchedule } from './usage-schedule'

const MIN = 60_000

function setup() {
  let t = 1_000_000
  let reads = 0
  const s = new UsageSchedule(() => reads++, () => t, 5 * MIN, 30 * MIN)
  return { s, reads: () => reads, advance: (ms: number) => void (t += ms) }
}

describe('UsageSchedule', () => {
  it('reads on every tick while the window is in use', () => {
    const x = setup()
    x.s.tick()
    x.s.tick()
    expect(x.reads()).toBe(2)
  })
  it('reads nothing while the screen is locked, and once when it is unlocked', () => {
    const x = setup()
    x.s.setLocked(true)
    x.s.tick()
    expect(x.reads()).toBe(0)
    x.s.setLocked(false)
    expect(x.reads()).toBe(1)
  })
  it('keeps reading for 30 minutes after the window lost focus, then stops until it is back', () => {
    const x = setup()
    x.s.setFocused(false)
    x.advance(29 * MIN)
    x.s.tick()
    expect(x.reads()).toBe(1)
    x.advance(2 * MIN)
    x.s.tick()
    expect(x.reads()).toBe(1)
    expect(x.s.paused()).toBe(true)
    x.s.setFocused(true)
    expect(x.reads()).toBe(2)
  })
  it('reads on focus only after more than the interval since the last reading', () => {
    const x = setup()
    x.s.tick()
    x.s.setFocused(false)
    x.advance(3 * MIN)
    x.s.setFocused(true)
    expect(x.reads()).toBe(1)
    x.s.setFocused(false)
    x.advance(6 * MIN)
    x.s.setFocused(true)
    expect(x.reads()).toBe(2)
  })
  it('a reading done by hand counts for the focus rule', () => {
    const x = setup()
    x.s.setFocused(false)
    x.advance(4 * MIN)
    x.s.noteRefresh()
    x.advance(2 * MIN)
    x.s.setFocused(true)
    expect(x.reads()).toBe(0)
  })
  it('stays paused after unlock while the window is long idle', () => {
    const x = setup()
    x.s.setFocused(false)
    x.s.setLocked(true)
    x.advance(40 * MIN)
    x.s.setLocked(false)
    expect(x.reads()).toBe(0)
  })
})
