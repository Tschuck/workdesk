import { describe, expect, it } from 'vitest'
import { activate, park, postpone, reactivate } from './presence'
import { isWaiting, orderDesks, orderSection, reprioritize, sectionOf, sidebarOrder } from './order'
import { acknowledgeOnOpen, acknowledgePane, addSignal, markRead, oldestOpenSignal } from './signal'
import { applyDerivedStage, clearOverride, initialStage, isValidStage, isWaitingStage, setStageByHand, STAGES } from './stage'
import type { Signal, WorkDesk } from './types'

function desk(id: string, over: Partial<WorkDesk> = {}): WorkDesk {
  return {
    id,
    name: id,
    
    stage: 'implement',
    stageOverridden: false,
    priority: 0,
    presence: 'inactive',
    todoIds: [],
    branches: [],
    signals: [],
    createdAt: 0,
    ...over
  }
}

const sig = (id: string, at: number, paneId?: string): Signal => ({
  id,
  type: 'claude-finished',
  at,
  paneId,
  read: false
})

describe('Stage rules', () => {
  it('has one set for every WorkDesk', () => {
    expect(STAGES).toEqual(['implement', 'testing', 'in-review', 'waiting', 'to-review', 're-review', 'reviewed-waiting', 'done'])
    expect(initialStage()).toBe('implement')
  })

  it('rejects a Stage that does not exist', () => {
    expect(isValidStage('implement')).toBe(true)
    expect(isValidStage('nonsense')).toBe(false)
    expect(() => setStageByHand('nonsense' as never)).toThrow()
  })

  it('lets a hand-set Stage override derivation until cleared', () => {
    const manual = setStageByHand('done')
    expect(applyDerivedStage(manual, 're-review')).toEqual(manual)
    expect(clearOverride('re-review')).toEqual({ stage: 're-review', stageOverridden: false })
  })

  it('applies derived Stages when not overridden', () => {
    const cur = { stage: 'to-review' as const, stageOverridden: false }
    expect(applyDerivedStage(cur, 'reviewed-waiting').stage).toBe('reviewed-waiting')
  })

  it('knows waiting Stages', () => {
    expect(isWaitingStage('waiting')).toBe(true)
    expect(isWaitingStage('reviewed-waiting')).toBe(true)
    expect(isWaitingStage('testing')).toBe(false)
  })
})

describe('Signals', () => {
  it('finds the oldest open Signal', () => {
    const d = desk('a', { signals: [sig('2', 20), sig('1', 10)] })
    expect(oldestOpenSignal(d)?.id).toBe('1')
    expect(oldestOpenSignal(desk('b', { signals: markRead([sig('1', 1)], '1') }))).toBeUndefined()
  })

  it('clears non-Pane Signals on open and Pane Signals on focus', () => {
    let signals = addSignal([], { id: 'x', type: 'ci-finished', at: 1 })
    signals = addSignal(signals, { id: 'y', type: 'claude-finished', at: 2, paneId: 'p1' })
    signals = acknowledgeOnOpen(signals)
    expect(signals.map((s) => s.read)).toEqual([true, false])
    signals = acknowledgePane(signals, 'p1')
    expect(signals.every((s) => s.read)).toBe(true)
  })
})

