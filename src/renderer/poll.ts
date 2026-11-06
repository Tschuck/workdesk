/**
 * Runs `fn` now, again every `ms` while the window has the focus (a window in the background does not need fresh answers),
 * and once more when the window gets the focus back. Returns what stops it.
 */
export function pollWhileFocused(fn: () => void, ms: number): () => void {
  fn()
  const timer = setInterval(() => document.hasFocus() && fn(), ms)
  window.addEventListener('focus', fn)
  return () => {
    clearInterval(timer)
    window.removeEventListener('focus', fn)
  }
}
