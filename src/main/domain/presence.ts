import type { Presence, WorkDesk } from './types'

/** Exactly one WorkDesk is active; parked ones stay parked until reactivated explicitly. Activating a planned one starts it. */
export function activate(desks: readonly WorkDesk[], deskId: string): WorkDesk[] {
  const target = desks.find((d) => d.id === deskId)
  if (!target) throw new Error(`Unknown WorkDesk ${deskId}`)
  if (target.presence === 'parked') throw new Error(`WorkDesk ${deskId} is parked; reactivate it first`)
  return desks.map((d) => {
    if (d.id === deskId) return { ...d, presence: 'active' as Presence }
    return d.presence === 'active' ? { ...d, presence: 'inactive' as Presence } : d
  })
}

export function park(desk: WorkDesk): WorkDesk {
  return { ...desk, presence: 'parked' }
}

/** Reactivating a parked desk makes it inactive; activating is a separate step. */
export function reactivate(desk: WorkDesk): WorkDesk {
  if (desk.presence !== 'parked') throw new Error(`WorkDesk ${desk.id} is not parked`)
  return { ...desk, presence: 'inactive' }
}

/** Put a WorkDesk out of the way until `until`; `undefined` brings it back now. */
export function postpone(desk: WorkDesk, until: number | undefined): WorkDesk {
  const { postponedUntil: _, ...rest } = desk
  return until === undefined ? rest : { ...rest, postponedUntil: until }
}
