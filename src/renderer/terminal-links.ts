/** Links in what a terminal shows. A link that is longer than the row goes on in the next one, which tmux draws as a row of its own. */

export interface TermRow {
  /** the row's text, without the spaces at its end */
  text: string
  /** the terminal itself marks the row as the continuation of the one above */
  wrapped?: boolean
}

export interface TermLink {
  url: string
  /** 1-based, as xterm.js: the cells from `start` to `end` (the last one included); `y` is the index into the rows given, plus 1 */
  start: { x: number; y: number }
  end: { x: number; y: number }
}

const URL = /https?:\/\/[^\s<>"'`]+/g
const URL_CHARS = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/
const lastToken = (s: string): string => s.split(/\s/).pop() ?? ''

/** Does row `next` carry on what row `prev` was cut off in: a full row that ends in a link, and a next row that is nothing but link characters. */
export function continues(prev: TermRow, next: TermRow, cols: number, chain: string): boolean {
  if (next.wrapped) return true
  if (prev.text.length < cols - 1 || !chain.includes('://')) return false
  // the rest of a link is alone in its row (a row with more words is a sentence that goes on)
  const token = next.text.trim()
  return token !== '' && URL_CHARS.test(token)
}

/** `https://a.b/c).` is `https://a.b/c`: closing brackets without an opening one and sentence punctuation are not part of it */
function trim(url: string): string {
  let out = url
  for (;;) {
    const last = out.slice(-1)
    if (/[.,;:!?]/.test(last)) out = out.slice(0, -1)
    else if (last === ')' && (out.match(/\(/g)?.length ?? 0) < (out.match(/\)/g)?.length ?? 0)) out = out.slice(0, -1)
    else if (last === ']' && (out.match(/\[/g)?.length ?? 0) < (out.match(/\]/g)?.length ?? 0)) out = out.slice(0, -1)
    else return out
  }
}

/** The links of these rows, each with the cells it covers (over several rows when it goes on). */
export function findLinks(rows: readonly TermRow[], cols: number): TermLink[] {
  const links: TermLink[] = []
  let i = 0
  while (i < rows.length) {
    // the rows that belong together: [row index, where its text starts in the row, the text]
    const parts: { row: number; from: number; text: string }[] = [{ row: i, from: 0, text: rows[i].text }]
    let logical = rows[i].text
    while (i + 1 < rows.length && continues(rows[i], rows[i + 1], cols, lastToken(logical))) {
      const text = rows[i + 1].text
      const from = rows[i + 1].wrapped ? 0 : text.length - text.trimStart().length
      parts.push({ row: i + 1, from, text: text.slice(from) })
      logical += text.slice(from)
      i++
    }
    i++
    const at = (index: number): { x: number; y: number } => {
      let offset = 0
      for (const p of parts) {
        if (index < offset + p.text.length) return { x: p.from + (index - offset) + 1, y: p.row + 1 }
        offset += p.text.length
      }
      const last = parts[parts.length - 1]
      return { x: last.from + last.text.length, y: last.row + 1 }
    }
    for (const m of logical.matchAll(URL)) {
      const url = trim(m[0])
      if (url.length <= 'https://'.length) continue
      links.push({ url, start: at(m.index), end: at(m.index + url.length - 1) })
    }
  }
  return links
}

/** The link that covers a cell (1-based `x`, `y` as in {@link TermLink}) */
export const linkAt = (links: readonly TermLink[], x: number, y: number): TermLink | undefined =>
  links.find((l) => (y > l.start.y || (y === l.start.y && x >= l.start.x)) && (y < l.end.y || (y === l.end.y && x <= l.end.x)))
