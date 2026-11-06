import { useSyncExternalStore } from 'react'

/** The title each terminal has (what its program sets, or its command and folder), kept while the app runs: the list of tabs shows them. */
let titles: Record<string, string> = {}
const listeners = new Set<() => void>()

export function setTerminalTitle(paneId: string, title: string): void {
  const clean = title.replace(/\s+/g, ' ').trim()
  if (!clean || titles[paneId] === clean) return
  titles = { ...titles, [paneId]: clean }
  listeners.forEach((l) => l())
}

export const useTerminalTitles = (): Record<string, string> =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => titles
  )

/** A terminal's title for a list: a shell's `user@host:/some/folder` is shortened to the folder's name; anything else a program set stays as it is. */
export function listTitle(title: string): string {
  const m = /^[^@\s]+@[^:\s]+:(.*)$/.exec(title)
  if (!m) return title
  const path = m[1].trim()
  return path === '~' || path === '/' ? path : (path.split('/').filter(Boolean).pop() ?? path)
}
