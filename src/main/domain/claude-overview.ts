import type { ClaudeSession } from '../claude/sessions'
import { accountOfConfigDir, resolveAccount, type AccountsConfig } from './claude-accounts'
import type { HookEvent } from './claude-events'
import { paneIds, type DeskLayout } from './layout'
import { openSignals } from './signal'
import type { WorkDesk } from './types'

/** What a running Claude session is doing, as far as its hooks told. */
export type ClaudeState = 'working' | 'waiting' | 'finished' | 'idle'

export interface ClaudeActivity {
  state: ClaudeState
  /** epoch ms of the event that set it */
  at: number
  message?: string
}

/** The state after one hook event: a prompt starts work, a notification asks for you, a stop ends it. */
export function activityAfter(e: Pick<HookEvent, 'event' | 'message'>, now: number): ClaudeActivity {
  switch (e.event) {
    case 'UserPromptSubmit':
      return { state: 'working', at: now }
    case 'Notification':
      return { state: 'waiting', at: now, message: e.message }
    case 'Stop':
      return { state: 'finished', at: now, message: e.message }
    default:
      return { state: 'idle', at: now }
  }
}

export const activityKey = (deskId: string, paneId: string): string => `${deskId}:${paneId}`

const SHELLS = new Set(['zsh', 'bash', 'fish', 'sh', 'dash', 'ksh', 'tcsh', 'login', '-zsh', '-bash'])

/** `claude` is the program in the pane, or (the native installer) its version number. */
export const isClaudeCommand = (command: string): boolean => command === 'claude' || /^\d+\.\d+\.\d+/.test(command)

export interface OverviewPane {
  session: string
  command: string
  /** tmux window name = id of the Pane */
  window: string
}

export interface ClaudeRow {
  deskId: string
  deskName: string
  paneId: string
  tabId?: string
  tabName?: string
  sessionId?: string
  accountId: string
  accountName: string
  state: ClaudeState
  /** epoch ms of the last thing known about it; none when nothing was seen since the app started */
  since?: number
  /** what Claude said last (the question it waits with, or its closing message), if the hooks told */
  message?: string
}

export interface OverviewInput {
  desks: readonly WorkDesk[]
  panes: readonly OverviewPane[]
  sessions: ReadonlyMap<string, readonly ClaudeSession[]>
  activity: ReadonlyMap<string, ClaudeActivity>
  layouts: ReadonlyMap<string, DeskLayout>
  accounts: AccountsConfig
}

const ORDER: Record<ClaudeState, number> = { waiting: 0, finished: 1, working: 2, idle: 3 }

/**
 * Every Claude session running in a Pane of a WorkDesk that is in use (parked and planned WorkDesks run nothing and are
 * not listed). Those that need you come first, the longest waiting first. The Account is the one the session reported
 * through its hooks (its config folder), else the one of the WorkDesk.
 */
export function buildOverview(input: OverviewInput): ClaudeRow[] {
  const rows: ClaudeRow[] = []
  for (const desk of input.desks) {
    if (desk.presence === 'parked' || desk.presence === 'planned') continue
    const tabs = input.layouts.get(desk.id)?.tabs ?? []
    for (const p of input.panes) {
      if (p.session !== `workdesk-${desk.id}`) continue
      const act = input.activity.get(activityKey(desk.id, p.window))
      if (!isClaudeCommand(p.command) && !(act && p.command && !SHELLS.has(p.command))) continue
      const sess = input.sessions.get(desk.id)?.find((s) => s.paneId === p.window)
      const sig = openSignals(desk)
        .filter((s) => s.paneId === p.window && (s.type === 'claude-needs-input' || s.type === 'claude-finished'))
        .sort((a, b) => b.at - a.at)[0]
      const fromSignal: ClaudeActivity | undefined = sig ? { state: sig.type === 'claude-needs-input' ? 'waiting' : 'finished', at: sig.at, message: sig.message } : undefined
      const known: { state: ClaudeState; at?: number; message?: string } = act ?? fromSignal ?? { state: 'idle' }
      const account = (sess ? accountOfConfigDir(input.accounts, sess.configDir) : undefined) ?? resolveAccount(input.accounts, desk.claudeAccountId)
      const tab = tabs.find((t) => t.kind === 'panes' && paneIds(t.layout).includes(p.window))
      rows.push({
        deskId: desk.id,
        deskName: desk.name,
        paneId: p.window,
        tabId: tab?.id,
        tabName: tab?.name,
        sessionId: sess?.sessionId,
        accountId: account.id,
        accountName: account.name,
        state: known.state,
        since: known.at,
        message: known.message ?? fromSignal?.message
      })
    }
  }
  return rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.since ?? Infinity) - (b.since ?? Infinity) || a.deskName.localeCompare(b.deskName))
}

export const STATE_LABEL: Record<ClaudeState, string> = { working: 'working', waiting: 'waiting for you', finished: 'finished', idle: 'idle' }

/** "just now", "5 min ago", "2 h ago", "3 d ago". */
export function agoLabel(at: number | undefined, now: number): string {
  if (at === undefined) return '—'
  const min = Math.floor(Math.max(0, now - at) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`
  return `${Math.floor(min / 1440)} d ago`
}
