import { describe, expect, it } from 'vitest'
import { canStep, forgetFile, historyDirection, recordPlace, stepPlace } from './nav-history'

describe('history per WorkDesk', () => {
  it('keeps one history per desk', () => {
    recordPlace('d1', { path: '/a', line: 1, column: 1 })
    recordPlace('d1', { path: '/b', line: 1, column: 1 })
    recordPlace('d2', { path: '/x', line: 1, column: 1 })
    expect(canStep('d1', -1)).toBe(true)
    expect(canStep('d2', -1)).toBe(false)
    expect(stepPlace('d1', -1)?.path).toBe('/a')
    expect(canStep('d1', 1)).toBe(true)
    expect(stepPlace('d1', 1)?.path).toBe('/b')
    expect(stepPlace('d1', 1)).toBeUndefined()
  })
  it('follows a renamed file', () => {
    recordPlace('d3', { path: '/a', line: 1, column: 1 })
    recordPlace('d3', { path: '/b', line: 1, column: 1 })
    forgetFile('d3', '/a', '/c')
    expect(stepPlace('d3', -1)?.path).toBe('/c')
  })
})

describe('the keys', () => {
  const k = (o: object) => ({ code: 'Minus', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...o })
  it('is Control and minus, with Shift forward', () => {
    expect(historyDirection(k({}))).toBe(-1)
    expect(historyDirection(k({ shiftKey: true }))).toBe(1)
  })
  it('leaves other combinations alone (Cmd-minus is zoom)', () => {
    expect(historyDirection(k({ ctrlKey: false, metaKey: true }))).toBeUndefined()
    expect(historyDirection(k({ altKey: true }))).toBeUndefined()
    expect(historyDirection(k({ code: 'Equal' }))).toBeUndefined()
  })
})
