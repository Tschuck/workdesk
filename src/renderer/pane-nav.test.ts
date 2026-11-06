import { describe, expect, it } from 'vitest'
import { navDirection, neighbourPane, splitDirection, type Box } from './pane-nav'

// ┌───────┬───────┐
// │   0   │   1   │
// │       ├───────┤
// │       │   2   │
// └───────┴───────┘   and 3 below everything
const boxes: Box[] = [
  { left: 0, top: 0, right: 100, bottom: 100 },
  { left: 101, top: 0, right: 200, bottom: 50 },
  { left: 101, top: 51, right: 200, bottom: 100 },
  { left: 0, top: 101, right: 200, bottom: 150 }
]

describe('neighbourPane', () => {
  it('moves to what lies beside or above/below, and stays at the edge', () => {
    expect(neighbourPane(boxes, 0, 'right')).toBe(1) // the top one, as the closer centre
    expect(neighbourPane(boxes, 1, 'left')).toBe(0)
    expect(neighbourPane(boxes, 2, 'left')).toBe(0)
    expect(neighbourPane(boxes, 1, 'down')).toBe(2)
    expect(neighbourPane(boxes, 2, 'up')).toBe(1)
    expect(neighbourPane(boxes, 2, 'down')).toBe(3)
    expect(neighbourPane(boxes, 3, 'up')).toBe(0) // wide pane below: the one above its centre... both overlap, nearest centre wins
    expect(neighbourPane(boxes, 0, 'left')).toBeUndefined()
    expect(neighbourPane(boxes, 3, 'down')).toBeUndefined()
    expect(neighbourPane(boxes, 1, 'right')).toBeUndefined()
  })
  it('prefers a pane that overlaps over a diagonal one', () => {
    const l: Box[] = [
      { left: 0, top: 0, right: 100, bottom: 50 },
      { left: 110, top: 200, right: 200, bottom: 250 }, // beside in x, far below: no overlap
      { left: 120, top: 0, right: 200, bottom: 50 }
    ]
    expect(neighbourPane(l, 0, 'right')).toBe(2)
  })
  it('knows nothing of a missing pane', () => {
    expect(neighbourPane(boxes, 9, 'up')).toBeUndefined()
  })
})

describe('navDirection', () => {
  const k = (key: string, over = {}) => ({ key, metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, ...over })
  it('is Command plus an arrow, nothing else', () => {
    expect(navDirection(k('ArrowLeft'))).toBe('left')
    expect(navDirection(k('ArrowDown'))).toBe('down')
    expect(navDirection(k('ArrowUp', { shiftKey: true }))).toBeUndefined()
    expect(navDirection(k('ArrowUp', { altKey: true }))).toBeUndefined()
    expect(navDirection(k('ArrowUp', { metaKey: false }))).toBeUndefined()
    expect(navDirection(k('a'))).toBeUndefined()
  })
})

describe('splitDirection', () => {
  const k = (key: string, o: object = {}) => ({ key, metaKey: true, ctrlKey: false, altKey: false, shiftKey: true, ...o })
  it('maps Command+Shift+arrow to a split, left and up put the new Pane first', () => {
    expect(splitDirection(k('ArrowRight'))).toEqual({ direction: 'horizontal', before: false })
    expect(splitDirection(k('ArrowLeft'))).toEqual({ direction: 'horizontal', before: true })
    expect(splitDirection(k('ArrowDown'))).toEqual({ direction: 'vertical', before: false })
    expect(splitDirection(k('ArrowUp'))).toEqual({ direction: 'vertical', before: true })
  })
  it('ignores arrows without Shift, with Ctrl or Alt, and other keys', () => {
    expect(splitDirection(k('ArrowRight', { shiftKey: false }))).toBeUndefined()
    expect(splitDirection(k('ArrowRight', { altKey: true }))).toBeUndefined()
    expect(splitDirection(k('a'))).toBeUndefined()
    expect(navDirection(k('ArrowRight'))).toBeUndefined()
  })
})
