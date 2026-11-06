import { describe, expect, it } from 'vitest'
import { cleanConfig, describePartition, isPinnedSession, isKnownPartition, matchesDomain, normalizeDomain, partitionFor, partitionForUrl, partitionsFor, perDomainOf, resolvePartition, ROOT_PARTITION, sessionIdFor, sessionsFor, siteOf, sitePartition } from './domain/browser-sessions'

const config = cleanConfig({
  sessions: [
    { id: 'google', name: 'Google', domains: ['*.google.com', 'youtube.com'] },
    { id: 'github', name: 'GitHub', domains: ['github.com'] }
  ]
})

describe('browser sessions', () => {
  it('reads what was typed as a domain rule', () => {
    expect(normalizeDomain(' https://Calendar.Google.com/u/0?x=1 ')).toBe('calendar.google.com')
    expect(normalizeDomain('*.Google.com')).toBe('*.google.com')
    expect(normalizeDomain('localhost:3000')).toBe('localhost')
    for (const bad of ['', '*', 'a b', 'goo*gle.com', '*.', 'https://']) expect(normalizeDomain(bad)).toBeUndefined()
  })

  it('matches a bare domain exactly and a wildcard with everything below', () => {
    expect(matchesDomain('github.com', 'github.com')).toBe(true)
    expect(matchesDomain('github.com', 'gist.github.com')).toBe(false)
    expect(matchesDomain('*.google.com', 'mail.google.com')).toBe(true)
    expect(matchesDomain('*.google.com', 'google.com')).toBe(true)
    expect(matchesDomain('*.google.com', 'notgoogle.com')).toBe(false)
    expect(matchesDomain('*.google.com', 'google.com.evil.dev')).toBe(false)
  })

  it('puts a page in the session of its rule, everything else in one of its own site', () => {
    expect(sessionIdFor(config, 'https://mail.google.com/mail/u/0')).toBe('google')
    expect(sessionIdFor(config, 'https://github.com/a/b')).toBe('github')
    expect(sessionIdFor(config, 'https://www.github.com/')).toBeUndefined()
    expect(sessionIdFor(config, 'https://notion.so')).toBeUndefined()
    expect(sessionIdFor(config, 'about:blank')).toBeUndefined()
    expect(sessionIdFor(config, 'file:///etc/hosts')).toBeUndefined()
    expect(sessionIdFor(config, 'not a url')).toBeUndefined()
    expect(partitionForUrl(config, 'https://github.com')).toBe(partitionFor('github'))
    expect(partitionForUrl(config, 'https://notion.so')).toBe(sitePartition('notion.so'))
    expect(partitionForUrl(config, 'about:blank')).toBe(ROOT_PARTITION)
  })

  it('keeps every site apart by default, and shares one session when that is switched off', () => {
    const p = (url: string) => partitionForUrl(config, url)
    expect(p('https://app.notion.so/x')).toBe(p('https://www.notion.so/y'))
    expect(p('https://notion.so')).not.toBe(p('https://example.org'))
    expect(p('https://www.bbc.co.uk/news')).toBe(sitePartition('bbc.co.uk'))
    expect(p('http://localhost:3000')).toBe(sitePartition('localhost'))
    expect(siteOf('gist.github.com')).toBe('github.com')
    const off = cleanConfig({ ...config, perDomain: false })
    expect(off.perDomain).toBe(false)
    expect(partitionForUrl(off, 'https://notion.so')).toBe(ROOT_PARTITION)
    expect(partitionForUrl(off, 'https://github.com')).toBe(partitionFor('github'))
    expect(cleanConfig({ sessions: [], perDomain: true })).toEqual({ sessions: [] })
    expect(perDomainOf(undefined)).toBe(true)
  })

  it('lets only known partitions hold a page', () => {
    expect(isKnownPartition(config, ROOT_PARTITION)).toBe(true)
    expect(isKnownPartition(config, partitionFor('github'))).toBe(true)
    expect(isKnownPartition(config, partitionFor('other'))).toBe(false)
    expect(isKnownPartition(config, 'persist:evil')).toBe(false)
    expect(isKnownPartition(config, sitePartition('notion.so'))).toBe(true)
    expect(isKnownPartition(config, `${ROOT_PARTITION}@../x/y`)).toBe(false)
    expect(isKnownPartition(cleanConfig({ sessions: [], perDomain: false }), sitePartition('notion.so'))).toBe(false)
  })

  it('cleans what is saved', () => {
    const c = cleanConfig({
      sessions: [
        { name: 'Work Mail!', domains: ['Mail.Example.com', 'mail.example.com', 'bad domain', ' '] },
        { name: 'Work Mail!', domains: [] },
        { id: '../../etc', name: ' ', domains: 'x' },
        null
      ]
    })
    expect(c.sessions.map((s) => [s.id, s.name, s.domains])).toEqual([
      ['work-mail', 'Work Mail!', ['mail.example.com']],
      ['work-mail-2', 'Work Mail!', []],
      ['session', 'Session', []]
    ])
    expect(cleanConfig(undefined)).toEqual({ sessions: [] })
  })

  it('the first matching rule wins', () => {
    const c = cleanConfig({ sessions: [{ id: 'a', name: 'A', domains: ['*.example.com'] }, { id: 'b', name: 'B', domains: ['x.example.com'] }] })
    expect(sessionIdFor(c, 'https://x.example.com')).toBe('a')
  })
})

