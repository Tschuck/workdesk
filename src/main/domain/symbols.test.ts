import { describe, expect, it } from 'vitest'
import { applyReplacements, findWordMatches, isIdentifier, isWordChar, nonCodeRanges, wordLinePattern } from './symbols'

const at = (text: string, word: string) => findWordMatches(text, word).map((m) => [m.line, m.column])
const codeOnly = (text: string, word: string) => findWordMatches(text, word).filter((m) => !m.nonCode).map((m) => [m.line, m.column])

describe('identifiers and word characters', () => {
  it('accept names of any script, `_` and `$`', () => {
    for (const ok of ['foo', '_x', '$el', 'Foo9', 'größe', 'имя', '名前', 'a$b']) expect(isIdentifier(ok), ok).toBe(true)
  })
  it('refuse empty, leading digits, dashes, dots and spaces', () => {
    for (const no of ['', '9a', 'a-b', 'a.b', 'a b', ' a', 'a ', 'a;', '-']) expect(isIdentifier(no), no).toBe(false)
  })
  it('tell word characters', () => {
    expect(isWordChar('é')).toBe(true)
    expect(isWordChar('_')).toBe(true)
    expect(isWordChar('$')).toBe(true)
    expect(isWordChar('.')).toBe(false)
    expect(isWordChar(' ')).toBe(false)
  })
})

describe('the line pattern for git grep', () => {
  it('is a superset: it finds lines the exact cut may drop, never drops one the cut keeps', () => {
    const re = new RegExp(wordLinePattern('a.b'.replace('.', '')))
    expect(re.test('x ab y')).toBe(true)
    expect(re.test('xab')).toBe(false)
    expect(re.test('(ab)')).toBe(true)
    expect(re.test('éab')).toBe(true)
    expect(new RegExp(wordLinePattern('$el')).test('a.$el;')).toBe(true)
  })
})

describe('whole-word matches', () => {
  it('respect word borders', () => {
    expect(at('foo foobar barfoo foo_ _foo foo1 foo', 'foo')).toEqual([[1, 0], [1, 33]])
    expect(at('(foo)[foo].foo,foo;', 'foo')).toEqual([[1, 1], [1, 6], [1, 11], [1, 15]])
  })
  it('treat `$` as part of the word', () => {
    expect(at('$el el$ el', 'el')).toEqual([[1, 8]])
    expect(at('$el el$ el', '$el')).toEqual([[1, 0]])
  })
  it('know unicode letters', () => {
    expect(at('größe Größe größe2 xgröße größe', 'größe')).toEqual([[1, 0], [1, 26]])
    expect(at('имя имяимя имя', 'имя')).toEqual([[1, 0], [1, 11]])
    expect(at('名前 名前x 名前', '名前')).toEqual([[1, 0], [1, 7]])
  })
  it('count combining marks as part of the word', () => {
    expect(at('café cafe', 'cafe')).toEqual([[1, 6]])
  })
  it('give the UTF-16 column after an emoji', () => {
    expect(at('😀 foo', 'foo')).toEqual([[1, 3]])
  })
  it('match case-sensitively', () => {
    expect(at('Foo foo FOO', 'foo')).toEqual([[1, 4]])
  })
  it('find several matches per line and on several lines, never overlapping', () => {
    expect(at('a a a\na\n\na a', 'a')).toEqual([[1, 0], [1, 2], [1, 4], [2, 0], [4, 0], [4, 2]])
    expect(at('aa aaa aa', 'aa')).toEqual([[1, 0], [1, 7]])
    expect(at('a.a', 'a')).toEqual([[1, 0], [1, 2]])
  })
  it('count lines at \\n only and keep \\r out of the column', () => {
    expect(at('x\r\nfoo\r\n foo', 'foo')).toEqual([[2, 0], [3, 1]])
  })
  it('find nothing for a word that is not a name', () => {
    expect(at('a-b a.b', 'a-b')).toEqual([])
    expect(at('abc', '')).toEqual([])
  })
  it('take regular expression characters in the name literally', () => {
    expect(at('a$b axb $b', 'a$b')).toEqual([[1, 0]])
  })
})

