import { describe, expect, it } from 'vitest'
import { canForward, emptyHistory, forgetPath, MAX_PLACES, record, step, canBack, type CursorHistory } from './cursor-history'

const p = (path: string, line: number, column = 1) => ({ path, line, column })
const build = (...places: ReturnType<typeof p>[]): CursorHistory => places.reduce(record, emptyHistory())

describe('record', () => {
  it('adds the first place', () => {
    const h = build(p('a', 1))
    expect(h).toEqual({ places: [p('a', 1)], at: 0 })
    expect(canBack(h)).toBe(false)
  })
  it('lets a small move in the same file follow along', () => {
    const h = build(p('a', 1), p('a', 4, 7), p('a', 9))
    expect(h.places).toEqual([p('a', 9)])
  })
  it('keeps a far jump and another file as places of their own', () => {
    const h = build(p('a', 1), p('a', 80), p('b', 3))
    expect(h.places.map((x) => `${x.path}:${x.line}`)).toEqual(['a:1', 'a:80', 'b:3'])
    expect(h.at).toBe(2)
  })
  it('returns the same object when nothing changed', () => {
    const h = build(p('a', 1))
    expect(record(h, p('a', 1))).toBe(h)
  })
  it('cuts the forward part when a new place is made after going back', () => {
    let h = build(p('a', 1), p('b', 1), p('c', 1))
    h = step(h, -1).history
    h = record(h, p('d', 1))
    expect(h.places.map((x) => x.path)).toEqual(['a', 'b', 'd'])
    expect(canForward(h)).toBe(false)
  })
  it('is capped', () => {
    let h = emptyHistory()
    for (let i = 0; i < MAX_PLACES + 20; i++) h = record(h, p(`f${i}`, 1))
    expect(h.places).toHaveLength(MAX_PLACES)
    expect(h.places[h.at].path).toBe(`f${MAX_PLACES + 19}`)
  })
})

describe('step', () => {
  it('goes back and forward, and stops at the ends', () => {
    let h = build(p('a', 1), p('b', 2), p('c', 3))
    const back = step(h, -1)
    expect(back.place).toEqual(p('b', 2))
    h = back.history
    expect(step(h, -1).place).toEqual(p('a', 1))
    expect(step(step(h, -1).history, -1).place).toBeUndefined()
    expect(step(h, 1).place).toEqual(p('c', 3))
    expect(step(step(h, 1).history, 1).place).toBeUndefined()
  })
  it('does not add a place when the cursor arrives where history sent it', () => {
    let h = build(p('a', 1), p('b', 2))
    const s = step(h, -1)
    h = record(s.history, s.place!)
    expect(h.places).toHaveLength(2)
    expect(h.at).toBe(0)
  })
  it('has nothing to do on an empty history', () => {
    expect(step(emptyHistory(), -1).place).toBeUndefined()
  })
})

describe('forgetPath', () => {
  it('follows a rename', () => {
    const h = forgetPath(build(p('a', 1), p('b', 50)), 'b', 'c')
    expect(h.places.map((x) => x.path)).toEqual(['a', 'c'])
    expect(h.at).toBe(1)
  })
  it('drops a removed file and keeps the position sensible', () => {
    const h = forgetPath(build(p('a', 1), p('b', 50), p('c', 1)), 'b')
    expect(h.places.map((x) => x.path)).toEqual(['a', 'c'])
    expect(h.at).toBe(1)
  })
})
