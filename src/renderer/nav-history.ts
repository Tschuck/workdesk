// The cursor history of a WorkDesk (⌃- back, ⌃⇧- forward) across its File panes; the logic is in domain/cursor-history.ts.
import { canBack, canForward, emptyHistory, forgetPath, record, step, type CursorHistory, type Place } from '../main/domain/cursor-history'

const histories = new Map<string, CursorHistory>()
const get = (deskId: string): CursorHistory => histories.get(deskId) ?? emptyHistory()

export const recordPlace = (deskId: string, place: Place): void => void histories.set(deskId, record(get(deskId), place))

/** The place one step back (-1) or forward (1), which is then the current one; nothing at the ends. */
export function stepPlace(deskId: string, dir: -1 | 1): Place | undefined {
  const r = step(get(deskId), dir)
  histories.set(deskId, r.history)
  return r.place
}

export const canStep = (deskId: string, dir: -1 | 1): boolean => (dir < 0 ? canBack(get(deskId)) : canForward(get(deskId)))

/** a file was renamed or removed */
export const forgetFile = (deskId: string, from: string, to?: string): void => void histories.set(deskId, forgetPath(get(deskId), from, to))

/** ⌃- and ⌃⇧- (Control and the minus key, as in VS Code on a Mac); -1 back, 1 forward */
export function historyDirection(e: { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): -1 | 1 | undefined {
  if (e.code !== 'Minus' || !e.ctrlKey || e.metaKey || e.altKey) return undefined
  return e.shiftKey ? 1 : -1
}