describe('a domain in several sessions', () => {
  const config = {
    sessions: [
      { id: 'private', name: 'Private', domains: ['claude.ai'] },
      { id: 'work', name: 'Work', domains: ['claude.ai', '*.corp.example'] }
    ]
  }
  it('lists every session that names the address, and none for other schemes', () => {
    expect(sessionsFor(config, 'https://claude.ai/chat').map((s) => s.id)).toEqual(['private', 'work'])
    expect(sessionsFor(config, 'https://wiki.corp.example/').map((s) => s.id)).toEqual(['work'])
    expect(sessionsFor(config, 'https://other.org/')).toEqual([])
    expect(sessionsFor(config, 'file:///a')).toEqual([])
  })
  it('asks when several name it and the page is in none of them, and keeps the page in one it is in', () => {
    expect(resolvePartition(config, 'https://claude.ai/', undefined)).toEqual({ ask: config.sessions })
    expect(resolvePartition(config, 'https://claude.ai/', partitionFor('other'))).toEqual({ ask: config.sessions })
    expect(resolvePartition(config, 'https://claude.ai/x', partitionFor('work'))).toEqual({ partition: partitionFor('work') })
    // one session, or none: no question
    expect(resolvePartition(config, 'https://wiki.corp.example/', undefined)).toEqual({ partition: partitionFor('work') })
    expect(resolvePartition(config, 'https://other.org/', undefined)).toEqual({ partition: sitePartition('other.org') })
  })
  it('lets a page stay in any session that names the address', () => {
    expect(partitionsFor(config, 'https://claude.ai/')).toEqual([partitionFor('private'), partitionFor('work')])
    expect(partitionsFor(config, 'https://other.org/')).toEqual([sitePartition('other.org')])
  })
  it('says which session a partition is', () => {
    expect(describePartition(config, partitionFor('work'))).toEqual({ name: 'Work', kind: 'session' })
    expect(describePartition(config, sitePartition('github.com'))).toEqual({ name: 'github.com', kind: 'site' })
    expect(describePartition(config, ROOT_PARTITION)).toEqual({ name: 'Shared', kind: 'shared' })
  })
  it('pins a page that is in one of several sessions of its domain, not one in a session that does not name it', () => {
    expect(isPinnedSession(config, 'https://claude.ai/new', (p) => p === partitionFor('private'))).toBe(true)
    expect(isPinnedSession(config, 'https://claude.ai/new', (p) => p === partitionFor('other'))).toBe(false)
    expect(isPinnedSession(config, 'https://wiki.corp.example/', (p) => p === partitionFor('work'))).toBe(false)
  })
})
