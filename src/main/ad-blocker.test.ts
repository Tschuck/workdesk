import { describe, expect, it } from 'vitest'
import { FiltersEngine } from '@ghostery/adblocker'
import { blockLevelForHost, blockLevelOf, cleanConfig, withSiteBlocking } from './domain/browser-sessions'
import { pageHostOf, shouldBlock } from './ad-blocker'

const engine = FiltersEngine.parse('||tracker.example^$third-party\n||ads.example^')

describe('shouldBlock', () => {
  it('cancels a request to a listed tracker', () => {
    expect(shouldBlock(engine, { url: 'https://tracker.example/p.js', resourceType: 'script', referrer: 'https://news.test/' })).toBe(true)
  })
  it('lets other requests through', () => {
    expect(shouldBlock(engine, { url: 'https://news.test/app.js', resourceType: 'script', referrer: 'https://news.test/' })).toBe(false)
  })
  it('never blocks the page itself, only what it loads', () => {
    expect(shouldBlock(engine, { url: 'https://ads.example/', resourceType: 'mainFrame' })).toBe(false)
  })
  it('leaves non-web requests and a missing engine alone', () => {
    expect(shouldBlock(engine, { url: 'devtools://x', resourceType: 'script' })).toBe(false)
    expect(shouldBlock(undefined, { url: 'https://ads.example/a.js', resourceType: 'script' })).toBe(false)
  })
})

describe('blocking level in the config', () => {
  it('is kept, and unknown values mean off', () => {
    expect(cleanConfig({ sessions: [], blocking: 'ads' }).blocking).toBe('ads')
    expect(blockLevelOf(cleanConfig({ sessions: [], blocking: 'everything' }))).toBe('off')
    expect(blockLevelOf(cleanConfig(null))).toBe('off')
  })
})

describe('blocking per site', () => {
  const config = cleanConfig({ sessions: [], blocking: 'ads', siteBlocking: { 'www.claude.ai': 'off', 'news.test': 'trackers', 'x.test': 'everything', '*.bad.test': 'off' } })
  it('keeps a site its own valid level, by its site', () => {
    expect(config.siteBlocking).toEqual({ 'claude.ai': 'off', 'news.test': 'trackers' })
  })
  it('uses the site level for its pages, else the one of all pages', () => {
    expect(blockLevelForHost(config, 'claude.ai')).toBe('off')
    expect(blockLevelForHost(config, 'api.claude.ai')).toBe('off')
    expect(blockLevelForHost(config, 'other.test')).toBe('ads')
    expect(blockLevelForHost(config, '')).toBe('ads')
  })
  it('is set and taken back again', () => {
    const one = withSiteBlocking(cleanConfig({ sessions: [] }), 'github.com', 'off')
    expect(one.siteBlocking).toEqual({ 'github.com': 'off' })
    expect(withSiteBlocking(one, 'github.com', undefined)).not.toHaveProperty('siteBlocking')
  })
  it('knows the page of a request by its web contents, else the referrer', () => {
    expect(pageHostOf({ url: 'https://cdn.test/a.js', webContents: { getURL: () => 'https://claude.ai/new' } })).toBe('claude.ai')
    expect(pageHostOf({ url: 'https://cdn.test/a.js', referrer: 'https://news.test/' })).toBe('news.test')
    expect(pageHostOf({ url: 'https://cdn.test/a.js' })).toBe('')
  })
})
