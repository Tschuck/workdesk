import type { WorkDesk } from '../main/domain/types'
import type { Command } from './command-palette'

export interface DeskActionHandlers {
  park: (id: string) => void
  reactivate: (id: string) => void
  postpone: (id: string) => void
  bringBack: (id: string) => void
  groupByBranch: (id: string, on: boolean) => void
  combine: (id: string) => void
}

/** What the palette offers for the WorkDesk on screen: park / reactivate, postpone / bring back, group the tabs by branch. */
export function deskPaletteActions(desk: WorkDesk | undefined, h: DeskActionHandlers, now: number = Date.now()): Command[] {
  if (!desk) return []
  const out: Command[] = []
  const group = `WorkDesk ${desk.name}`
  if (desk.presence === 'parked') out.push({ id: 'this-reactivate', title: 'Reactivate this WorkDesk', group, keywords: 'park unpark wake start', run: () => h.reactivate(desk.id) })
  else if (desk.presence !== 'planned') out.push({ id: 'this-park', title: 'Park this WorkDesk', group, keywords: 'shut down free memory', run: () => h.park(desk.id) })
  if (desk.postponedUntil && desk.postponedUntil > now) out.push({ id: 'this-bring-back', title: 'Bring this WorkDesk back from postponed', group, keywords: 'unpostpone snooze', run: () => h.bringBack(desk.id) })
  else out.push({ id: 'this-postpone', title: 'Postpone this WorkDesk…', group, keywords: 'snooze later hours tomorrow', run: () => h.postpone(desk.id) })
  if (desk.branches.length >= 2 && desk.presence !== 'parked' && desk.presence !== 'planned') {
    const on = !!desk.groupTabsByBranch
    out.push({ id: 'this-group-branch', title: on ? 'Stop grouping the tabs by branch' : 'Group the tabs by branch', group, keywords: 'branches list tabs', run: () => h.groupByBranch(desk.id, !on) })
  }
  out.push({ id: 'this-combine', title: 'Combine this WorkDesk with another…', group, keywords: 'merge join two desks pull requests backend frontend take in', run: () => h.combine(desk.id) })
  return out
}
