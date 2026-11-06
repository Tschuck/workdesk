export type NavDirection = 'left' | 'right' | 'up' | 'down'

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * The Pane to move to from `from` in a direction: the nearest one that lies beyond it, preferring Panes
 * that overlap it on the other axis (so "right" goes to what is beside it, not to a diagonal corner).
 * Undefined at the edge: the focus stays where it is.
 */
export function neighbourPane(boxes: readonly Box[], from: number, dir: NavDirection): number | undefined {
  const a = boxes[from]
  if (!a) return undefined
  const horizontal = dir === 'left' || dir === 'right'
  let best: { index: number; overlap: boolean; gap: number; off: number } | undefined
  boxes.forEach((b, index) => {
    if (index === from) return
    // how far it lies beyond `a` in the direction (negative: not beyond, skip); a small tolerance for 1px gaps
    const gap = dir === 'right' ? b.left - a.right : dir === 'left' ? a.left - b.right : dir === 'down' ? b.top - a.bottom : a.top - b.bottom
    if (gap < -1) return
    const overlap = horizontal ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0 : Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0
    const centre = (box: Box) => (horizontal ? (box.top + box.bottom) / 2 : (box.left + box.right) / 2)
    const off = Math.abs(centre(a) - centre(b))
    const better = !best || (overlap && !best.overlap) || (overlap === best.overlap && (gap < best.gap - 1 || (Math.abs(gap - best.gap) <= 1 && off < best.off)))
    if (better) best = { index, overlap, gap: Math.max(gap, 0), off }
  })
  return best?.index
}

/** Command+arrow without any other modifier: the direction, or undefined for any other key. */
export function navDirection(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): NavDirection | undefined {
  if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return undefined
  return e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : undefined
}

/** Command+Shift+arrow: split the Pane in that direction. Right and down put the new Pane after it, left and up before it. */
export function splitDirection(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): { direction: 'horizontal' | 'vertical'; before: boolean } | undefined {
  if (!e.metaKey || e.ctrlKey || e.altKey || !e.shiftKey) return undefined
  switch (e.key) {
    case 'ArrowLeft': return { direction: 'horizontal', before: true }
    case 'ArrowRight': return { direction: 'horizontal', before: false }
    case 'ArrowUp': return { direction: 'vertical', before: true }
    case 'ArrowDown': return { direction: 'vertical', before: false }
    default: return undefined
  }
}