describe('comments and strings (best effort)', () => {
  it('knows // and block comments', () => {
    const t = 'foo // foo\n/* foo\nfoo */ foo'
    expect(codeOnly(t, 'foo')).toEqual([[1, 0], [3, 7]])
    expect(at(t, 'foo').map((m) => m[0])).toEqual([1, 1, 2, 3, 3])
  })
  it('knows # and -- comments only as a comment start', () => {
    expect(codeOnly('foo # foo\nfoo\n  # foo', 'foo')).toEqual([[1, 0], [2, 0]])
    expect(codeOnly('foo -- foo', 'foo')).toEqual([[1, 0]])
    expect(codeOnly('#!/bin/sh foo\nfoo', 'foo')).toEqual([[2, 0]])
    // not comments: a colour, a decrement, a custom property, a hash inside a word
    expect(codeOnly('#foo', 'foo')).toEqual([[1, 1]])
    expect(codeOnly('foo--\nfoo --foo\na#foo', 'foo')).toEqual([[1, 0], [2, 0], [2, 6], [3, 2]])
  })
  it('knows quotes, with escapes, ending at the end of the line', () => {
    expect(codeOnly(`foo 'foo' "foo" foo`, 'foo')).toEqual([[1, 0], [1, 16]])
    expect(codeOnly(`'a\\'foo' foo`, 'foo')).toEqual([[1, 9]])
    expect(codeOnly(`"unclosed foo\nfoo`, 'foo')).toEqual([[2, 0]])
  })
  it('knows triple quotes over lines', () => {
    expect(codeOnly(`foo """\nfoo\n""" foo '''foo'''`, 'foo')).toEqual([[1, 0], [3, 4]])
  })
  it('knows a comment marker inside a string is no comment, and a quote inside a comment is no string', () => {
    expect(codeOnly(`"// not a comment" foo`, 'foo')).toEqual([[1, 19]])
    expect(codeOnly(`// don't\nfoo`, 'foo')).toEqual([[2, 0]])
    expect(codeOnly(`/* it's */ foo`, 'foo')).toEqual([[1, 11]])
  })
  it('knows template strings over lines, with code inside ${…}', () => {
    expect(codeOnly('`a foo ${foo + {x: foo}} foo\nfoo` foo', 'foo')).toEqual([[1, 9], [1, 19], [2, 5]])
  })
  it('knows HTML comments', () => {
    expect(codeOnly('<!-- foo -->foo', 'foo')).toEqual([[1, 12]])
  })
  it('ends an unclosed block comment at the end of the text', () => {
    expect(codeOnly('foo /* foo\nfoo', 'foo')).toEqual([[1, 0]])
  })
  it('has no ranges for plain code', () => {
    expect(nonCodeRanges('const a = b + c\n')).toEqual([])
  })
})

describe('applying replacements', () => {
  it('replaces by line and column', () => {
    const r = applyReplacements('foo(foo)\nx foo', 'foo', 'bar', [{ line: 1, column: 0 }, { line: 1, column: 4 }, { line: 2, column: 2 }])
    expect(r).toEqual({ text: 'bar(bar)\nx bar', applied: 3, stale: 0 })
  })
  it('does not shift later places when the new name has another length', () => {
    expect(applyReplacements('a a a a', 'a', 'longer', [{ line: 1, column: 0 }, { line: 1, column: 2 }, { line: 1, column: 4 }, { line: 1, column: 6 }]).text).toBe('longer longer longer longer')
    expect(applyReplacements('abc abc abc', 'abc', 'x', [{ line: 1, column: 8 }, { line: 1, column: 0 }, { line: 1, column: 4 }]).text).toBe('x x x')
  })
  it('replaces only the places listed', () => {
    expect(applyReplacements('foo foo foo', 'foo', 'bar', [{ line: 1, column: 4 }]).text).toBe('foo bar foo')
  })
  it('leaves a place alone, and counts it, when the word is not there any more', () => {
    const r = applyReplacements('foo\nfox', 'foo', 'bar', [{ line: 1, column: 0 }, { line: 2, column: 0 }, { line: 1, column: 1 }, { line: 5, column: 0 }, { line: 1, column: -1 }, { line: 0, column: 0 }])
    expect(r).toEqual({ text: 'bar\nfox', applied: 1, stale: 5 })
  })
  it('does not read past the end of a line', () => {
    expect(applyReplacements('fo\nof', 'foo', 'bar', [{ line: 1, column: 0 }]).applied).toBe(0)
  })
  it('applies a place listed twice once', () => {
    expect(applyReplacements('foo', 'foo', 'bar', [{ line: 1, column: 0 }, { line: 1, column: 0 }])).toEqual({ text: 'bar', applied: 1, stale: 0 })
  })
  it('keeps line endings and unicode around it', () => {
    expect(applyReplacements('😀 foo\r\nfoo é', 'foo', 'bär', [{ line: 1, column: 3 }, { line: 2, column: 0 }]).text).toBe('😀 bär\r\nbär é')
  })
  it('round-trips with the matches found', () => {
    const text = 'foo = foo + 1 // foo\nbar(foo)'
    const ms = findWordMatches(text, 'foo').filter((m) => !m.nonCode)
    expect(applyReplacements(text, 'foo', 'baz', ms).text).toBe('baz = baz + 1 // foo\nbar(baz)')
  })
  it('changes nothing without places', () => {
    expect(applyReplacements('foo', 'foo', 'bar', [])).toEqual({ text: 'foo', applied: 0, stale: 0 })
  })
})
