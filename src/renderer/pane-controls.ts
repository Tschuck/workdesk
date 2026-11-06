import { useSyncExternalStore } from 'react'

const KEY = 'workdesk.paneControls'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

let shown = read()
const apply = () => document.documentElement.classList.toggle('no-pane-controls', !shown)
apply()

/** The buttons on each pane (split, move, close) can be hidden for keyboard use; the choice is kept per machine. */
export function setPaneControls(on: boolean): void {
  shown = on
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // remembering is a convenience only
  }
  apply()
  listeners.forEach((l) => l())
}

export const usePaneControls = (): boolean =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => shown
  )
