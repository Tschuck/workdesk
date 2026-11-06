import { describe, expect, it } from 'vitest'
import { branchPathOf, parsePaneCwds, samePaneCwds, tabBranchPath } from './follow-cd'
import { addSeconds, daySummary, dayKey, deskDays, formatDuration, isWorking, prune, tickSeconds } from './time-tracking'
import { matchLines, tabOfPane } from './search-all'
import type { DeskLayout } from './layout'

const A = '/w/desk/api-feat'
const B = '/w/desk/web-feat'

describe('follow cd', () => {
  it('finds the deepest branch a path is in, and not a sibling with the same prefix', () => {
    expect(branchPathOf([A, B], `${A}/src`)).toBe(A)
    expect(branchPathOf([A, `${A}/nested`], `${A}/nested/x`)).toBe(`${A}/nested`)
    expect(branchPathOf([A], `${A}-other/x`)).toBeUndefined()
    expect(branchPathOf([A], undefined)).toBeUndefined()
  })
  it('uses the live folder of a terminal over the one it started in', () => {
    const panes = [{ id: 't1', kind: 'terminal' as const, cwd: A }]
    expect(tabBranchPath({ roots: [A, B], panes, live: {} })).toBe(A)
    expect(tabBranchPath({ roots: [A, B], panes, live: { t1: `${B}/src` } })).toBe(B)
  })
  it('a Tab put under a branch by hand stays there, unless that branch is gone', () => {
    const panes = [{ id: 't1', kind: 'terminal' as const, cwd: A }]
    expect(tabBranchPath({ manual: B, roots: [A, B], panes, live: { t1: A } })).toBe(B)
    expect(tabBranchPath({ manual: '/gone', roots: [A, B], panes, live: { t1: A } })).toBe(A)
  })
  it('panes in different branches give no branch; browsers do not count', () => {
    const panes = [
      { id: 't1', kind: 'terminal' as const, cwd: A },
      { id: 'f1', kind: 'file' as const, path: `${B}/x.ts` },
      { id: 'b1', kind: 'browser' as const }
    ]
    expect(tabBranchPath({ roots: [A, B], panes, live: {} })).toBeUndefined()
    expect(tabBranchPath({ roots: [A, B], panes: [panes[0], panes[2]], live: {} })).toBe(A)
  })
  it('parses tmux output per WorkDesk and skips view sessions', () => {
    const out = ['workdesk-d1\tp1\t/a', 'workdesk-d1\tp2\t/b ', 'workdesk-view-p1\tp1\t/a', 'other\tw\t/c', 'workdesk-d2\tp3\t'].join('\n')
    expect(parsePaneCwds(out)).toEqual({ d1: { p1: '/a', p2: '/b' } })
  })
  it('compares folder maps', () => {
    expect(samePaneCwds({ d: { p: '/a' } }, { d: { p: '/a' } })).toBe(true)
    expect(samePaneCwds({ d: { p: '/a' } }, { d: { p: '/b' } })).toBe(false)
    expect(samePaneCwds({ d: { p: '/a' } }, {})).toBe(false)
  })
})

describe('time tracking', () => {
  const noon = new Date(2026, 5, 10, 12, 0, 0).getTime()
  it('counts only when a WorkDesk is shown and the user is not idle, whichever window is in front', () => {
    expect(isWorking({ shownDesk: 'd', idleSeconds: 10 })).toBe(true)
    expect(isWorking({ idleSeconds: 10 })).toBe(false)
    expect(isWorking({ shownDesk: 'd', idleSeconds: 301 })).toBe(false)
    expect(isWorking({ shownDesk: 'd', idleSeconds: 1, locked: true })).toBe(false)
  })
  it('does not count a long gap (sleep) between ticks', () => {
    expect(tickSeconds(undefined, noon)).toBe(0)
    expect(tickSeconds(noon - 15_000, noon)).toBe(15)
    expect(tickSeconds(noon - 3_600_000, noon)).toBe(0)
  })
  it('adds per day and desk and leaves the old log alone', () => {
    const log = {}
    const a = addSeconds(log, 'd1', noon, 30)
    const b = addSeconds(addSeconds(a, 'd1', noon, 30), 'd2', noon, 10)
    expect(log).toEqual({})
    expect(b[dayKey(noon)]).toEqual({ d1: 60, d2: 10 })
    expect(addSeconds(b, 'd1', noon, 0)).toBe(b)
  })
  it('summarises a day, longest first, keeping gone desks in the total only', () => {
    const log = { [dayKey(noon)]: { d1: 600, d2: 1800, gone: 60 } }
    const s = daySummary(log, dayKey(noon), { d1: 'One', d2: 'Two' })
    expect(s.total).toBe(2460)
    expect(s.entries.map((e) => e.name)).toEqual(['Two', 'One'])
    expect(daySummary(log, '2000-01-01', {}).total).toBe(0)
  })
  it('lists the last days of one desk and prunes old days', () => {
    const log = { [dayKey(noon)]: { d1: 5 }, [dayKey(noon - 86_400_000)]: { d1: 7 }, '2020-01-01': { d1: 9 } }
    expect(deskDays(log, 'd1', noon, 3).map((d) => d.seconds)).toEqual([5, 7, 0])
    expect(Object.keys(prune(log, noon))).toHaveLength(2)
  })
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(30)).toBe('< 1 min')
    expect(formatDuration(12 * 60 + 5)).toBe('12 min')
    expect(formatDuration(65 * 60)).toBe('1 h 05 min')
  })
})

describe('search in terminal output', () => {
  const out = 'build started\nERROR: boom\n\nall good   \nerror again'
  it('matches case-insensitively by default, with line numbers', () => {
    expect(matchLines(out, { text: 'error' })).toEqual([
      { line: 2, text: 'ERROR: boom' },
      { line: 5, text: 'error again' }
    ])
  })
  it('can be case sensitive, regular and limited; a bad expression matches nothing', () => {
    expect(matchLines(out, { text: 'error', caseSensitive: true })).toHaveLength(1)
    expect(matchLines(out, { text: '^all', regex: true })).toEqual([{ line: 4, text: 'all good' }])
    expect(matchLines(out, { text: '(', regex: true })).toEqual([])
    expect(matchLines(out, { text: 'e' }, 2)).toHaveLength(2)
    expect(matchLines(out, { text: '' })).toEqual([])
  })
  it('finds the Tab of a Pane', () => {
    const layout: DeskLayout = {
      activeTabId: 't1',
      tabs: [
        { kind: 'details', id: 'det', name: 'Details' },
        { kind: 'panes', id: 't1', name: 'Shell', layout: { type: 'pane', kind: 'terminal', id: 'p1' } as never }
      ]
    }
    expect(tabOfPane(layout, 'p1')).toEqual({ tabId: 't1', name: 'Shell' })
    expect(tabOfPane(layout, 'nope')).toBeUndefined()
  })
})
