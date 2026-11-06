import { describe, expect, it } from 'vitest'
import { addAccount, migrateAccounts } from './claude-accounts'
import { activityAfter, activityKey, agoLabel, buildOverview, type ClaudeActivity, type OverviewPane } from './claude-overview'
import type { DeskLayout } from './layout'
import type { WorkDesk } from './types'

const desk = (id: string, extra: Partial<WorkDesk> = {}): WorkDesk => ({ id, name: `Desk ${id}`, stage: 'implement', stageOverridden: false, priority: 0, presence: 'active', todoIds: [], branches: [], signals: [], createdAt: 0, ...extra })
const pane = (d: string, window: string, command = 'claude'): OverviewPane => ({ session: `workdesk-${d}`, window, command })
const accounts = addAccount(migrateAccounts({ configDir: '/priv' }), 'w1', 'Work', '/work')
const layout = (tabId: string, paneId: string): DeskLayout => ({ activeTabId: tabId, tabs: [{ kind: 'panes', id: tabId, name: 'Claude tab', layout: { type: 'pane', kind: 'terminal', id: paneId } as never }] })

describe('activityAfter', () => {
  it('follows the hook events', () => {
    expect(activityAfter({ event: 'UserPromptSubmit' }, 5).state).toBe('working')
    expect(activityAfter({ event: 'Notification', message: 'Allow?' }, 5)).toEqual({ state: 'waiting', at: 5, message: 'Allow?' })
    expect(activityAfter({ event: 'Stop' }, 5).state).toBe('finished')
    expect(activityAfter({ event: 'SessionStart' }, 5).state).toBe('idle')
  })
})

describe('buildOverview', () => {
  const base = {
    desks: [desk('a'), desk('b', { claudeAccountId: 'w1' }), desk('p', { presence: 'parked' }), desk('n', { presence: 'planned' })],
    panes: [pane('a', 'p1'), pane('a', 'p2', 'zsh'), pane('b', 'p3'), pane('p', 'p4'), pane('n', 'p5'), pane('b', 'p6', '2.1.4')],
    sessions: new Map(),
    activity: new Map<string, ClaudeActivity>(),
    layouts: new Map([['a', layout('t1', 'p1')]]),
    accounts
  }

  it('lists running Claude panes of desks in use only, with tab and account', () => {
    const rows = buildOverview(base)
    expect(rows.map((r) => r.paneId).sort()).toEqual(['p1', 'p3', 'p6'])
    const r = rows.find((x) => x.paneId === 'p1')!
    expect(r).toMatchObject({ deskName: 'Desk a', tabId: 't1', tabName: 'Claude tab', accountName: 'priv', state: 'idle' })
    expect(rows.find((x) => x.paneId === 'p3')).toMatchObject({ accountName: 'Work' })
  })

  it('takes the account from the session folder before the desk choice', () => {
    const rows = buildOverview({ ...base, sessions: new Map([['a', [{ sessionId: 's', paneId: 'p1', cwd: '/x', configDir: '/work' }]]]) })
    expect(rows.find((x) => x.paneId === 'p1')).toMatchObject({ accountId: 'w1', sessionId: 's' })
  })

  it('uses hook activity, else the open Signals, and puts what needs you first', () => {
    const activity = new Map<string, ClaudeActivity>([
      [activityKey('a', 'p1'), { state: 'working', at: 100 }],
      [activityKey('b', 'p6'), { state: 'waiting', at: 50, message: 'Allow Bash?' }]
    ])
    const desks = [base.desks[0], desk('b', { claudeAccountId: 'w1', signals: [{ id: 's', type: 'claude-finished', at: 70, paneId: 'p3', read: false }, { id: 'r', type: 'claude-needs-input', at: 1, paneId: 'p3', read: true }] }), ...base.desks.slice(2)]
    const rows = buildOverview({ ...base, desks, activity })
    expect(rows.map((r) => [r.paneId, r.state])).toEqual([['p6', 'waiting'], ['p3', 'finished'], ['p1', 'working']])
    expect(rows[0].message).toBe('Allow Bash?')
  })

  it('does not list a pane whose Claude ended, even with a remembered state', () => {
    const activity = new Map<string, ClaudeActivity>([[activityKey('a', 'p2'), { state: 'working', at: 1 }]])
    expect(buildOverview({ ...base, activity }).some((r) => r.paneId === 'p2')).toBe(false)
  })
})

describe('agoLabel', () => {
  it('reads like a person', () => {
    expect(agoLabel(undefined, 1)).toBe('—')
    expect(agoLabel(100_000, 110_000)).toBe('just now')
    expect(agoLabel(0, 5 * 60_000)).toBe('5 min ago')
    expect(agoLabel(0, 3 * 3_600_000)).toBe('3 h ago')
    expect(agoLabel(0, 2 * 86_400_000)).toBe('2 d ago')
  })
})
