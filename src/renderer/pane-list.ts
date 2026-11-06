import { useSyncExternalStore } from 'react'

/**
 * What a list of tabs shows under a Tab that has several Panes: all of them under every Tab (the default), or only under the active
 * Tab (the others open with their arrow). Kept on this machine.
 */
const KEY = 'workdesk.panesActiveOnly'
const listeners = new Set<() => void>()

export function getPanesActiveOnly(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setPanesActiveOnly(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // remembering is a convenience only
  }
  listeners.forEach((l) => l())
}

export function usePanesActiveOnly(): boolean {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    getPanesActiveOnly
  )
}
