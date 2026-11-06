import { describe, expect, it } from 'vitest'
import { addTab, defaultLayout, hasPages, isTabHibernated, newBrowserPane, newTerminalPane, paneIds, setActiveTab, setTabHibernated, type PaneTab } from './layout'

describe('hibernating the pages of a WorkDesk Tab', () => {
  const layout = () => {
    const l = defaultLayout('t1', 'p1', '/x', 'details')
    const browser: PaneTab = { kind: 'panes', id: 'b1', name: 'Docs', layout: { ...newBrowserPane('pb', 'https://a.dev/x'), title: 'A docs', favicon: 'https://a.dev/i.png' } }
    const mixed: PaneTab = {
      kind: 'panes',
      id: 'm1',
      name: 'Mixed',
      layout: { type: 'split', direction: 'horizontal', children: [newTerminalPane('pt', '/x'), newBrowserPane('pw', 'https://b.dev'), newBrowserPane('pw2', 'https://c.dev')] }
    }
    return addTab(addTab(l, browser), mixed)
  }

  it('unloads the pages and keeps their address, title and icon; terminals are not touched', () => {
    const l = setTabHibernated(layout(), 'm1', true)
    const tab = l.tabs.find((t) => t.id === 'm1') as PaneTab
    expect(tab.layout.type === 'split' && tab.layout.children.map((c) => (c.type === 'pane' ? [c.kind, (c as { hibernated?: boolean }).hibernated] : []))).toEqual([['terminal', undefined], ['browser', true], ['browser', true]])
    expect(isTabHibernated(tab)).toBe(true)
    const b = setTabHibernated(layout(), 'b1', true).tabs.find((t) => t.id === 'b1') as PaneTab
    expect(b.layout).toMatchObject({ url: 'https://a.dev/x', title: 'A docs', favicon: 'https://a.dev/i.png', hibernated: true })
    expect(paneIds(tab.layout, 'terminal')).toEqual(['pt'])
  })

  it('wakes them when asked; going to the Tab shows its wake-up screen and leaves it asleep', () => {
    let l = setTabHibernated(setTabHibernated(layout(), 'b1', true), 'm1', true)
    expect(setTabHibernated(l, 'b1', false).tabs.find((t) => t.id === 'b1')).toMatchObject({ layout: { hibernated: undefined } })
    l = setActiveTab(l, 'b1')
    expect(isTabHibernated(l.tabs.find((t) => t.id === 'b1')!)).toBe(true)
    expect(isTabHibernated(l.tabs.find((t) => t.id === 'm1')!)).toBe(true)
    expect(l.activeTabId).toBe('b1')
  })

  it('knows which Tabs have pages, and that a terminal-only Tab is never hibernated', () => {
    const l = layout()
    expect(l.tabs.map((t) => [t.id, hasPages(t)])).toEqual([['details', false], ['t1', false], ['b1', true], ['m1', true]])
    expect(isTabHibernated(setTabHibernated(l, 't1', true).tabs.find((t) => t.id === 't1')!)).toBe(false)
    expect(() => setTabHibernated(l, 'nope', true)).toThrow(/Unknown Tab/)
  })
})
