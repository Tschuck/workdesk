import { describe, expect, it } from 'vitest'
import { nextDue, setRepeat, spawnNext } from './recurrence'
import { TEMPLATES, fromTemplate, templateById } from './templates'
import { isValidStage } from './stage'
import type { Todo } from './types'

const at = (d: number, h = 9) => new Date(2026, 10, d, h, 0).getTime() // Nov 2026: 1st is a Sunday
const todo = (extra: Partial<Todo> = {}): Todo => ({ id: 'a', title: 'water plants', topics: ['home'], list: 'today', resolved: false, createdAt: 0, ...extra })

describe('recurrence', () => {
  it('counts daily and weekly from the due time, keeping the time of day', () => {
    expect(nextDue(at(2), 'daily', at(2, 12))).toBe(at(3))
    expect(nextDue(at(2), 'weekly', at(2, 12))).toBe(at(9))
  })

  it('skips the weekend for weekdays', () => {
    expect(nextDue(at(6), 'weekdays', at(6, 12))).toBe(at(9)) // Friday -> Monday
    expect(nextDue(at(2), 'weekdays', at(2, 12))).toBe(at(3))
  })

  it('catches up when it was resolved late', () => {
    expect(nextDue(at(2), 'daily', at(5, 12))).toBe(at(6))
    expect(nextDue(at(2), 'weekly', at(20, 12))).toBe(at(23))
  })

  it('needs a due time to repeat', () => {
    expect(() => setRepeat([todo()], 'a', 'daily')).toThrow(/due time/)
    expect(setRepeat([todo({ dueAt: at(2) })], 'a', 'daily')[0].repeat).toBe('daily')
    expect(setRepeat([todo({ dueAt: at(2), repeat: 'daily' })], 'a', undefined)[0].repeat).toBeUndefined()
  })

  it('starts the next Todo from a resolved repeating one', () => {
    const next = spawnNext(todo({ dueAt: at(2), repeat: 'daily', deskId: 'd', resolved: true, remindedAt: 5, snoozedUntil: 6 }), 'b', at(2, 10))!
    expect(next).toMatchObject({ id: 'b', title: 'water plants', topics: ['home'], deskId: 'd', repeat: 'daily', dueAt: at(3), resolved: false })
    expect(next.remindedAt).toBeUndefined()
    expect(next.snoozedUntil).toBeUndefined()
    expect(spawnNext(todo({ dueAt: at(2) }), 'b', 0)).toBeUndefined()
  })
})

describe('templates', () => {
  it('make a Plain WorkDesk with its Todos in order and a valid Stage', () => {
    for (const t of TEMPLATES) expect(isValidStage(t.stage)).toBe(true)
    let n = 0
    const { desk, todos } = fromTemplate(templateById('bug-triage'), [], 'bug-1', 'Bug 1', () => `t${n++}`, 10)
    expect(desk).toMatchObject({ id: 'bug-1', stage: 'implement', stageOverridden: true, priority: 0 })
    expect(desk.todoIds).toEqual(todos.map((t) => t.id))
    expect(todos.every((t) => t.deskId === 'bug-1' && t.list === 'today')).toBe(true)
    expect(todos).toHaveLength(templateById('bug-triage').todos.length)
    expect(() => templateById('nope')).toThrow()
  })
})
