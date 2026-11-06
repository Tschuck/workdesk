import { describe, expect, it } from 'vitest'
import { postponeOptions, tomorrow } from './postpone'

const now = new Date(2026, 9, 31, 22, 30).getTime()
const H = 3_600_000

describe('postpone options', () => {
  it('offers 1, 2, 4 and 6 hours and tomorrow morning', () => {
    const o = postponeOptions('', now)
    expect(o.map((x) => x.label)).toEqual(['1 hour', '2 hours', '4 hours', '6 hours', 'Tomorrow'])
    expect(o.map((x) => x.until)).toEqual([now + H, now + 2 * H, now + 4 * H, now + 6 * H, new Date(2026, 10, 1, 6).getTime()])
    expect(tomorrow(now)).toBe(new Date(2026, 10, 1, 6).getTime())
  })

  it('narrows by what is typed, and offers a number of hours of its own', () => {
    expect(postponeOptions('tom', now).map((x) => x.label)).toEqual(['Tomorrow'])
    expect(postponeOptions('hours', now).map((x) => x.label)).toEqual(['2 hours', '4 hours', '6 hours'])
    expect(postponeOptions('3', now)).toEqual([{ label: '3 hours', until: now + 3 * H }])
    expect(postponeOptions('4h', now).map((x) => x.label)).toEqual(['4 hours'])
    expect(postponeOptions('4', now).map((x) => x.label)).toEqual(['4 hours'])
    expect(postponeOptions('99', now)).toEqual([])
  })
})
