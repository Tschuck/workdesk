import { describe, expect, it } from 'vitest'
import type { UsageMatch } from '../main/files'
import { definitionsOf, editsFor, groupRows, initialTicks, rowKey, symbolFor, toRows, wordAt } from './usages'

const m = (line: number, column: number, text: string, nonCode = false): UsageMatch => ({ line, column, length: 3, text, nonCode })
const file = (path: string, ...matches: UsageMatch[]) => ({ rootPath: '/r', rootLabel: 'r', path, matches })

describe('the word under the cursor', () => {
  it('is the run of word characters the cursor is in or touches', () => {
    expect(wordAt('const fooBar = 1', 8)).toBe('fooBar')
    expect(wordAt('const fooBar = 1', 6)).toBe('fooBar')
    expect(wordAt('const fooBar = 1', 12)).toBe('fooBar')
    expect(wordAt('a.größe()', 4)).toBe('größe')
    expect(wordAt('$el', 1)).toBe('$el')
  })
  it('is nothing on a space between words, in an empty line or on a number', () => {
    expect(wordAt('a   b', 2)).toBe('')
    expect(wordAt('', 0)).toBe('')
    expect(wordAt('x = 123', 5)).toBe('')
  })
  it('is the selection when that is one name; nothing for a selection that is not', () => {
    expect(symbolFor('foo', 'bar baz', 1)).toBe('foo')
    expect(symbolFor(' foo ', 'bar baz', 1)).toBe('foo')
    expect(symbolFor('foo bar', 'bar baz', 1)).toBe('')
    expect(symbolFor('', 'bar baz', 5)).toBe('baz')
  })
})

describe('definitions among the matches', () => {
  const rows = toRows('Foo', [
    file('a.ts', m(1, 6, 'class Foo extends Foo {}'), m(1, 20, 'class Foo extends Foo {}'), m(5, 4, 'new Foo()'), m(9, 3, '// class Foo', true)),
    file('b.ts', m(2, 13, 'export const Foo = 1'), m(3, 0, 'Foo=2'))
  ])
  it('marks the first match on a declaring line, not those in comments, not plain uses', () => {
    expect(rows.map((r) => r.definition)).toEqual([true, false, false, false, true, true])
  })
  it('lists declarations before values', () => {
    expect(definitionsOf('Foo', rows).map((r) => [r.file, r.match.line])).toEqual([['a.ts', 1], ['b.ts', 2], ['b.ts', 3]])
  })
  it('groups by file in order of appearance', () => {
    expect(groupRows(rows).map((g) => [g.file, g.rows.length])).toEqual([['a.ts', 4], ['b.ts', 2]])
  })
})

describe('ticks and edits', () => {
  const rows = toRows('foo', [file('a.ts', m(1, 0, 'foo'), m(2, 3, '// foo', true)), file('b.ts', m(1, 4, 'x = foo'))])
  it('start with everything, or without comments and strings', () => {
    expect(initialTicks(rows, false).size).toBe(3)
    expect([...initialTicks(rows, true)]).toEqual([rowKey(rows[0]), rowKey(rows[2])])
  })
  it('make edits per file for the ticked matches only', () => {
    expect(editsFor(rows, initialTicks(rows, true))).toEqual([
      { path: '/r/a.ts', edits: [{ line: 1, column: 0 }] },
      { path: '/r/b.ts', edits: [{ line: 1, column: 4 }] }
    ])
  })
  it('leave out files that are to be skipped, and files without a tick', () => {
    expect(editsFor(rows, initialTicks(rows, false), new Set(['/r/a.ts']))).toEqual([{ path: '/r/b.ts', edits: [{ line: 1, column: 4 }] }])
    expect(editsFor(rows, new Set())).toEqual([])
  })
})
