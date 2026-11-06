import { isWaitingStage } from './stage'
import { isPostponed } from './postpone'
import { oldestOpenSignal } from './signal'
import type { WorkDesk } from './types'

export interface OrderedDesk {
  desk: WorkDesk
  /** waiting Stage without a Signal */
  dimmed: boolean
}

type Group = 0 | 1 | 2

function groupOf(desk: WorkDesk): Group {
  if (oldestOpenSignal(desk)) return 0
  // planned WorkDesks wait for their turn: below the ones in progress, dimmed
  return desk.presence === 'planned' || isWaitingStage(desk.stage) ? 2 : 1
}

/**
 * WorkDesk order: open Signals first (oldest on top), then manual priority,
 * then waiting Stages without a Signal last.
 */
/**
 * Is the WorkDesk waiting for somebody else (a waiting Stage) and nothing needs you? Parked or running, it is listed under Waiting;
 * a Signal brings it out. A planned WorkDesk has not started, so it is never waiting.
 */
export const isWaiting = (desk: WorkDesk): boolean => desk.presence !== 'planned' && isWaitingStage(desk.stage) && !oldestOpenSignal(desk)

export type SidebarSection = 'live' | 'waiting' | 'closable' | 'planned' | 'postponed'

/**
 * The part of the left panel a WorkDesk is listed in, by what it is doing. Parked is no section: a parked WorkDesk stays in the
 * one it belongs to. A Signal brings a waiting or postponed WorkDesk back out, since somebody answered.
 */
export function sectionOf(desk: WorkDesk, now: number = Date.now(), closable?: ReadonlySet<string>): SidebarSection {
  if (isPostponed(desk, now)) return 'postponed'
  if (desk.presence === 'planned') return 'planned'
  // everything it was about is done: it can be cleared (a Signal does not change that)
  if (closable?.has(desk.id)) return 'closable'
  return isWaiting(desk) ? 'waiting' : 'live'
}

/**
 * The WorkDesks of one section in the order the left panel lists them: your manual order. A running one keeps its place whatever its
 * Signals (its red number says so); a parked one with a Signal would be out of sight, so it goes on top, oldest Signal first.
 */
export function orderSection(desks: readonly WorkDesk[]): OrderedDesk[] {
  return [...desks]
    .sort((a, b) => {
      const sa = a.presence === 'parked' ? oldestOpenSignal(a) : undefined
      const sb = b.presence === 'parked' ? oldestOpenSignal(b) : undefined
      if (!sa !== !sb) return sa ? -1 : 1
      if (sa && sb && sa.at !== sb.at) return sa.at - sb.at
      return a.priority - b.priority || a.id.localeCompare(b.id)
    })
    .map((desk) => ({ desk, dimmed: desk.presence === 'planned' || desk.presence === 'parked' }))
}

/** The WorkDesks as the left panel lists them (and as ⌘1…⌘9 number them): the ones in use, the waiting, the planned, then the postponed. */
export function sidebarOrder(desks: readonly WorkDesk[], closable?: ReadonlySet<string>): OrderedDesk[] {
  const now = Date.now()
  return (['live', 'waiting', 'closable', 'planned', 'postponed'] as const).flatMap((s) => orderSection(desks.filter((d) => sectionOf(d, now, closable) === s)))
}

export function orderDesks(desks: readonly WorkDesk[]): OrderedDesk[] {
  return desks
    .map((desk) => ({ desk, group: groupOf(desk) }))
    .sort((a, b) => {
      if (a.group !== b.group) return a.group - b.group
      if (a.group === 0) {
        const diff = oldestOpenSignal(a.desk)!.at - oldestOpenSignal(b.desk)!.at
        if (diff !== 0) return diff
      }
      return a.desk.priority - b.desk.priority || a.desk.id.localeCompare(b.desk.id)
    })
    .map(({ desk, group }) => ({ desk, dimmed: group === 2 }))
}

/** Move a desk to a new index in the manual priority order and renumber. */
export function reprioritize(desks: readonly WorkDesk[], deskId: string, toIndex: number): WorkDesk[] {
  const byPriority = [...desks].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
  const from = byPriority.findIndex((d) => d.id === deskId)
  if (from === -1) throw new Error(`Unknown WorkDesk ${deskId}`)
  const [moved] = byPriority.splice(from, 1)
  byPriority.splice(Math.max(0, Math.min(toIndex, byPriority.length)), 0, moved)
  return byPriority.map((d, i) => ({ ...d, priority: i }))
}

/** Drop `deskId` onto `targetId`: it takes the target's place in the manual priority order. */
export function moveBefore(desks: readonly WorkDesk[], deskId: string, targetId: string): WorkDesk[] {
  if (deskId === targetId) return [...desks]
  const sorted = [...desks].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
  const without = sorted.filter((d) => d.id !== deskId)
  const target = without.findIndex((d) => d.id === targetId)
  if (target === -1 || without.length === sorted.length) throw new Error('Unknown WorkDesk')
  return reprioritize(desks, deskId, target)
}
