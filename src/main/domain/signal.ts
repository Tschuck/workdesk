import type { Signal, WorkDesk } from './types'

export function openSignals(desk: Pick<WorkDesk, 'signals'>): Signal[] {
  return desk.signals.filter((s) => !s.read)
}

export function oldestOpenSignal(desk: Pick<WorkDesk, 'signals'>): Signal | undefined {
  let oldest: Signal | undefined
  for (const s of openSignals(desk)) {
    if (!oldest || s.at < oldest.at) oldest = s
  }
  return oldest
}

export function addSignal(signals: Signal[], signal: Omit<Signal, 'read'>): Signal[] {
  return [...signals, { ...signal, read: false }]
}

export function markRead(signals: Signal[], id: string): Signal[] {
  return signals.map((s) => (s.id === id ? { ...s, read: true } : s))
}

/** Opening a WorkDesk clears every Signal that is not tied to a Pane. */
export function acknowledgeOnOpen(signals: Signal[]): Signal[] {
  return signals.map((s) => (s.paneId === undefined ? { ...s, read: true } : s))
}

/** A Pane Signal clears once its Pane has been visible and focused long enough. */
export function acknowledgePane(signals: Signal[], paneId: string): Signal[] {
  return signals.map((s) => (s.paneId === paneId ? { ...s, read: true } : s))
}
