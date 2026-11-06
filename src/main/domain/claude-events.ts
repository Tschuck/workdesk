import { addSignal, markRead } from './signal'
import type { Signal } from './types'

export type HookEventName = 'Notification' | 'Stop' | 'UserPromptSubmit' | 'SessionStart'

export const HOOK_EVENTS: readonly HookEventName[] = ['Notification', 'Stop', 'UserPromptSubmit', 'SessionStart']

/** What `workdesk hook <event>` sends to the app. */
export interface HookEvent {
  event: HookEventName
  sessionId: string
  cwd: string
  message?: string
  /** WorkDesk and Pane when Claude runs in one of the tool's tmux windows */
  tmuxSession?: string
  paneId?: string
  /** Claude config dir the hook ran under (for `--resume`) */
  configDir?: string
}

export function parseHookEvent(raw: unknown): HookEvent | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  if (!HOOK_EVENTS.includes(r.event as HookEventName)) return undefined
  if (typeof r.cwd !== 'string' || r.cwd === '') return undefined
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)
  return {
    event: r.event as HookEventName,
    sessionId: str(r.sessionId) ?? 'unknown',
    cwd: r.cwd,
    message: str(r.message),
    tmuxSession: str(r.tmuxSession),
    paneId: str(r.paneId),
    configDir: str(r.configDir)
  }
}

/** What Claude says when it has been idle for a while, also in a terminal that was only started: nothing waits for you there. */
const IDLE_REMINDER = /waiting for your input/i

/**
 * Update a WorkDesk's Signals for one Claude hook event:
 * - Notification: Claude needs input (not its idle reminder, which also comes when nothing was asked of it: a finished turn is the Stop)
 * - Stop: Claude finished (and no longer waits for input)
 * - UserPromptSubmit: Claude was answered, so its Signals no longer apply
 * - SessionStart: nothing to raise
 */
export function applyHookEvent(signals: Signal[], e: HookEvent, id: string, now: number, branchPath?: string): Signal[] {
  const sameSession = (s: Signal) => s.sessionId === e.sessionId && !s.read
  const clearing = (types: Signal['type'][]) =>
    signals.reduce((acc, s) => (sameSession(s) && types.includes(s.type) ? markRead(acc, s.id) : acc), signals)

  if (e.event === 'UserPromptSubmit') return clearing(['claude-needs-input', 'claude-finished'])
  if (e.event === 'SessionStart') return signals
  if (e.event === 'Notification' && IDLE_REMINDER.test(e.message ?? '')) return signals

  const type = e.event === 'Notification' ? 'claude-needs-input' : 'claude-finished'
  const base = e.event === 'Stop' ? clearing(['claude-needs-input']) : signals
  if (base.some((s) => sameSession(s) && s.type === type)) return base
  return addSignal(base, { id, type, at: now, paneId: e.paneId, sessionId: e.sessionId, branchPath, message: e.message })
}
