import { describe, expect, it } from 'vitest'
import { parseTsc, problemCounts } from './diagnostics'

const OUT = [
  "src/a.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
  "src/sub/b.ts(3,1): error TS2304: Cannot find name 'x'.",
  "src/sub/b.ts(9,2): error TS2345: Argument of type 'A' is not assignable to parameter of type 'B'.",
  "  Types of property 'c' are incompatible.",
  'Found 3 errors in 2 files.'
].join('\n')

describe('parseTsc', () => {
  it('reads errors with their position and joins continuation lines', () => {
    const p = parseTsc(OUT)
    expect(p).toHaveLength(3)
    expect(p[0]).toEqual({ path: 'src/a.ts', line: 12, column: 5, code: 'TS2322', message: "Type 'string' is not assignable to type 'number'." })
    expect(p[2].message).toContain("Types of property 'c' are incompatible.")
  })
  it('is empty for clean output', () => {
    expect(parseTsc('')).toEqual([])
  })
})

describe('problemCounts', () => {
  it('sums up to the folders and the root', () => {
    expect(problemCounts(parseTsc(OUT))).toEqual({ 'src/a.ts': 1, 'src/sub/b.ts': 2, 'src/sub': 2, src: 3, '': 3 })
  })
})
