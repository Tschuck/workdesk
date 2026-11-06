import { describe, expect, it } from 'vitest'
import { findLinks, linkAt, type TermRow } from './terminal-links'

const rows = (...t: string[]): TermRow[] => t.map((text) => ({ text }))

describe('findLinks', () => {
  it('finds a link in a row, without the punctuation after it', () => {
    const [l] = findLinks(rows('see https://github.com/a/b/pull/1.'), 80)
    expect(l.url).toBe('https://github.com/a/b/pull/1')
    expect(l.start).toEqual({ x: 5, y: 1 })
    expect(l.end).toEqual({ x: 33, y: 1 })
  })

  it('keeps a bracket that belongs to the link and drops one that does not', () => {
    expect(findLinks(rows('https://x.org/a_(b)'), 80)[0].url).toBe('https://x.org/a_(b)')
    expect(findLinks(rows('(see https://x.org/a)'), 80)[0].url).toBe('https://x.org/a')
  })

  it('joins a link that fills the row with the start of the next row', () => {
    const first = 'open https://github.com/acme/acme-api/pull/8'
    const [l] = findLinks(rows(first, '  05/files'), first.length + 1)
    expect(l.url).toBe('https://github.com/acme/acme-api/pull/805/files')
    expect(l.start).toEqual({ x: 6, y: 1 })
    expect(l.end).toEqual({ x: 10, y: 2 })
    expect(linkAt([l], 3, 2)).toBe(l)
    expect(linkAt([l], 11, 2)).toBeUndefined()
  })

  it('joins rows the terminal marks as wrapped', () => {
    const [l] = findLinks([{ text: 'https://example.com/aaaa' }, { text: 'bbbb', wrapped: true }], 80)
    expect(l.url).toBe('https://example.com/aaaabbbb')
  })

  it('does not join a row that is not full, or one that does not look like the rest of a link', () => {
    expect(findLinks(rows('https://example.com/a', 'b'), 80)[0].url).toBe('https://example.com/a')
    const full = 'https://example.com/a'
    expect(findLinks(rows(full, '  and more words'), full.length + 1)[0].url).toBe(full)
  })
})
