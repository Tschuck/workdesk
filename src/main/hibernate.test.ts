import { describe, expect, it } from 'vitest'
import { buildsOnFirstShow, DEFAULT_AUTO_HIBERNATE, isExcluded, memoryLabel, pageUrls, parseAutoHibernate, parseExclude, tabsToHibernate, trackHidden } from './domain/hibernate'
import { setTabHibernated, type PaneTab, type Tab } from './domain/layout'

const page = (id: string, url: string, over: Partial<PaneTab> = {}): PaneTab => ({ kind: 'panes', id, name: id, layout: { type: 'pane', id: `p-${id}`, kind: 'browser', url }, ...over })
const term = (id: string): PaneTab => ({ kind: 'panes', id, name: id, layout: { type: 'pane', id: `p-${id}`, kind: 'terminal' } })
const MIN = 60_000
const on = { ...DEFAULT_AUTO_HIBERNATE, delayMinutes: 10 }

describe('Auto hibernate settings', () => {
  it('falls back to the defaults and clamps the delay', () => {
    expect(parseAutoHibernate(undefined)).toEqual({ ...DEFAULT_AUTO_HIBERNATE, exclude: [] })
    expect(parseAutoHibernate({ enabled: false, delayMinutes: 0 })).toMatchObject({ enabled: false, delayMinutes: 1 })
    expect(parseAutoHibernate({ delayMinutes: 99999 }).delayMinutes).toBe(24 * 60)
    expect(parseAutoHibernate({ delayMinutes: 'x' }).delayMinutes).toBe(DEFAULT_AUTO_HIBERNATE.delayMinutes)
  })

  it('reads the exclude list as bare hosts', () => {
    expect(parseExclude('Meet.Google.com\n https://app.slack.com/client/x , *.zoom.us\n\nmeet.google.com')).toEqual(['meet.google.com', 'app.slack.com', 'zoom.us'])
    expect(parseAutoHibernate({ exclude: ['https://a.dev/x', 4, ''] }).exclude).toEqual(['a.dev'])
  })

  it('excludes a host and its subdomains, not look-alikes', () => {
    expect(isExcluded('https://meet.google.com/abc', ['meet.google.com'])).toBe(true)
    expect(isExcluded('https://eu.zoom.us/j/1', ['zoom.us'])).toBe(true)
    expect(isExcluded('https://notzoom.us/', ['zoom.us'])).toBe(false)
    expect(isExcluded('about:blank', ['zoom.us'])).toBe(false)
  })
})

describe('Which Tabs to hibernate', () => {
  const tabs: Tab[] = [page('a', 'https://a.dev'), page('b', 'https://meet.google.com/x'), page('c', 'https://c.dev', { pinned: true }), term('t'), { kind: 'details', id: 'd', name: 'Details' }]
  const since = new Map(tabs.map((t) => [t.id, 0]))

  it('takes hidden Tabs with pages once the delay is over', () => {
    expect(tabsToHibernate(tabs, { since, now: 9 * MIN }, on)).toEqual([])
    expect(tabsToHibernate(tabs, { since, now: 10 * MIN }, { ...on, exclude: ['meet.google.com'] })).toEqual(['a'])
  })

  it('leaves out pinned Tabs, terminals, the shown Tab and Tabs that are busy', () => {
    const hidden = { since: new Map([['a', 0]]), now: 20 * MIN }
    expect(tabsToHibernate(tabs, hidden, on)).toEqual(['a'])
    expect(tabsToHibernate(tabs, hidden, on, (id) => id === 'a')).toEqual([])
    expect(tabsToHibernate(tabs, { since: new Map(), now: 20 * MIN }, on)).toEqual([])
  })

  it('does nothing when switched off, or for Tabs already unloaded', () => {
    const hidden = { since, now: 99 * MIN }
    expect(tabsToHibernate(tabs, hidden, { ...on, enabled: false })).toEqual([])
    const asleep = setTabHibernated({ tabs, activeTabId: 'd' }, 'a', true, true).tabs
    expect(tabsToHibernate(asleep, hidden, on)).toEqual(['b'])
  })
})

describe('Tracking what is out of sight', () => {
  it('keeps the first time a Tab went away, forgets shown and closed Tabs', () => {
    const first = trackHidden(new Map(), ['a', 'b', 'c'], 'a', 100)
    expect([...first]).toEqual([['b', 100], ['c', 100]])
    const later = trackHidden(first, ['a', 'b'], 'b', 500)
    expect([...later]).toEqual([['a', 500]])
    // coming back and leaving again starts the clock again
    expect(trackHidden(later, ['a', 'b'], 'a', 900).get('b')).toBe(900)
  })
})

describe('Auto hibernated Tabs', () => {
  it('are marked as the app\'s doing and the mark goes with the wake-up', () => {
    const layout = { tabs: [page('a', 'https://a.dev')] as Tab[], activeTabId: 'a' }
    const asleep = setTabHibernated(layout, 'a', true, true)
    expect(asleep.tabs[0]).toMatchObject({ autoHibernated: true, layout: { hibernated: true, url: 'https://a.dev' } })
    // by hand it is not marked, so it waits for the Wake up button
    expect((setTabHibernated(layout, 'a', true).tabs[0] as PaneTab).autoHibernated).toBeUndefined()
    const woken = setTabHibernated(asleep, 'a', false).tabs[0] as PaneTab
    expect(woken.autoHibernated).toBeUndefined()
    expect(woken.layout).toMatchObject({ url: 'https://a.dev' })
  })

  it('lists the addresses of a Tab and which Tabs are built on first show', () => {
    expect(pageUrls(page('a', 'https://a.dev'))).toEqual(['https://a.dev'])
    expect(buildsOnFirstShow(page('a', 'https://a.dev'))).toBe(true)
    expect(buildsOnFirstShow(term('t'))).toBe(false)
    expect(buildsOnFirstShow({ kind: 'details', id: 'd', name: 'D' })).toBe(false)
    const mixed: PaneTab = { ...term('m'), layout: { type: 'split', direction: 'horizontal', children: [term('x').layout, page('y', 'https://y.dev').layout] } }
    expect(buildsOnFirstShow(mixed)).toBe(false)
  })

  it('writes memory for a tooltip', () => {
    expect(memoryLabel(79.6)).toBe('80 MB')
    expect(memoryLabel(1536)).toBe('1.5 GB')
  })
})
