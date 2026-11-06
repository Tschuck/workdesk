/**
 * Review of a Branch against a base branch: the logic of the user's VS Code extension "Local Review" (tools/vscode-review/lib.js),
 * ported so that both tools read and write the same file: `.review/comments.json`
 * at the root of the checkout, with `/.review/` listed in the repository's info/exclude.
 */

export type ReviewStatus = 'A' | 'M' | 'D' | 'R' | 'U'

export interface ReviewEntry {
  status: ReviewStatus
  path: string
  oldPath?: string
}

/** One comment, exactly as the extension stores it (`line` is 1-based, in the working tree's file). */
export interface ReviewComment {
  id: string
  path: string
  line: number
  text: string
}

export const COMMENTS_DIR = '.review'
export const EXCLUDE_ENTRY = `/${COMMENTS_DIR}/`

const STATUSES = new Set(['A', 'M', 'D', 'R'])

/** Parses `git diff --name-status -z -M` output. Copies count as added, type changes as modified. */
export function parseNameStatus(out: string): ReviewEntry[] {
  const parts = out.split('\0')
  const entries: ReviewEntry[] = []
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++]
    if (!code) continue
    if (code[0] === 'R' || code[0] === 'C') {
      const oldPath = parts[i++]
      const path = parts[i++]
      entries.push(code[0] === 'R' ? { status: 'R', path, oldPath } : { status: 'A', path })
    } else {
      entries.push({ status: (STATUSES.has(code[0]) ? code[0] : 'M') as ReviewStatus, path: parts[i++] })
    }
  }
  return entries
}

/** `git ls-files --others --exclude-standard -z` */
export function parseUntracked(out: string): ReviewEntry[] {
  return out.split('\0').filter(Boolean).map((path) => ({ status: 'U' as const, path }))
}

export interface ReviewNode {
  path: string
  dirs: Map<string, ReviewNode>
  files: ReviewEntry[]
}

const newNode = (path = ''): ReviewNode => ({ path, dirs: new Map(), files: [] })

export function buildReviewTree(entries: readonly ReviewEntry[]): ReviewNode {
  const root = newNode()
  for (const entry of entries) {
    const parts = entry.path.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      let child = node.dirs.get(parts[i])
      if (!child) {
        child = newNode(parts.slice(0, i + 1).join('/'))
        node.dirs.set(parts[i], child)
      }
      node = child
    }
    node.files.push(entry)
  }
  return root
}

export type ReviewChild = { kind: 'dir'; label: string; path: string; node: ReviewNode } | { kind: 'file'; entry: ReviewEntry }

const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

/** Children of a tree node: directories first, single-child directory chains collapsed (`a/b/c`). */
export function childrenOf(node: ReviewNode): ReviewChild[] {
  const dirs = [...node.dirs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, child]): ReviewChild => {
      let label = name
      let leaf = child
      while (leaf.files.length === 0 && leaf.dirs.size === 1) {
        const [[key, next]] = leaf.dirs
        label += '/' + key
        leaf = next
      }
      return { kind: 'dir', label, path: leaf.path, node: leaf }
    })
  const files = [...node.files]
    .sort((a, b) => baseName(a.path).localeCompare(baseName(b.path)))
    .map((entry): ReviewChild => ({ kind: 'file', entry }))
  return [...dirs, ...files]
}

/** The generated `comments.md`, byte for byte as the extension writes it. */
/** A comment on the review as a whole, not on a file or a line. Kept in `.review/notes.json`, apart from the file the extension shares. */
export interface ReviewNote {
  id: string
  text: string
}

export function parseNotes(raw: string): ReviewNote[] {
  try {
    const data: unknown = JSON.parse(raw)
    return Array.isArray(data) ? data.filter((n): n is ReviewNote => !!n && typeof n.id === 'string' && typeof n.text === 'string') : []
  } catch {
    return []
  }
}

export const serializeNotes = (notes: readonly ReviewNote[]): string => JSON.stringify(notes, null, 2) + '\n'

export function renderMarkdown(comments: readonly ReviewComment[], base?: string, notes: readonly ReviewNote[] = []): string {
  const lines: string[] = []
  if (base) lines.push(`Base \`${base}\``, '')
  if (comments.length === 0 && notes.length === 0) {
    lines.push('_No open comments._', '')
    return lines.join('\n')
  }
  // the general comments first, then one heading per comment, `path:line`, with its text as written
  for (const n of notes) lines.push('## [ ] General', '', n.text.trimEnd(), '')
  const sorted = [...comments].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
  for (const c of sorted) lines.push(`## [ ] ${c.path}:${c.line}`, '', c.text.trimEnd(), '')
  return lines.join('\n')
}

/** The info/exclude content with `entry` appended, or null if it is already listed. */
export function withExcludeEntry(content: string, entry: string): string | null {
  if (content.split('\n').some((line) => line.trim() === entry)) return null
  const prefix = content && !content.endsWith('\n') ? content + '\n' : content
  return `${prefix}${entry}\n`
}

/** The contents of `comments.json`: anything but an array gives none; entries of another shape are left out (as the extension does). */
export function parseComments(json: string): ReviewComment[] {
  try {
    const data: unknown = JSON.parse(json)
    if (!Array.isArray(data)) return []
    return data.filter(
      (c): c is ReviewComment => !!c && typeof c.id === 'string' && typeof c.path === 'string' && Number.isInteger(c.line) && typeof c.text === 'string'
    )
  } catch {
    return []
  }
}

/** `comments.json` as the extension writes it: two-space indent and a final newline. */
export const serializeComments = (comments: readonly ReviewComment[]): string => JSON.stringify(comments, null, 2) + '\n'

/** comments per file path */
export function commentCounts(comments: readonly ReviewComment[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of comments) out[c.path] = (out[c.path] ?? 0) + 1
  return out
}

/** the base to start with when none was picked: origin's HEAD, else the first of these that exists */
export const BASE_CANDIDATES = ['origin/main', 'origin/master', 'main', 'master']

/** Branch names for the base picker from `for-each-ref --format=%(refname) refs/heads refs/remotes`: main/master first. */
export function baseChoices(refs: string): string[] {
  const rank = (n: string): number => (/^[^/]+\/(main|master)$/.test(n) ? 0 : /^(main|master)$/.test(n) ? 1 : 2)
  return refs
    .split('\n')
    .filter(Boolean)
    .map((ref) => ref.replace(/^refs\/(heads|remotes)\//, ''))
    .filter((name) => !name.endsWith('/HEAD'))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}
