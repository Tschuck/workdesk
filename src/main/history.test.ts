import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { historyKey, isHistoryUrl, MAX_HISTORY, recordTitle, recordVisit, searchHistory, type HistoryEntry } from './domain/history'
import { HistoryService } from './history'

const DAY = 86_400_000
const NOW = 1_800_000_000_000

describe('history of visited pages', () => {
  it('keeps only pages of the web, and one entry for a page whatever a fragment or slash says', () => {
    expect(isHistoryUrl('https://a.test/x')).toBe(true)
    expect(isHistoryUrl('about:blank')).toBe(false)
    expect(isHistoryUrl('javascript:alert(1)')).toBe(false)
    expect(historyKey('https://a.test/x/#top')).toBe('https://a.test/x')
    expect(historyKey('https://a.test/')).toBe('https://a.test')
    const m = new Map<string, HistoryEntry>()
    recordVisit(m, 'https://a.test/x', 'A', NOW)
    recordVisit(m, 'https://a.test/x#part', undefined, NOW + 1)
    recordVisit(m, 'about:blank', 'x', NOW)
    expect([...m.values()]).toEqual([{ url: 'https://a.test/x', title: 'A', visits: 2, last: NOW + 1 }])
    recordTitle(m, 'https://a.test/x', ' New title ')
    expect(m.get('https://a.test/x')!.title).toBe('New title')
  })

  it('drops the least recently visited ones over the limit', () => {
    const m = new Map<string, HistoryEntry>()
    for (let i = 0; i <= MAX_HISTORY; i++) recordVisit(m, `https://a.test/${i}`, 'p', NOW + i)
    expect(m.size).toBeLessThan(MAX_HISTORY)
    expect(m.has('https://a.test/0')).toBe(false)
    expect(m.has(`https://a.test/${MAX_HISTORY}`)).toBe(true)
  })

  it('finds pages by every word of the title or the address, and ranks the often and recently visited ones up', () => {
    const e = (url: string, title: string, visits: number, daysAgo: number): HistoryEntry => ({ url, title, visits, last: NOW - daysAgo * DAY })
    const all = [
      e('https://wiki.test/portal-notes', 'Portal notes', 1, 90),
      e('https://portal.acme.test/demo', 'Acme Business Portal', 40, 1),
      e('https://news.test/crypto', 'Crypto news about a portal', 2, 3),
      e('https://mail.test', 'Mail', 500, 0)
    ]
    expect(searchHistory(all, 'portal', NOW).map((x) => x.url)).toEqual(['https://portal.acme.test/demo', 'https://news.test/crypto', 'https://wiki.test/portal-notes'])
    expect(searchHistory(all, 'acme portal', NOW).map((x) => x.url)).toEqual(['https://portal.acme.test/demo'])
    expect(searchHistory(all, 'MAIL.test', NOW).map((x) => x.url)).toEqual(['https://mail.test'])
    expect(searchHistory(all, '  ', NOW)).toEqual([])
    expect(searchHistory(all, 'portal', NOW, 1)).toHaveLength(1)
  })
})

describe('the history service', () => {
  let dir: string
  beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), 'workdesk-history-'))))
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('keeps visits across a restart, only while it is switched on, and forgets on clear', async () => {
    const file = join(dir, 'history.json')
    const h = new HistoryService(file, () => NOW, 10)
    await h.load()
    h.visit('https://a.test/x', 'Page A')
    h.visit('https://a.test/x', 'Page A')
    h.titled('https://a.test/x', 'Page A, renamed')
    h.enabled = () => false
    h.visit('https://private.test', 'Secret')
    expect(h.count()).toBe(1)
    await h.flush()
    const again = new HistoryService(file, () => NOW)
    await again.load()
    expect(again.search('page', 5)).toEqual([{ url: 'https://a.test/x', title: 'Page A, renamed', visits: 2, last: NOW }])
    await again.clear()
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ entries: [] })
    expect(again.count()).toBe(0)
  })
})

describe('history overview', () => {
  const e = (url: string, title: string, last: number): HistoryEntry => ({ url, title, visits: 1, last })
  it('lists the newest first and narrows by every word', async () => {
    const { listHistory } = await import('./domain/history')
    const all = [e('https://a.dev/x', 'Alpha', 1), e('https://b.dev/y', 'Beta docs', 3), e('https://c.dev/z', 'Gamma docs', 2)]
    expect(listHistory(all, '').map((x) => x.title)).toEqual(['Beta docs', 'Gamma docs', 'Alpha'])
    expect(listHistory(all, 'docs').map((x) => x.title)).toEqual(['Beta docs', 'Gamma docs'])
    expect(listHistory(all, 'docs gamma').map((x) => x.title)).toEqual(['Gamma docs'])
    expect(listHistory(all, '', 1)).toHaveLength(1)
  })
  it('forgets one page and labels the days', async () => {
    const { forgetVisit, dayLabel } = await import('./domain/history')
    const m = new Map<string, HistoryEntry>()
    recordVisit(m, 'https://a.dev/x#top', 'A', 1)
    expect(forgetVisit(m, 'https://a.dev/x')).toBe(true)
    expect(forgetVisit(m, 'https://a.dev/x')).toBe(false)
    const noon = new Date(2026, 10, 1, 12).getTime()
    expect(dayLabel(noon - 3_600_000, noon)).toBe('Today')
    expect(dayLabel(noon - 86_400_000, noon)).toBe('Yesterday')
  })
})

describe('forgetting history by day and age', () => {
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime()
  const make = (...lasts: number[]): Map<string, HistoryEntry> => {
    const m = new Map<string, HistoryEntry>()
    lasts.forEach((last, i) => m.set(`https://a.dev/${i}`, { url: `https://a.dev/${i}`, title: `p${i}`, visits: 1, last }))
    return m
  }
  it('forgets one day only', async () => {
    const { forgetDay, dayStart } = await import('./domain/history')
    const m = make(at(2026, 10, 1, 8), at(2026, 10, 1, 23), at(2026, 9, 31, 12))
    expect(forgetDay(m, dayStart(at(2026, 10, 1)))).toBe(2)
    expect([...m.values()].map((e) => e.title)).toEqual(['p2'])
  })
  it('forgets pages older than the kept days; 0 keeps everything', async () => {
    const { forgetOlderThan } = await import('./domain/history')
    const now = at(2026, 10, 10)
    const m = make(at(2026, 10, 10, 9), at(2026, 10, 4, 9), at(2026, 10, 3, 9), at(2026, 8, 1))
    expect(forgetOlderThan(m, 0, now)).toBe(0)
    // 7 days: today and the 6 days before stay (from the 4th on)
    expect(forgetOlderThan(m, 7, now)).toBe(2)
    expect([...m.values()].map((e) => e.title)).toEqual(['p0', 'p1'])
  })
})
