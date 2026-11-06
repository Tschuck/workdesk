/** What `git status --porcelain=v1 -z` says, as data the file tree and the git panel can use. */

export type ChangeKind = 'conflict' | 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'

export interface GitEntry {
  /** relative to the repository (Branch) folder, `/`-separated */
  path: string
  /** index (staged) column and work tree column of git's two-letter status; ' ' for nothing */
  x: string
  y: string
  /** where a rename or copy came from */
  from?: string
}

/** Git's `-z` output: `XY path NUL`, and for a rename or copy `XY to NUL from NUL`. */
export function parseStatus(out: string): GitEntry[] {
  const parts = out.split('\0')
  const entries: GitEntry[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.length < 4 || p[2] !== ' ') continue
    const x = p[0]
    const y = p[1]
    const entry: GitEntry = { path: p.slice(3), x, y }
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') entry.from = parts[++i]
    if (x === '!' && y === '!') continue
    entries.push(entry)
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path))
}

const CONFLICTS = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

export const isConflict = (e: GitEntry): boolean => CONFLICTS.has(e.x + e.y)
export const isUntracked = (e: GitEntry): boolean => e.x === '?' && e.y === '?'
/** has a change in the index */
export const isStaged = (e: GitEntry): boolean => !isUntracked(e) && !isConflict(e) && e.x !== ' '
/** has a change in the work tree that is not staged (untracked files count) */
export const isUnstaged = (e: GitEntry): boolean => isUntracked(e) || isConflict(e) || e.y !== ' '

function kindOf(c: string): ChangeKind {
  if (c === 'A') return 'added'
  if (c === 'D') return 'deleted'
  if (c === 'R' || c === 'C') return 'renamed'
  return 'modified'
}

/** What to show next to the file: the work tree's change wins over the index's, so a file you changed again shows as modified. */
export function entryKind(e: GitEntry): ChangeKind {
  if (isConflict(e)) return 'conflict'
  if (isUntracked(e)) return 'untracked'
  return kindOf(e.y !== ' ' ? e.y : e.x)
}

/** One letter for the tree, as in VS Code. */
export const KIND_LETTER: Record<ChangeKind, string> = { conflict: '!', modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U' }

/** How much a kind matters on a folder that holds several. */
const WEIGHT: Record<ChangeKind, number> = { conflict: 6, modified: 5, deleted: 4, renamed: 3, added: 2, untracked: 1 }

/** The marker per path: every changed file, and every folder above one (the most important kind inside it). The root is `''`. */
export function markers(entries: readonly GitEntry[]): Record<string, ChangeKind> {
  const out: Record<string, ChangeKind> = {}
  for (const e of entries) {
    const kind = entryKind(e)
    out[e.path] = kind
    const dirs = e.path.split('/').slice(0, -1)
    for (let i = 1; i <= dirs.length; i++) {
      const d = dirs.slice(0, i).join('/')
      if (!out[d] || WEIGHT[kind] > WEIGHT[out[d]]) out[d] = kind
    }
  }
  return out
}
