import { useEffect, useSyncExternalStore } from 'react'
import type { PaneCwds } from '../main/domain/follow-cd'

// the folder every terminal is in right now, pushed from main when one changes (tmux `pane_current_path`)
let current: PaneCwds = {}
const listeners = new Set<() => void>()
let off: (() => void) | undefined

function start(): void {
  if (off) return
  const api = window.workdesk
  const set = (c: PaneCwds) => {
    current = c
    listeners.forEach((l) => l())
  }
  void api.terminalCwds().then(set, () => undefined)
  off = api.onTerminalCwds(set)
}

const NONE: Record<string, string> = {}

/** Pane id -> the folder its terminal is in right now, for one WorkDesk. Stable between changes of that WorkDesk. */
export function useLiveCwds(deskId: string): Record<string, string> {
  useEffect(start, [])
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current[deskId] ?? NONE
  )
}
