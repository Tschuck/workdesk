import { describe, expect, it } from 'vitest'
import { enteredWaiting } from './waiting'
import type { WorkDesk } from './types'

const desk = (id: string, over: Partial<WorkDesk> = {}) => ({ id, name: id, kind: 'plain', stage: 'implement', presence: 'active', signals: [], branches: [], todoIds: [], priority: 0, ...over }) as unknown as WorkDesk

describe('moving to Waiting', () => {
  it('reports a running WorkDesk whose Stage became a waiting one', () => {
    const before = [desk('a'), desk('b'), desk('c')]
    const after = [desk('a', { stage: 'waiting' }), desk('b'), desk('c', { stage: 'reviewed-waiting', presence: 'inactive' })]
    expect(enteredWaiting(before, after).map((d) => d.id)).toEqual(['a', 'c'])
  })
  it('is about the Stage: a Signal that comes and goes is not a move to Waiting', () => {
    const waiting = desk('a', { stage: 'reviewed-waiting' })
    const signal = { ...waiting, signals: [{ id: '1', type: 'claude-finished', at: 1, read: false }] as never }
    expect(enteredWaiting([signal], [waiting])).toEqual([])
    expect(enteredWaiting([waiting], [signal])).toEqual([])
  })
  it('leaves out the ones that were waiting, are parked or planned, are new, or have a Signal that needs you', () => {
    const before = [desk('w', { stage: 'waiting' }), desk('p'), desk('q'), desk('s')]
    const after = [
      desk('w', { stage: 'waiting' }),
      desk('p', { stage: 'waiting', presence: 'parked' }),
      desk('q', { stage: 'waiting', presence: 'planned' }),
      desk('s', { stage: 'waiting', signals: [{ id: '1', type: 'claude-needs-input', at: 1, read: false }] as never }),
      desk('n', { stage: 'waiting' })
    ]
    expect(enteredWaiting(before, after)).toEqual([])
  })
})
