import { isOverdue, reminderAt } from './reminders'
import { openSignals } from './signal'
import { localDateString } from './todos'
import type { Signal, Todo, WorkDesk } from './types'

export type NextItem =
  | { kind: 'signal'; at: number; deskId: string; deskName: string; signal: Signal }
  | { kind: 'todo'; at: number; deskId?: string; deskName?: string; todo: Todo; overdue: boolean }
  | { kind: 'postponed'; at: number; deskId: string; deskName: string; until: number; due: boolean }
  | { kind: 'closable'; at: number; deskId: string; deskName: string }

/**
 * "What next?": open Signals first (oldest first), then open Todos (overdue and due ones by time, then the rest in
 * list order), then WorkDesks that can be cleared (everything in them is done), then postponed WorkDesks by the time they come back
 * (those whose time has come are `due`).
 * Planned and parked WorkDesks count too. Todos are those of WorkDesks and of Today; Backlog Todos, resolved ones and
 * ones hidden from Today by their own postponement are not.
 */
export function whatNext(todos: readonly Todo[], desks: readonly WorkDesk[], now: number, closable?: ReadonlySet<string>): NextItem[] {
  const deskName = new Map(desks.map((d) => [d.id, d.name]))
  const signals: NextItem[] = desks
    .flatMap((d) => openSignals(d).map((signal): NextItem => ({ kind: 'signal', at: signal.at, deskId: d.id, deskName: d.name, signal })))
    .sort((a, b) => a.at - b.at)
  const today = localDateString(now)
  const open = todos.filter((t) => !t.resolved && (t.deskId !== undefined || t.list === 'today') && !(t.postponedUntil && t.postponedUntil > today))
  const timed = open.filter((t) => reminderAt(t) !== undefined || t.dueAt !== undefined)
  const untimed = open.filter((t) => !timed.includes(t))
  const toItem = (t: Todo): NextItem => ({ kind: 'todo', at: t.dueAt ?? 0, deskId: t.deskId, deskName: t.deskId ? deskName.get(t.deskId) : undefined, todo: t, overdue: isOverdue(t, now) })
  const todoItems = [...timed.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)).map(toItem), ...untimed.map(toItem)]
  const postponed: NextItem[] = desks
    .filter((d) => d.postponedUntil !== undefined)
    .map((d): NextItem => ({ kind: 'postponed', at: d.postponedUntil!, deskId: d.id, deskName: d.name, until: d.postponedUntil!, due: d.postponedUntil! <= now }))
    .sort((a, b) => a.at - b.at)
  // done and worth clearing: not the ones that are postponed or planned, which have their own say
  const clearable: NextItem[] = desks
    .filter((d) => closable?.has(d.id) && d.presence !== 'planned' && !(d.postponedUntil && d.postponedUntil > now))
    .map((d): NextItem => ({ kind: 'closable', at: d.createdAt, deskId: d.id, deskName: d.name }))
  return [...signals, ...todoItems, ...clearable, ...postponed]
}
