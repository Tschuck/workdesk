import { describe, expect, it } from 'vitest'
import { dueReminders, fromLocalInput, isOverdue, markReminded, setDue, snoozeTodo, toLocalInput } from './reminders'
import type { Todo } from './types'

const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({ id, title: id, topics: [], list: 'today', resolved: false, createdAt: 0, ...extra })
const NOW = new Date(2026, 10, 1, 10, 0).getTime()
const H = 3_600_000

describe('reminders', () => {
  it('fires once when the due time has come, for open Todos only', () => {
    const todos = [todo('a', { dueAt: NOW - H }), todo('b', { dueAt: NOW + H }), todo('c', { dueAt: NOW - H, resolved: true }), todo('d')]
    expect(dueReminders(todos, NOW).map((t) => t.id)).toEqual(['a'])
    const after = markReminded(todos, ['a'], NOW)
    expect(dueReminders(after, NOW + 1)).toEqual([])
    expect(dueReminders(after, NOW + 2 * H).map((t) => t.id)).toEqual(['b'])
  })

  it('a snooze moves the reminder and fires again', () => {
    let todos = markReminded([todo('a', { dueAt: NOW - H })], ['a'], NOW - H)
    todos = snoozeTodo(todos, 'a', NOW + H, NOW)
    expect(dueReminders(todos, NOW)).toEqual([])
    expect(dueReminders(todos, NOW + H).map((t) => t.id)).toEqual(['a'])
    expect(isOverdue(todos[0], NOW)).toBe(true)
  })

  it('refuses a snooze into the past or without a due time', () => {
    expect(() => snoozeTodo([todo('a', { dueAt: NOW })], 'a', NOW, NOW)).toThrow()
    expect(() => snoozeTodo([todo('a')], 'a', NOW + H, NOW)).toThrow(/no due time/)
    expect(() => snoozeTodo([], 'x', NOW + H, NOW)).toThrow(/Unknown/)
  })

  it('a new due time resets snooze and reminder; removing it clears all', () => {
    const t = todo('a', { dueAt: NOW, snoozedUntil: NOW + H, remindedAt: NOW })
    const moved = setDue([t], 'a', NOW + 5 * H)[0]
    expect(moved).toMatchObject({ dueAt: NOW + 5 * H })
    expect(moved.snoozedUntil).toBeUndefined()
    expect(moved.remindedAt).toBeUndefined()
    expect(setDue([t], 'a', undefined)[0].dueAt).toBeUndefined()
  })

  it('converts to and from the datetime-local value', () => {
    expect(toLocalInput(NOW)).toBe('2026-11-01T10:00')
    expect(fromLocalInput('2026-11-01T10:00')).toBe(NOW)
    expect(fromLocalInput('')).toBeUndefined()
    expect(toLocalInput(undefined)).toBe('')
  })
})