describe('WorkDesk order', () => {
  it('puts planned WorkDesks after the ones in progress, dimmed', () => {
    const d = (id: string, priority: number, presence: 'planned' | 'inactive') => desk(id, { priority, presence })
    const ordered = orderDesks([d('plan', 0, 'planned'), d('work', 1, 'inactive')])
    expect(ordered.map((o) => [o.desk.id, o.dimmed])).toEqual([['work', false], ['plan', true]])
  })

  it('lists the WorkDesks in use, then the waiting, the planned and the postponed, as the left panel and ⌘1…⌘9 do', () => {
    const desks = [
      desk('post', { postponedUntil: Date.now() + 1e6, priority: 0 }),
      desk('plan', { presence: 'planned', priority: 0 }),
      desk('parked', { presence: 'parked', priority: 2 }),
      desk('a', { priority: 1 }),
      desk('waiting', { stage: 'waiting', priority: 0 })
    ]
    expect(sidebarOrder(desks).map((o) => o.desk.id)).toEqual(['a', 'parked', 'waiting', 'plan', 'post'])
  })

  it('lists a WorkDesk under the section it belongs to, parked or not; a Signal brings a waiting one out', () => {
    expect(sectionOf(desk('w', { stage: 'waiting' }))).toBe('waiting')
    expect(sectionOf(desk('wp', { stage: 'waiting', presence: 'parked' }))).toBe('waiting')
    expect(sectionOf(desk('rw', { stage: 'reviewed-waiting' }))).toBe('waiting')
    expect(sectionOf(desk('p', { presence: 'parked' }))).toBe('live')
    expect(sectionOf(desk('n', { stage: 'waiting', presence: 'planned' }))).toBe('planned')
    expect(sectionOf(desk('s', { stage: 'waiting', signals: [sig('s', 1)] }))).toBe('live')
    expect(sectionOf(desk('s2', { stage: 'waiting', presence: 'parked', signals: [sig('s', 1)] }))).toBe('live')
    expect(sectionOf(desk('s5', { presence: 'planned', signals: [sig('s', 1)] }))).toBe('planned')
    expect(isWaiting(desk('x'))).toBe(false)
  })

  it('puts a postponed WorkDesk apart until its time, or until a Signal needs you', () => {
    const now = 1000
    expect(sectionOf(desk('a', { postponedUntil: 2000 }), now)).toBe('postponed')
    expect(sectionOf(desk('a', { postponedUntil: 2000, stage: 'waiting', presence: 'parked' }), now)).toBe('postponed')
    expect(sectionOf(desk('a', { postponedUntil: 1000 }), now)).toBe('live')
    expect(sectionOf(desk('a', { postponedUntil: 2000, signals: [sig('s', 1)] }), now)).toBe('live')
    expect(sectionOf(desk('a', { postponedUntil: 2000, stage: 'waiting', signals: [sig('s', 1)] }), now)).toBe('live')
    expect(postpone(desk('a', { postponedUntil: 2000 }), undefined)).not.toHaveProperty('postponedUntil')
    expect(postpone(desk('a'), 5000).postponedUntil).toBe(5000)
  })

  it('dims only the parked and the planned WorkDesks: a waiting or postponed one has a section of its own', () => {
    const desks = [desk('a'), desk('w', { stage: 'waiting' }), desk('p', { presence: 'parked' }), desk('n', { presence: 'planned' }), desk('x', { postponedUntil: Date.now() + 1e6 })]
    expect(orderSection(desks).map((o) => [o.desk.id, o.dimmed])).toEqual([['a', false], ['n', true], ['p', true], ['w', false], ['x', false]])
  })

  it('keeps running WorkDesks in your order whatever their Signals; a parked one with a Signal goes on top, oldest first', () => {
    const desks = [
      desk('live2', { priority: 2, signals: [sig('s', 50)] }),
      desk('live1', { priority: 1 }),
      desk('park-new', { presence: 'parked', priority: 0, signals: [sig('s', 300)] }),
      desk('park-old', { presence: 'parked', priority: 9, signals: [sig('s', 100)] }),
      desk('wait', { stage: 'waiting', priority: 5, signals: [sig('s', 100)] })
    ]
    expect(sidebarOrder(desks).map((o) => o.desk.id)).toEqual(['park-old', 'park-new', 'live1', 'live2', 'wait'])
  })

  it('puts Signals first (oldest on top), then priority, then waiting dimmed', () => {
    const desks = [
      desk('waiting', { stage: 'waiting', priority: 0 }),
      desk('p2', { priority: 2 }),
      desk('p1', { priority: 1 }),
      desk('newer', { priority: 5, signals: [sig('s', 200)] }),
      desk('older', { priority: 9, signals: [sig('s', 100)] }),
      desk('waiting-signal', { stage: 'waiting', priority: 7, signals: [sig('s', 300)] })
    ]
    const ordered = orderDesks(desks)
    expect(ordered.map((o) => o.desk.id)).toEqual(['older', 'newer', 'waiting-signal', 'p1', 'p2', 'waiting'])
    expect(ordered.map((o) => o.dimmed)).toEqual([false, false, false, false, false, true])
  })

  it('reprioritizes by moving a desk', () => {
    const desks = [desk('a', { priority: 0 }), desk('b', { priority: 1 }), desk('c', { priority: 2 })]
    const moved = reprioritize(desks, 'c', 0)
    expect(moved.sort((x, y) => x.priority - y.priority).map((d) => d.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('presence', () => {
  it('keeps exactly one desk active and leaves parked ones alone', () => {
    const desks = [desk('a', { presence: 'active' }), desk('b'), desk('c', { presence: 'parked' })]
    const next = activate(desks, 'b')
    expect(next.map((d) => d.presence)).toEqual(['inactive', 'active', 'parked'])
  })

  it('parks and reactivates', () => {
    const parked = park(desk('a', { presence: 'active' }))
    expect(parked.presence).toBe('parked')
    expect(reactivate(parked).presence).toBe('inactive')
    expect(() => reactivate(desk('b'))).toThrow()
  })
})
