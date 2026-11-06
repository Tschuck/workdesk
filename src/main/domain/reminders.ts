import type { Todo } from './types'

/** When the reminder of a Todo comes: its snooze time if snoozed, else its due time. */
export const reminderAt = (t: Pick<Todo, 'dueAt' | 'snoozedUntil'>): number | undefined => t.snoozedUntil ?? t.dueAt

/** Is the Todo's reminder to be raised now? Open Todos only, once per due or snooze time. */
export function isReminderDue(t: Todo, now: number): boolean {
  const at = reminderAt(t)
  return !t.resolved && at !== undefined && at <= now && (t.remindedAt ?? -Infinity) < at
}

/** The Todos whose reminder is to be raised now. */
export const dueReminders = (todos: readonly Todo[], now: number): Todo[] => todos.filter((t) => isReminderDue(t, now))

/** Overdue: past its due time and still open (whatever was reminded or snoozed). */
export const isOverdue = (t: Pick<Todo, 'dueAt' | 'resolved'>, now: number): boolean => !t.resolved && t.dueAt !== undefined && t.dueAt <= now

function update(todos: readonly Todo[], id: string, fn: (t: Todo) => Todo): Todo[] {
  if (!todos.some((t) => t.id === id)) throw new Error(`Unknown Todo ${id}`)
  return todos.map((t) => (t.id === id ? fn(t) : t))
}

/** Set or (with `undefined`) remove the due time. A new due time resets snooze and reminder. */
export const setDue = (todos: readonly Todo[], id: string, dueAt: number | undefined): Todo[] =>
  update(todos, id, ({ dueAt: _d, snoozedUntil: _s, remindedAt: _r, ...t }) => {
    if (dueAt !== undefined) return { ...t, dueAt }
    const { repeat: _rep, ...rest } = t // nothing to count the next one from
    return rest
  })

/** Remind again at `until`. Only a Todo with a due time can be snoozed. */
export function snoozeTodo(todos: readonly Todo[], id: string, until: number, now: number): Todo[] {
  if (!(until > now)) throw new Error('Snooze until a time that is still to come')
  return update(todos, id, (t) => {
    if (t.dueAt === undefined) throw new Error(`"${t.title}" has no due time`)
    return { ...t, snoozedUntil: until }
  })
}

export const markReminded = (todos: readonly Todo[], ids: readonly string[], now: number): Todo[] =>
  todos.map((t) => (ids.includes(t.id) ? { ...t, remindedAt: now } : t))

/** "Due 14:30", "Due tomorrow 06:00" or "Overdue since Mon 09:00". */
export function dueLabel(t: Pick<Todo, 'dueAt' | 'resolved'>, now: number): string {
  if (t.dueAt === undefined) return ''
  const d = new Date(t.dueAt)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  const today = new Date(now)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const day = d.toDateString() === today.toDateString() ? '' : d.toDateString() === tomorrow.toDateString() ? 'tomorrow ' : `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} `
  return `${isOverdue(t, now) ? 'Overdue since' : 'Due'} ${day}${time}`
}

/** Epoch ms to the value of an `<input type="datetime-local">` (local time), and back; '' for none/invalid. */
export function toLocalInput(ms: number | undefined): string {
  if (ms === undefined) return ''
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
export function fromLocalInput(value: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!m) return undefined
  const ms = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime()
  return Number.isNaN(ms) ? undefined : ms
}
