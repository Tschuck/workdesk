import { useSyncExternalStore } from 'react'

/** What happens to a running WorkDesk that moves to Waiting: ask me, park it (shut its terminals down), or leave it as it is. Kept on this machine. */
export type WaitingPolicy = 'ask' | 'park' | 'keep'

const KEY = 'workdesk.waitingPolicy'
const listeners = new Set<() => void>()

function read(): WaitingPolicy {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'park' || v === 'keep' ? v : 'ask'
  } catch {
    return 'ask'
  }
}

let policy = read()

export function setWaitingPolicy(next: WaitingPolicy): void {
  policy = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // remembering is a convenience only
  }
  listeners.forEach((l) => l())
}

const SKIP = 'workdesk.waitingSkip'
const skipped = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(SKIP) ?? '[]') as string[]
  } catch {
    return []
  }
}
/** WorkDesks that are never asked about (the answer was "keep it active, do not ask again for this one") */
export const isWaitingSkipped = (deskId: string): boolean => skipped().includes(deskId)
export function skipWaitingFor(deskId: string): void {
  try {
    localStorage.setItem(SKIP, JSON.stringify([...new Set([...skipped(), deskId])]))
  } catch {
    // remembering is a convenience only
  }
}

export const waitingPolicy = (): WaitingPolicy => policy
export const useWaitingPolicy = (): WaitingPolicy =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => policy
  )
