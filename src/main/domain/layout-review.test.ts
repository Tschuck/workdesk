import { describe, expect, it } from 'vitest'
import { arrangeReviewStart, closeTab, cycleTab, defaultLayout, moveTab, openReviewTab } from './layout'

describe('the Review Tab', () => {
  const base = () => {
    let l = defaultLayout('t1', 'p1', undefined, 'details')
    l = { ...l, tabs: [...l.tabs, { kind: 'panes', id: 't2', name: 'Browser 1', layout: { type: 'pane', id: 'p2', kind: 'browser', url: 'about:blank' } }] }
    return l
  }
  it('is made right after Details, once, and can be brought to the front', () => {
    const l = openReviewTab(base(), 'r', false)
    expect(l.tabs.map((t) => t.id)).toEqual(['details', 'r', 't1', 't2'])
    expect(l.activeTabId).toBe('details')
    const again = openReviewTab(l, 'other', true)
    expect(again.tabs).toHaveLength(4)
    expect(again.activeTabId).toBe('r')
  })
  it('can be moved to any place, is reached by Ctrl+Tab and can be closed', () => {
    const l = openReviewTab(base(), 'r', true)
    const moved = moveTab(l, 'r', 't2', true)
    expect(moved.tabs.map((t) => t.id)).toEqual(['details', 't1', 't2', 'r'])
    expect(cycleTab(moved.tabs, 't2', 1)).toBe('r')
    expect(closeTab(moved, 'r').tabs.map((t) => t.id)).toEqual(['details', 't1', 't2'])
  })
})

describe('how a Review WorkDesk starts', () => {
  const pr = 'https://github.com/o/r/pull/7'
  const start = () => {
    const l = defaultLayout('t1', 'p1', undefined, 'details')
    return { ...l, tabs: [...l.tabs, { kind: 'panes' as const, id: 'pr', name: 'PR', layout: { type: 'pane' as const, id: 'p2', kind: 'browser' as const, url: pr } }] }
  }
  it('puts the pull request first, then Review, then the terminal, with the pull request on screen', () => {
    const l = arrangeReviewStart(start(), [pr], 'r')
    expect(l.tabs.map((t) => t.id)).toEqual(['details', 'pr', 'r', 't1'])
    expect(l.activeTabId).toBe('pr')
  })
  it('moves an existing Review Tab into place instead of making a second one', () => {
    const l = arrangeReviewStart(openReviewTab(start(), 'old', false), [pr], 'new')
    expect(l.tabs.map((t) => t.id)).toEqual(['details', 'pr', 'old', 't1'])
  })
})
