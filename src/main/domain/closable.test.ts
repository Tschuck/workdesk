import { describe, expect, it } from 'vitest'
import { closableDeskIds } from './closable'
import type { Todo, WorkDesk } from './types'

const pr = (id: string) => ({ kind: 'pr' as const, id, title: id })
const desk = (id: string, over: Partial<WorkDesk> = {}) => ({ id, name: id, presence: 'inactive', items: [pr(`o/r#${id}`)], todoIds: [], branches: [], signals: [], ...over }) as unknown as WorkDesk
const todo = (id: string, deskId: string, resolved: boolean) => ({ id, deskId, resolved }) as unknown as Todo

describe('WorkDesks that can be cleared', () => {
  it('have only pull requests that are merged or closed, and no open Todo', () => {
    const desks = [desk('1'), desk('2'), desk('3'), desk('4'), desk('5', { presence: 'planned' }), desk('6', { items: [] }), desk('7', { items: [pr('o/r#7'), pr('o/r#70')] })]
    const states = { 'o/r#1': { state: 'merged' as const }, 'o/r#2': { state: 'open' as const }, 'o/r#4': { state: 'closed' as const }, 'o/r#5': { state: 'merged' as const }, 'o/r#7': { state: 'merged' as const }, 'o/r#70': { state: 'open' as const } }
    const todos = [todo('a', '4', false), todo('b', '1', true)]
    // 1 is done; 2 is open; 3 is not known; 4 has an open Todo; 5 is planned; 6 has no pull request; 7 has an open one
    expect([...closableDeskIds(desks, todos, states)]).toEqual(['1'])
  })
  it('know a reviewed pull request from what the review saw last', () => {
    const d = desk('9', { items: [], reviews: [{ owner: 'o', repo: 'r', number: 9, url: 'u', snapshot: { state: 'merged' } as never }] })
    expect([...closableDeskIds([d], [], {})]).toEqual(['9'])
    expect([...closableDeskIds([{ ...d, reviews: [{ ...d.reviews![0], snapshot: { state: 'open' } as never }] }], [], {})]).toEqual([])
    expect([...closableDeskIds([{ ...d, reviews: [{ ...d.reviews![0], snapshot: undefined }] }], [], {})]).toEqual([])
  })
})

import { sectionOf, sidebarOrder } from './order'

describe('the section for WorkDesks that can be cleared', () => {
  const base = (id: string, over: Partial<WorkDesk> = {}) => ({ id, name: id, stage: 'implement', stageOverridden: false, priority: 0, presence: 'inactive', todoIds: [], branches: [], signals: [], createdAt: 0, ...over }) as WorkDesk
  it('comes after Waiting, takes parked ones too, and leaves postponed and planned ones where they are', () => {
    const closable = new Set(['c', 'p', 'z', 'n'])
    const desks = [base('w', { stage: 'waiting' }), base('c'), base('p', { presence: 'parked' }), base('live'), base('z', { postponedUntil: Date.now() + 10_000 }), base('n', { presence: 'planned' })]
    expect(desks.map((d) => sectionOf(d, Date.now(), closable))).toEqual(['waiting', 'closable', 'closable', 'live', 'postponed', 'planned'])
    expect(sidebarOrder(desks, closable).map((o) => o.desk.id)).toEqual(['live', 'w', 'c', 'p', 'n', 'z'])
    // without the set nothing changes
    expect(sectionOf(base('c'))).toBe('live')
  })
})
