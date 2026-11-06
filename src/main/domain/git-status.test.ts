import { describe, expect, it } from 'vitest'
import { entryKind, isStaged, isUnstaged, markers, parseStatus } from './git-status'

describe('parseStatus', () => {
  it('reads plain entries, sorted', () => {
    const out = ' M src/b.ts\0A  src/a.ts\0?? new.txt\0 D gone.md\0'
    expect(parseStatus(out)).toEqual([
      { path: 'gone.md', x: ' ', y: 'D' },
      { path: 'new.txt', x: '?', y: '?' },
      { path: 'src/a.ts', x: 'A', y: ' ' },
      { path: 'src/b.ts', x: ' ', y: 'M' }
    ])
  })
  it('takes the old name of a rename from the next field', () => {
    const out = 'R  new.ts\0old.ts\0 M other.ts\0'
    expect(parseStatus(out)).toEqual([
      { path: 'new.ts', x: 'R', y: ' ', from: 'old.ts' },
      { path: 'other.ts', x: ' ', y: 'M' }
    ])
  })
  it('keeps spaces in names and skips ignored entries and empty input', () => {
    expect(parseStatus(' M my file.ts\0!! dist\0')).toEqual([{ path: 'my file.ts', x: ' ', y: 'M' }])
    expect(parseStatus('')).toEqual([])
  })
})

describe('kinds', () => {
  it('maps the two columns', () => {
    const k = (x: string, y: string) => entryKind({ path: 'f', x, y })
    expect(k('?', '?')).toBe('untracked')
    expect(k('A', ' ')).toBe('added')
    expect(k(' ', 'D')).toBe('deleted')
    expect(k('D', ' ')).toBe('deleted')
    expect(k('R', ' ')).toBe('renamed')
    expect(k('M', 'M')).toBe('modified')
    expect(k('A', 'M')).toBe('modified')
    expect(k('U', 'U')).toBe('conflict')
    expect(k('A', 'A')).toBe('conflict')
  })
  it('tells staged from unstaged', () => {
    expect(isStaged({ path: 'f', x: 'M', y: ' ' })).toBe(true)
    expect(isUnstaged({ path: 'f', x: 'M', y: ' ' })).toBe(false)
    expect(isStaged({ path: 'f', x: 'M', y: 'M' })).toBe(true)
    expect(isUnstaged({ path: 'f', x: 'M', y: 'M' })).toBe(true)
    expect(isStaged({ path: 'f', x: '?', y: '?' })).toBe(false)
    expect(isUnstaged({ path: 'f', x: '?', y: '?' })).toBe(true)
    expect(isStaged({ path: 'f', x: 'U', y: 'U' })).toBe(false)
  })
})

describe('markers', () => {
  it('marks parent folders with the most important kind inside', () => {
    const m = markers(parseStatus('?? a/b/new.ts\0 M a/c.ts\0A  d/e.ts\0'))
    expect(m).toMatchObject({ 'a/b/new.ts': 'untracked', 'a/b': 'untracked', 'a/c.ts': 'modified', a: 'modified', 'd/e.ts': 'added', d: 'added' })
    expect(m['']).toBeUndefined()
  })
  it('is empty for a clean tree', () => {
    expect(markers([])).toEqual({})
  })
})
