import { describe, expect, it } from 'vitest'
import { FiltersEngine } from '@ghostery/adblocker'
import { blockLevelOf, cleanConfig } from './domain/browser-sessions'
import { shouldBlock } from './ad-blocker'

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
