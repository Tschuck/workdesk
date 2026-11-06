import { describe, expect, it } from 'vitest'
import { hashText, isStale, makeState, MAX_AGE_MS, MAX_BUFFER, parseState, restorable } from './editor-state'

describe('hashText', () => {
  it('differs for different text and is stable', () => {
    expect(hashText('abc')).toBe(hashText('abc'))
    expect(hashText('abc')).not.toBe(hashText('abd'))
    expect(hashText('')).toBeTypeOf('number')
  })
})

describe('makeState / parseState', () => {
  it('round-trips with an unsaved buffer', () => {
    const s = makeState('/a.ts', { line: 3, column: 4 }, 120, { text: 'new', diskText: 'old' }, 1000)
    expect(s.buffer).toEqual({ text: 'new', base: hashText('old') })
    expect(parseState(JSON.stringify(s))).toEqual(s)
  })
  it('has no buffer when the text is the saved one, or too large', () => {
    expect(makeState('/a', { line: 1, column: 1 }, 0, { text: 'x', diskText: 'x' }).buffer).toBeUndefined()
    expect(makeState('/a', { line: 1, column: 1 }, 0, { text: 'x'.repeat(MAX_BUFFER + 1), diskText: '' }).buffer).toBeUndefined()
    expect(makeState('/a', { line: 1, column: 1 }, 0, undefined).buffer).toBeUndefined()
  })
  it('refuses nonsense', () => {
    expect(parseState(null)).toBeUndefined()
    expect(parseState('nope')).toBeUndefined()
    expect(parseState('{"path":1}')).toBeUndefined()
    expect(parseState('{"path":"/a","line":1.5,"column":1,"scrollTop":0}')).toBeUndefined()
  })
})

describe('restorable', () => {
  const s = makeState('/a.ts', { line: 9, column: 2 }, 50, { text: 'edited', diskText: 'disk' })
  it('puts back cursor, scroll and the unsaved text when the file is unchanged', () => {
    expect(restorable(s, '/a.ts', 'disk')).toEqual({ text: 'edited', line: 9, column: 2, scrollTop: 50 })
  })
  it('drops the unsaved text when the file changed on disk, keeps the position', () => {
    expect(restorable(s, '/a.ts', 'disk changed')).toEqual({ text: undefined, line: 9, column: 2, scrollTop: 50 })
  })
  it('restores nothing for another file or no state', () => {
    expect(restorable(s, '/b.ts', 'disk')).toBeUndefined()
    expect(restorable(undefined, '/a.ts', 'disk')).toBeUndefined()
  })
})

describe('isStale', () => {
  it('forgets panes untouched for a month', () => {
    const s = makeState('/a', { line: 1, column: 1 }, 0, undefined, 0)
    expect(isStale(s, MAX_AGE_MS - 1)).toBe(false)
    expect(isStale(s, MAX_AGE_MS + 1)).toBe(true)
  })
})
