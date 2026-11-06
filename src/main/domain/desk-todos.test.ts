import { describe, expect, it } from 'vitest'
import { deskChecklist, placeInDesk, progress, stepInDesk } from './desk-todos'
import type { Todo, WorkDesk } from './types'

const todo = (id: string, resolved = false): Todo => ({ id, title: id, topics: [], list: 'today', resolved, createdAt: 0 })
const desk = (todoIds: string[]): WorkDesk => ({ id: 'd', name: 'd', stage: 'implement', stageOverridden: false, priority: 0, presence: 'inactive', todoIds, branches: [], signals: [], createdAt: 0 })

describe('desk checklist', () => {
  it('lists the Todos in the order of todoIds and counts progress', () => {
    const list = deskChecklist(desk(['b', 'a', 'gone']), [todo('a', true), todo('b'), todo('c')])
    expect(list.map((t) => t.id)).toEqual(['b', 'a'])
    expect(progress(list)).toEqual({ done: 1, total: 2 })
  })

  it('places before or after another one', () => {
    expect(placeInDesk(desk(['a', 'b', 'c']), 'a', 'c', true).todoIds).toEqual(['b', 'c', 'a'])
    expect(placeInDesk(desk(['a', 'b', 'c']), 'c', 'a', false).todoIds).toEqual(['c', 'a', 'b'])
    expect(() => placeInDesk(desk(['a']), 'a', 'x', true)).toThrow()
  })

  it('steps up and down, stopping at the ends', () => {
    expect(stepInDesk(desk(['a', 'b', 'c']), 'b', -1).todoIds).toEqual(['b', 'a', 'c'])
    expect(stepInDesk(desk(['a', 'b', 'c']), 'b', 1).todoIds).toEqual(['a', 'c', 'b'])
    expect(stepInDesk(desk(['a', 'b']), 'a', -1).todoIds).toEqual(['a', 'b'])
  })
})
