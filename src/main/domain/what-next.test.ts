import { describe, expect, it } from 'vitest'
import { whatNext } from './what-next'
import type { Todo, WorkDesk } from './types'

const NOW = 1_000_000
const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({ id, title: id, topics: [], list: 'today', resolved: false, createdAt: 0, ...extra })
const desk = (id: string, extra: Partial<WorkDesk> = {}): WorkDesk => ({ id, name: id, stage: 'implement', stageOverridden: false, priority: 0, presence: 'inactive', todoIds: [], branches: [], signals: [], createdAt: 0, ...extra })

describe('what next', () => {
  it('orders open Signals, then Todos (timed first), then postponed WorkDesks', () => {
    const desks = [
      desk('x', { signals: [{ id: 's2', type: 'ci-finished', at: 20, read: false }, { id: 's1', type: 'claude-finished', at: 10, read: false }, { id: 's0', type: 'ci-finished', at: 1, read: true }] }),
      desk('y', { postponedUntil: NOW + 5 }),
      desk('z', { postponedUntil: NOW - 5 })
    ]
    const todos = [todo('backlog', { list: 'backlog' }), todo('hidden', { postponedUntil: '2999-01-01' }), todo('plain'), todo('late', { dueAt: NOW + 100, deskId: 'x' }), todo('over', { dueAt: NOW - 1 }), todo('done', { resolved: true })]
    const next = whatNext(todos, desks, NOW)
    expect(next.map((n) => (n.kind === 'signal' ? n.signal.id : n.kind === 'todo' ? n.todo.id : n.deskId))).toEqual(['s1', 's2', 'over', 'late', 'plain', 'z', 'y'])
    expect(next.find((n) => n.kind === 'todo' && n.todo.id === 'over')).toMatchObject({ overdue: true })
    expect(next.find((n) => n.kind === 'todo' && n.todo.id === 'late')).toMatchObject({ deskName: 'x', overdue: false })
    expect(next.find((n) => n.kind === 'postponed' && n.deskId === 'z')).toMatchObject({ due: true })
  })

  it('lists the WorkDesks that can be cleared after the Todos, not the postponed or planned ones', () => {
    const desks = [desk('done'), desk('later', { postponedUntil: NOW + 5 }), desk('plan', { presence: 'planned' }), desk('open')]
    const next = whatNext([todo('t')], desks, NOW, new Set(['done', 'later', 'plan']))
    expect(next.map((n) => (n.kind === 'todo' ? n.todo.id : n.deskId))).toEqual(['t', 'done', 'later'])
    expect(next.map((n) => n.kind)).toEqual(['todo', 'closable', 'postponed'])
    expect(whatNext([], desks, NOW).some((n) => n.kind === 'closable')).toBe(false)
  })
})
