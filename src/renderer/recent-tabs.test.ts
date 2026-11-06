import { describe, expect, it } from 'vitest'
import { touchRecent, walkRecent } from './recent-tabs'

describe('recent Tabs', () => {
  it('puts the Tab in use first and forgets closed ones', () => {
    expect(touchRecent(['a', 'b', 'c'], 'c', ['a', 'b', 'c'])).toEqual(['c', 'a', 'b'])
    expect(touchRecent(['a', 'b'], 'x', ['a', 'x'])).toEqual(['x', 'a'])
  })
  it('walks one step per press, Shift goes back, and wraps', () => {
    const l = ['c', 'a', 'b']
    expect(walkRecent(l, 0, 1)).toEqual({ at: 1, id: 'a' })
    expect(walkRecent(l, 1, 1)).toEqual({ at: 2, id: 'b' })
    expect(walkRecent(l, 2, 1)).toEqual({ at: 0, id: 'c' })
    expect(walkRecent(l, 0, -1)).toEqual({ at: 2, id: 'b' })
    expect(walkRecent(['a'], 0, 1)).toBeUndefined()
  })
})
