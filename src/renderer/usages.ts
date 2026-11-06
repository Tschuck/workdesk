import type { UsageMatch } from '../main/files'
import { isIdentifier } from '../main/domain/symbols'
import { definitionPattern, definitionRank } from './definition'

/** One match with the file it is in, as the dialogs list it. */
export interface UsageRow {
  /** the file (absolute) and the folder it belongs to */
  abs: string
  rootPath: string
  rootLabel: string
  /** relative to the folder */
  file: string
  match: UsageMatch
  /** a declaration of the name (`class X`, `const X =`, `X=…`) */
  definition: boolean
}

export interface UsageFileInput {
  rootPath: string
  rootLabel: string
  path: string
  matches: UsageMatch[]
}

/** the name the cursor is in or touches (a letter, digit, `_` or `$` run), or nothing; `column` is a 0-based offset in the line */
export function wordAt(line: string, column: number): string {
  const isWord = (c: string | undefined): boolean => !!c && /^[\p{L}\p{N}\p{M}_$]$/u.test(c)
  let start = Math.min(Math.max(column, 0), line.length)
  let end = start
  while (start > 0 && isWord(line[start - 1])) start--
  while (end < line.length && isWord(line[end])) end++
  const word = line.slice(start, end)
  return isIdentifier(word) ? word : ''
}

/** the name to look for: the selection when it is one name, else the name under the cursor */
export function symbolFor(selected: string, line: string, column: number): string {
  const s = selected.trim()
  return s && isIdentifier(s) ? s : s ? '' : wordAt(line, column)
}

/** The rows of the files, definitions marked: the first match on a line that declares the name (see `definitionPattern`). */
export function toRows(word: string, files: UsageFileInput[]): UsageRow[] {
  const decl = new RegExp(definitionPattern(word))
  return files.flatMap((f) => {
    const firstOfLine = new Set<number>()
    return f.matches.map((m): UsageRow => {
      const first = !firstOfLine.has(m.line)
      firstOfLine.add(m.line)
      return { abs: `${f.rootPath}/${f.path}`, rootPath: f.rootPath, rootLabel: f.rootLabel, file: f.path, match: m, definition: first && !m.nonCode && decl.test(m.text) }
    })
  })
}

/** The definitions, declarations (`class X`) before values (`X=…`); equal ranks keep their order. */
export function definitionsOf(word: string, rows: UsageRow[]): UsageRow[] {
  return rows
    .map((r, i) => ({ r, i }))
    .filter((e) => e.r.definition)
    .sort((a, b) => definitionRank(word, a.r.match.text) - definitionRank(word, b.r.match.text) || a.i - b.i)
    .map((e) => e.r)
}

/** The rows of a file together, files in the order they first appear. */
export function groupRows(rows: UsageRow[]): { key: string; abs: string; rootLabel: string; file: string; rows: UsageRow[] }[] {
  const by = new Map<string, UsageRow[]>()
  for (const r of rows) {
    const list = by.get(r.abs) ?? []
    list.push(r)
    by.set(r.abs, list)
  }
  return [...by].map(([abs, list]) => ({ key: abs, abs, rootLabel: list[0].rootLabel, file: list[0].file, rows: list }))
}

/** The identity of a match, for ticking it. */
export const rowKey = (r: UsageRow): string => `${r.abs}:${r.match.line}:${r.match.column}`

/** Which matches are ticked to begin with: all, but those in comments and strings when they are to be skipped. */
export function initialTicks(rows: UsageRow[], skipNonCode: boolean): Set<string> {
  return new Set(rows.filter((r) => !(skipNonCode && r.match.nonCode)).map(rowKey))
}

/** The edits to send for the ticked matches, per file; files without a tick are left out. */
export function editsFor(rows: UsageRow[], ticked: ReadonlySet<string>, skipFiles: ReadonlySet<string> = new Set()): { path: string; edits: { line: number; column: number }[] }[] {
  const out = new Map<string, { line: number; column: number }[]>()
  for (const r of rows) {
    if (!ticked.has(rowKey(r)) || skipFiles.has(r.abs)) continue
    const list = out.get(r.abs) ?? []
    list.push({ line: r.match.line, column: r.match.column })
    out.set(r.abs, list)
  }
  return [...out].map(([path, edits]) => ({ path, edits }))
}
