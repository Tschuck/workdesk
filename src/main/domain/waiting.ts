import { oldestOpenSignal } from './signal'
import { isWaitingStage } from './stage'
import type { WorkDesk } from './types'

/**
 * The WorkDesks whose Stage just became a waiting one, with nothing that needs you, and that are still running (active or inactive,
 * not parked or planned). Only the Stage counts: a Signal that comes and goes moves a WorkDesk between Working and Waiting in the
 * list, but that is not a move to Waiting.
 */
export function enteredWaiting(before: readonly WorkDesk[], after: readonly WorkDesk[]): WorkDesk[] {
  const was = new Map(before.map((d) => [d.id, d]))
  return after.filter((d) => {
    const old = was.get(d.id)
    if (!old || d.presence === 'parked' || d.presence === 'planned') return false
    return isWaitingStage(d.stage) && !isWaitingStage(old.stage) && !oldestOpenSignal(d)
  })
}
