import { describe, expect, it } from 'vitest'
import { BUILTIN_PRESETS, filterByPreset, inPreset, makePreset, matchesPattern, presetsFor, withoutPreset, withPreset } from './review-presets'

describe('matchesPattern', () => {
  it('matches a pattern without a slash at any depth', () => {
    expect(matchesPattern('src/a/foo.test.ts', '*.test.*')).toBe(true)
    expect(matchesPattern('foo.test.ts', '*.test.*')).toBe(true)
    expect(matchesPattern('src/foo.ts', '*.test.*')).toBe(false)
  })

  it('anchors a pattern with a slash and lets ** cross folders', () => {
    expect(matchesPattern('src/api/a/b.ts', 'src/api/**')).toBe(true)
    expect(matchesPattern('lib/src/api/b.ts', 'src/api/**')).toBe(false)
    expect(matchesPattern('src/x/y/z.ts', 'src/**/z.ts')).toBe(true)
    expect(matchesPattern('src/z.ts', 'src/**/z.ts')).toBe(true)
  })

  it('takes a trailing slash as a folder anywhere', () => {
    expect(matchesPattern('pkg/test/a.ts', 'test/')).toBe(true)
    expect(matchesPattern('pkg/latest/a.ts', 'test/')).toBe(false)
    expect(matchesPattern('test', 'test/')).toBe(false)
  })
})

describe('inPreset', () => {
  it('lets everything through without rules', () => {
    expect(inPreset('a.ts', {})).toBe(true)
  })

  it('include or files narrow, exclude removes', () => {
    const p = { include: ['src/api/**'], files: ['README.md'], exclude: ['*.test.ts'] }
    expect(inPreset('src/api/a.ts', p)).toBe(true)
    expect(inPreset('src/api/a.test.ts', p)).toBe(false)
    expect(inPreset('README.md', p)).toBe(true)
    expect(inPreset('src/ui/a.ts', p)).toBe(false)
  })

  it('built-in "Without tests" drops tests and keeps the rest', () => {
    const noTests = BUILTIN_PRESETS.find((p) => p.id === 'without-tests')!
    const kept = filterByPreset(
      ['src/a.ts', 'src/a.spec.ts', 'src/__tests__/b.ts', 'tests/c.ts', 'src/a.snap', 'docs/x.md'].map((path) => ({ path })),
      noTests
    ).map((e) => e.path)
    expect(kept).toEqual(['src/a.ts', 'docs/x.md'])
  })
})

describe('presets', () => {
  it('needs a name and a rule, and not a built-in name', () => {
    expect(() => makePreset({ include: ['a'] })).toThrow('name')
    expect(() => makePreset({ name: 'X' })).toThrow('include or exclude')
    expect(() => makePreset({ name: 'Whole review', include: ['a'] })).toThrow('built-in')
  })

  it('is offered with the built-in ones, the shared ones and its own WorkDesk only', () => {
    const mine = makePreset({ name: 'API only', include: ['src/api/**'], deskId: 'd1' })
    const other = makePreset({ name: 'UI only', include: ['src/ui/**'], deskId: 'd2' })
    const shared = makePreset({ name: 'Docs', include: ['docs/**'] })
    expect(presetsFor([mine, other, shared], 'd1').map((p) => p.id)).toEqual(['whole-review', 'without-tests', 'docs', 'api-only'])
  })

  it('replaces by name and removes by id', () => {
    const a = makePreset({ name: 'A', include: ['x'], deskId: 'd' })
    const b = withPreset([a], makePreset({ name: 'A', include: ['y'], deskId: 'd' }))
    expect(b).toHaveLength(1)
    expect(b[0].include).toEqual(['y'])
    expect(withoutPreset(b, 'a', 'd')).toEqual([])
  })
})
