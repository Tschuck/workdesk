import { describe, expect, it } from 'vitest'
import { activate, closeTab, duplicateTab, hibernate, locate, moveTab, openTab, ordered, parsePageTabs, renameTab, tabLabel, togglePin, wake } from './domain/browser-tabs'

const start = { tabs: [], active: undefined }

describe('Browser page tabs', () => {
  it('opens a Tab, or goes to the one that shows the page; a blank one is always new', () => {
    let s = openTab(start, 'https://a.dev', 'a')
    s = openTab(s, 'about:blank', 'b')
    s = openTab(s, 'about:blank', 'c')
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(openTab(s, 'https://a.dev', 'x').active).toBe('a')
    expect(openTab(s, 'https://a.dev', 'x').tabs).toHaveLength(3)
  })

  it('puts pinned Tabs first and does not close them', () => {
    let s = openTab(openTab(openTab(start, 'https://a.dev', 'a'), 'https://b.dev', 'b'), 'https://c.dev', 'c')
    s = togglePin(s, 'c')
    expect(ordered(s.tabs).map((t) => t.id)).toEqual(['c', 'a', 'b'])
    expect(closeTab(s, 'c')).toBe(s)
    expect(closeTab(togglePin(s, 'c'), 'c').tabs.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('moves to the neighbour when the shown Tab closes', () => {
    let s = openTab(openTab(openTab(start, 'https://a.dev', 'a'), 'https://b.dev', 'b'), 'https://c.dev', 'c')
    s = activate(s, 'b')
    expect(closeTab(s, 'b').active).toBe('c')
    expect(closeTab(activate(s, 'c'), 'c').active).toBe('b')
    expect(closeTab(activate(s, 'a'), 'c').active).toBe('a')
    expect(closeTab(closeTab(closeTab(s, 'a'), 'b'), 'c')).toEqual({ tabs: [], active: undefined })
  })

  it('follows the page and keeps what it was told', () => {
    const s = locate(openTab(start, 'about:blank', 'a'), 'a', { url: 'https://a.dev/x', title: 'A', favicon: 'https://a.dev/i.png' })
    expect(s.tabs[0]).toMatchObject({ url: 'https://a.dev/x', title: 'A', favicon: 'https://a.dev/i.png' })
    expect(locate(s, 'a', { url: 'https://a.dev/y' }).tabs[0]).toMatchObject({ title: 'A', favicon: undefined })
  })

  it('reads only what is usable', () => {
    expect(parsePageTabs({ tabs: [{ id: 'a', url: 'https://a.dev', pinned: true }, { id: 3 }, null], active: 'zzz' })).toEqual({
      tabs: [{ id: 'a', url: 'https://a.dev', title: '', favicon: undefined, pinned: true }],
      active: 'a'
    })
    expect(parsePageTabs(undefined)).toEqual({ tabs: [], active: undefined })
  })
})

describe('hibernating a Tab', () => {
  it('keeps the Tab with its page; going to it leaves it asleep, opening its page again wakes it', () => {
    let s = openTab(openTab(start, 'https://a.dev', 'a'), 'https://b.dev', 'b')
    s = locate(s, 'a', { url: 'https://a.dev/x', title: 'A', favicon: 'https://a.dev/i.png' })
    s = hibernate(s, 'a')
    expect(s.tabs[0]).toMatchObject({ url: 'https://a.dev/x', title: 'A', favicon: 'https://a.dev/i.png', hibernated: true })
    expect(s.tabs[1].hibernated).toBeUndefined()
    expect(activate(s, 'a').tabs[0].hibernated).toBe(true)
    expect(activate(s, 'a').active).toBe('a')
    expect(openTab(s, 'https://a.dev/x', 'z').tabs[0].hibernated).toBeUndefined()
    expect(wake(s, 'a').tabs[0].hibernated).toBeUndefined()
    expect(activate(hibernate(s, 'b'), 'a').tabs[1].hibernated).toBe(true)
  })

  it('is saved and read back', () => {
    const s = hibernate(openTab(start, 'https://a.dev', 'a'), 'a')
    expect(parsePageTabs(JSON.parse(JSON.stringify(s))).tabs[0].hibernated).toBe(true)
    expect(parsePageTabs({ tabs: [{ id: 'a', url: 'https://a.dev', hibernated: 'yes' }] }).tabs[0].hibernated).toBeUndefined()
  })
})

describe('sorting Tabs', () => {
  const four = () => {
    let s = openTab(openTab(openTab(openTab(start, 'https://a.dev', 'a'), 'https://b.dev', 'b'), 'https://c.dev', 'c'), 'https://d.dev', 'd')
    s = togglePin(togglePin(togglePin(s, 'a'), 'b'), 'c')
    return s
  }
  const order = (s: ReturnType<typeof four>) => ordered(s.tabs).map((t) => t.id)

  it('moves a pinned Tab before or after another pinned Tab', () => {
    expect(order(four())).toEqual(['a', 'b', 'c', 'd'])
    expect(order(moveTab(four(), 'c', 'a', false))).toEqual(['c', 'a', 'b', 'd'])
    expect(order(moveTab(four(), 'a', 'c', true))).toEqual(['b', 'c', 'a', 'd'])
    expect(order(moveTab(four(), 'a', 'b', true))).toEqual(['b', 'a', 'c', 'd'])
  })

  it('keeps the groups: a pinned Tab cannot go among the open ones, nor the other way', () => {
    const s = four()
    expect(moveTab(s, 'a', 'd', false)).toBe(s)
    expect(moveTab(s, 'd', 'a', true)).toBe(s)
    expect(moveTab(s, 'a', 'a', true)).toBe(s)
    expect(moveTab(s, 'a', 'zzz', true)).toBe(s)
    let two = openTab(openTab(start, 'https://x.dev', 'x'), 'https://y.dev', 'y')
    two = moveTab(two, 'y', 'x', false)
    expect(order(two)).toEqual(['y', 'x'])
  })

  it('keeps the active Tab and the pages of the moved Tab', () => {
    const s = moveTab(activate(four(), 'b'), 'b', 'a', false)
    expect(s.active).toBe('b')
    expect(s.tabs.find((t) => t.id === 'b')).toMatchObject({ url: 'https://b.dev', pinned: true })
  })
})

describe('naming a Tab', () => {
  const s = { tabs: [{ id: 'a', url: 'https://a.test/', title: 'Page title' }], active: 'a' }
  it('shows the given name instead of the page title, and the title again when it is emptied', () => {
    const named = renameTab(s, 'a', '  Mail ')
    expect(tabLabel(named.tabs[0])).toBe('Mail')
    expect(tabLabel(renameTab(named, 'a', '').tabs[0])).toBe('Page title')
  })
  it('is kept when saved and read again', () => {
    expect(parsePageTabs(JSON.parse(JSON.stringify(renameTab(s, 'a', 'Mail')))).tabs[0].name).toBe('Mail')
  })
})

describe('duplicating a Tab', () => {
  it('copies the page right after the Tab and shows the copy, unpinned and awake', () => {
    const start = { tabs: [{ id: 'a', url: 'https://a.test', title: 'A', favicon: 'data:x', name: 'Mine', pinned: true, hibernated: true }, { id: 'b', url: 'https://b.test', title: 'B' }], active: 'b' }
    const next = duplicateTab(start, 'a', 'c')
    expect(next.tabs.map((t) => t.id)).toEqual(['a', 'c', 'b'])
    expect(next.tabs[1]).toEqual({ id: 'c', url: 'https://a.test', title: 'A', favicon: 'data:x', name: 'Mine' })
    expect(next.active).toBe('c')
    expect(duplicateTab(start, 'zzz', 'c')).toBe(start)
  })
})
