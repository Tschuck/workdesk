import { describe, expect, it } from 'vitest'
import type { DeskLayout } from './domain/layout'
import { WorkspaceNav } from './workspace-nav'

const layout: DeskLayout = {
  activeTabId: 't1',
  tabs: [
    { kind: 'details', id: 'det', name: 'Details' },
    { kind: 'panes', id: 't1', name: 'Shell', layout: { type: 'pane', kind: 'terminal', id: 'p1' } }
  ]
}

function nav(over: { cwdOut?: string } = {}) {
  const outputs: Record<string, string> = { 'workdesk-d1:p1': 'ok\nERROR boom\n', 'workdesk-d2:p9': 'ERROR in parked', 'workdesk-view-d1-p1:p1': 'ERROR view' }
  return new WorkspaceNav({
    desks: () => [
      { id: 'd1', name: 'One', presence: 'active' },
      { id: 'd2', name: 'Two', presence: 'parked' }
    ],
    files: {
      roots: (id) => (id === 'd1' ? [{ label: 'p/feat', path: '/w/d1/p' }, { label: 'knowledge', path: '/k', plain: true }] : []),
      list: async () => ['a.ts', 'b.ts'],
      search: async (_d, root) => (root === '/w/d1/p' ? [{ path: 'a.ts', line: 3, text: 'needle' }] : [])
    },
    layout: async () => layout,
    tmux: {
      allPaneCwds: async () => over.cwdOut ?? 'workdesk-d1\tp1\t/w/d1/p/src',
      capture: async (s, w) => outputs[`${s}:${w}`] ?? '',
      panes: async () => [
        { session: 'workdesk-d1', command: 'zsh', window: 'p1' },
        { session: 'workdesk-view-d1-p1', command: 'zsh', window: 'p1' },
        { session: 'workdesk-d2', command: 'zsh', window: 'p9' }
      ]
    }
  })
}

describe('WorkspaceNav', () => {
  it('lists files of started desks only, without the shared roots', async () => {
    const f = await nav().files()
    expect(f).toEqual([{ deskId: 'd1', deskName: 'One', roots: [{ label: 'p/feat', path: '/w/d1/p', files: ['a.ts', 'b.ts'] }] }])
  })
  it('greps every started desk and labels the hits', async () => {
    const hits = await nav().grep({ text: 'needle', regex: false, caseSensitive: false, glob: '' })
    expect(hits).toEqual([{ kind: 'text', deskId: 'd1', deskName: 'One', rootPath: '/w/d1/p', rootLabel: 'p/feat', path: 'a.ts', line: 3, text: 'needle' }])
    expect(await nav().grep({ text: ' ', regex: false, caseSensitive: false, glob: '' })).toEqual([])
  })
  it('searches the output of terminals of started desks, not views or parked desks', async () => {
    const hits = await nav().terminals({ text: 'error' })
    expect(hits).toEqual([{ kind: 'terminal', deskId: 'd1', deskName: 'One', paneId: 'p1', tabId: 't1', tabName: 'Shell', line: 2, text: 'ERROR boom' }])
  })
  it('reports a changed folder once', async () => {
    const n = nav()
    expect((await n.pollCwds()).changed).toBe(true)
    expect(await n.pollCwds()).toEqual({ cwds: { d1: { p1: '/w/d1/p/src' } }, changed: false })
  })
})
