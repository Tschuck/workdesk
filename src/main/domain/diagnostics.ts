/** Problems of a TypeScript project, read from the output of `tsc --noEmit --pretty false`. */

export interface Problem {
  /** relative to the Branch folder */
  path: string
  line: number
  column: number
  code: string
  message: string
}

/** `src/a.ts(12,5): error TS2322: Type 'x' is not assignable…`; a following indented line continues the message. */
export function parseTsc(out: string): Problem[] {
  const problems: Problem[] = []
  for (const l of out.split('\n')) {
    const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(l.replace(/\r$/, ''))
    if (m) problems.push({ path: m[1].split('\\').join('/'), line: Number(m[2]), column: Number(m[3]), code: m[4], message: m[5] })
    else if (/^\s+\S/.test(l) && problems.length > 0) problems[problems.length - 1].message += ' ' + l.trim()
  }
  return problems
}

/** Problems per path: every file with some, and every folder above one (the sum of what is inside). The root is `''`. */
export function problemCounts(problems: readonly Problem[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of problems) {
    out[p.path] = (out[p.path] ?? 0) + 1
    const dirs = p.path.split('/').slice(0, -1)
    for (let i = 1; i <= dirs.length; i++) {
      const d = dirs.slice(0, i).join('/')
      out[d] = (out[d] ?? 0) + 1
    }
  }
  out[''] = problems.length
  return out
}
