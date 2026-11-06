/**
 * Text-based symbol search and rename: whole-word matches of a name in a text, without a language server.
 * Everything here is pure (strings in, positions out). Lines are counted from 1 and split at `\n` only (as `git grep` does), columns are
 * UTF-16 offsets in the line from 0, so a match is found again by `line.slice(column, column + length)`.
 */

/** letters, digits, marks, `_` and `$` of any script belong to a word */
const WORD = '\\p{L}\\p{N}\\p{M}_$'
const WORD_CHAR = new RegExp(`^[${WORD}]$`, 'u')
const IDENTIFIER = new RegExp(`^[\\p{L}_$][${WORD}]*$`, 'u')

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A word character as `findWordMatches` sees it (a single character, or a surrogate pair). */
export const isWordChar = (ch: string): boolean => WORD_CHAR.test(ch)

/** Is this a name that can be renamed to or from: starts with a letter, `_` or `$`, then letters, digits, `_`, `$`. */
export const isIdentifier = (name: string): boolean => IDENTIFIER.test(name)

/**
 * A pattern for `git grep -E` (and for JavaScript) that finds every line that may hold the word. It only knows ASCII word characters, so
 * it finds a superset (a letter such as `é` next to the word counts as a border here); `findWordMatches` makes the exact cut afterwards.
 */
export function wordLinePattern(word: string): string {
  return `(^|[^A-Za-z0-9_$])${escapeRegExp(word)}($|[^A-Za-z0-9_$])`
}

export interface WordMatch {
  /** from 1 */
  line: number
  /** UTF-16 offset in the line, from 0 */
  column: number
  length: number
  /** the match lies in a comment or a string (a guess, see `nonCodeRanges`) */
  nonCode: boolean
}

/** The offsets at which the lines of a text start. */
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  return starts
}

/** The line (index into `starts`) that holds the offset. */
function lineAt(starts: number[], offset: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Where comments and strings are in a text, as `[start, end)` offsets in order. Best effort, the same for every language, and not a parser:
 * - `//` line comments, block comments (slash star), `<!-- … -->`
 * - `#` and `--` comments only after the start of a line or a space, and followed by a space or the end of the line (so `#fff`, `i--`, `--var` are code)
 * - strings in `'…'` and `"…"` (a backslash escapes; ends at the end of the line when not closed), `"""…"""` and `'''…'''`, and `` `…` `` across lines with `${…}` as code again
 * Not understood: regular expression literals with quotes, heredocs, an apostrophe in prose (the rest of that line counts as a string).
 */
export function nonCodeRanges(text: string): [number, number][] {
  const out: [number, number][] = []
  const n = text.length
  let i = 0
  let braces = 0
  /** brace depths at which a `${` of a template string was opened */
  const resume: number[] = []
  const push = (from: number, to: number): void => void out.push([from, to])
  const eol = (from: number): number => {
    const e = text.indexOf('\n', from)
    return e < 0 ? n : e
  }
  /** the text of a template string from `from` until its end or a `${`; returns where code goes on */
  const template = (from: number, start: number): number => {
    let j = from
    while (j < n) {
      const c = text[j]
      if (c === '\\') j += 2
      else if (c === '`') {
        push(start, j + 1)
        return j + 1
      } else if (c === '$' && text[j + 1] === '{') {
        push(start, j)
        resume.push(braces)
        braces++
        return j + 2
      } else j++
    }
    push(start, n)
    return n
  }
  const spaceBefore = (at: number): boolean => at === 0 || /\s/.test(text[at - 1])
  const spaceAfter = (at: number): boolean => at >= n || /\s/.test(text[at])

  while (i < n) {
    const c = text[i]
    const next = text[i + 1]
    if (c === '/' && next === '/') {
      const e = eol(i)
      push(i, e)
      i = e
    } else if (c === '/' && next === '*') {
      const e = text.indexOf('*/', i + 2)
      const to = e < 0 ? n : e + 2
      push(i, to)
      i = to
    } else if (c === '<' && text.startsWith('<!--', i)) {
      const e = text.indexOf('-->', i + 4)
      const to = e < 0 ? n : e + 3
      push(i, to)
      i = to
    } else if (c === '#' && spaceBefore(i) && (spaceAfter(i + 1) || next === '!')) {
      const e = eol(i)
      push(i, e)
      i = e
    } else if (c === '-' && next === '-' && spaceBefore(i) && spaceAfter(i + 2)) {
      const e = eol(i)
      push(i, e)
      i = e
    } else if ((c === '"' || c === "'") && text.startsWith(c.repeat(3), i)) {
      const e = text.indexOf(c.repeat(3), i + 3)
      const to = e < 0 ? n : e + 3
      push(i, to)
      i = to
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1
      const to = j < n && text[j] === c ? j + 1 : Math.min(j, n)
      push(i, to)
      i = to
    } else if (c === '`') {
      i = template(i + 1, i)
    } else if (c === '{') {
      braces++
      i++
    } else if (c === '}') {
      braces--
      if (resume.length > 0 && resume[resume.length - 1] === braces) {
        resume.pop()
        i = template(i + 1, i)
      } else i++
    } else i++
  }
  return out
}

/** Every whole-word match of `word` in the text (case matters), in order, each with whether it lies in a comment or string. */
export function findWordMatches(text: string, word: string): WordMatch[] {
  if (!isIdentifier(word)) return []
  const re = new RegExp(`(?<![${WORD}])${escapeRegExp(word)}(?![${WORD}])`, 'gu')
  const starts = lineStarts(text)
  const ranges = nonCodeRanges(text)
  const out: WordMatch[] = []
  let r = 0
  for (const m of text.matchAll(re)) {
    const at = m.index
    while (r < ranges.length && ranges[r][1] <= at) r++
    const line = lineAt(starts, at)
    out.push({ line: line + 1, column: at - starts[line], length: word.length, nonCode: r < ranges.length && ranges[r][0] <= at })
  }
  return out
}

export interface Edit {
  line: number
  column: number
}

export interface Replaced {
  text: string
  applied: number
  /** edits left alone because the old word was no longer at that place (the file changed since it was searched) */
  stale: number
}

/**
 * Puts `to` in place of `word` at the given places. Every place is looked up in the original text (so replacements of a different
 * length cannot shift each other), is checked to still hold `word`, and is applied once even if listed twice.
 */
export function applyReplacements(text: string, word: string, to: string, edits: readonly Edit[]): Replaced {
  const starts = lineStarts(text)
  const offsets = new Set<number>()
  let stale = 0
  for (const e of edits) {
    const lineStart = starts[e.line - 1]
    const lineEnd = e.line < starts.length ? starts[e.line] - 1 : text.length
    const at = lineStart === undefined ? -1 : lineStart + e.column
    if (lineStart === undefined || e.column < 0 || at + word.length > lineEnd || text.slice(at, at + word.length) !== word) stale++
    else offsets.add(at)
  }
  let out = ''
  let last = 0
  for (const at of [...offsets].sort((a, b) => a - b)) {
    out += text.slice(last, at) + to
    last = at + word.length
  }
  return { text: out + text.slice(last), applied: offsets.size, stale }
}
