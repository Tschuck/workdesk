import type { Todo } from './types'

export type Repeat = 'daily' | 'weekdays' | 'weekly'
export const REPEATS: { value: Repeat; label: string }[] = [
  { value: 'daily', label: 'every day' },
  { value: 'weekdays', label: 'every weekday' },
  { value: 'weekly', label: 'every week' }
]

const isWeekend = (d: Date): boolean => d.getDay() === 0 || d.getDay() === 6

/** The next time after `from` (same time of day, local) that a Todo with this repeat is due, and strictly after `after`. */
export function nextDue(from: number, repeat: Repeat, after: number): number {
  const d = new Date(from)
  do {
    d.setDate(d.getDate() + (repeat === 'weekly' ? 7 : 1))
  } while (d.getTime() <= after || (repeat === 'weekdays' && isWeekend(d)))
  return d.getTime()
}

/** Set or remove (`undefined`) the repeat of a Todo. It needs a due time, which the next one is counted from. */
export function setRepeat(todos: readonly Todo[], id: string, repeat: Repeat | undefined): Todo[] {
  const t = todos.find((x) => x.id === id)
  if (!t) throw new Error(`Unknown Todo ${id}`)
  if (repeat && t.dueAt === undefined) throw new Error('Set a due time first: the next one is counted from it')
  return todos.map((x) => {
    if (x.id !== id) return x
    const { repeat: _r, ...rest } = x
    return repeat ? { ...rest, repeat } : rest
  })
}

/**
 * Resolving a repeating Todo leaves its record as it is (no more repeat) and starts the next one: same title,
 * topics, WorkDesk and repeat, due at the next time after now.
 */
export function spawnNext(todo: Todo, newId: string, now: number): Todo | undefined {
  if (!todo.repeat || todo.dueAt === undefined) return undefined
  const { resolvedAt: _a, snoozedUntil: _s, remindedAt: _r, source: _src, ...keep } = todo
  return { ...keep, id: newId, resolved: false, dueAt: nextDue(todo.dueAt, todo.repeat, now), createdAt: now }
}
