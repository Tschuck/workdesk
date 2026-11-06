import { useSyncExternalStore } from 'react'

const KEY = 'workdesk.fileWrap'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

let wrap = read()

/** Word wrap in the File panes: one setting for all of them, kept on this machine. */
export function setFileWrap(on: boolean): void {
  wrap = on
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // remembering is a convenience only
  }
  listeners.forEach((l) => l())
}

export const toggleFileWrap = (): void => setFileWrap(!wrap)

export const useFileWrap = (): boolean =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => wrap
  )
