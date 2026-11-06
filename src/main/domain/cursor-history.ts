/** Back / forward through the places the cursor was, across files (like VS Code's ⌃- and ⌃⇧-). Pure: the caller keeps the value. */

export interface Place {
  path: string
  line: number
  column: number
}

export interface CursorHistory {
  places: Place[]
  /** index of the place the cursor is at now */
  at: number
}

export const MAX_PLACES = 100
/** a move this close, inside the same file, is the same place (typing, arrow keys) and does not add an entry */
export const NEAR_LINES = 10

export const emptyHistory = (): CursorHistory => ({ places: [], at: -1 })

/** The cursor is at `place`: remembered as a new entry when it is another file or far from the last place, else the last entry follows it. */
export function record(h: CursorHistory, place: Place): CursorHistory {
  const cur = h.places[h.at]
  if (cur && cur.path === place.path && Math.abs(cur.line - place.line) < NEAR_LINES) {
    if (cur.line === place.line && cur.column === place.column) return h
    const places = h.places.slice()
    places[h.at] = place
    return { places, at: h.at }
  }
  // a new place ends the forward part
  let places = [...h.places.slice(0, h.at + 1), place]
  if (places.length > MAX_PLACES) places = places.slice(places.length - MAX_PLACES)
  return { places, at: places.length - 1 }
}

export const canBack = (h: CursorHistory): boolean => h.at > 0
export const canForward = (h: CursorHistory): boolean => h.at >= 0 && h.at < h.places.length - 1

/** One step back or forward: the new history and the place to go to (nothing when there is no step). */
export function step(h: CursorHistory, dir: -1 | 1): { history: CursorHistory; place?: Place } {
  const at = h.at + dir
  if (at < 0 || at >= h.places.length) return { history: h }
  return { history: { places: h.places, at }, place: h.places[at] }
}

/** A file was renamed or removed: its places follow it (`to`) or go; neighbours that became equal merge. */
export function forgetPath(h: CursorHistory, from: string, to?: string): CursorHistory {
  const places: Place[] = []
  let at = -1
  h.places.forEach((p, i) => {
    const moved = p.path === from ? (to ? { ...p, path: to } : undefined) : p
    if (!moved) return
    const last = places[places.length - 1]
    if (last && last.path === moved.path && last.line === moved.line) {
      if (i <= h.at) at = places.length - 1
      return
    }
    places.push(moved)
    if (i <= h.at) at = places.length - 1
  })
  return { places, at }
}
