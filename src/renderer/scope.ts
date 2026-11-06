import { useSyncExternalStore } from 'react'
import type { FileRoot } from '../main/files'

/**
 * The scope of a WorkDesk with more than one branch: the folder of one branch that the tree, "Find a file", the search and "Go to
 * definition" look in, or all of them. The notes and the scratch folders are in every scope. Kept per WorkDesk on this machine.
 */
const key = (deskId: string) => `workdesk.scope.${deskId}`
const listeners = new Set<() => void>()
const chosen = new Map<string, string | undefined>()

/** the folders of the branches (the other roots are notes, scratch and shared folders) */
export const branchRoots = (roots: readonly FileRoot[]): FileRoot[] => roots.filter((r) => !r.scratch && !r.plain)

export function getScope(deskId: string): string | undefined {
  if (chosen.has(deskId)) return chosen.get(deskId)
  let v: string | undefined
  try {
    v = localStorage.getItem(key(deskId)) ?? undefined
  } catch {
    // nothing was kept
  }
  chosen.set(deskId, v)
  return v
}

/** Choose the folder of a branch (its path), or `undefined` for all of them. */
export function setScope(deskId: string, path: string | undefined): void {
  if (getScope(deskId) === path) return
  chosen.set(deskId, path)
  try {
    if (path) localStorage.setItem(key(deskId), path)
    else localStorage.removeItem(key(deskId))
  } catch {
    // remembering is a convenience only
  }
  listeners.forEach((l) => l())
}

export function useScope(deskId: string): string | undefined {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => getScope(deskId)
  )
}

/** The roots to look in: the branch of the scope with the notes and scratch folders; every root when there is no scope (or it is gone). */
export function scopedRoots(roots: FileRoot[], scope: string | undefined): FileRoot[] {
  const branches = branchRoots(roots)
  if (!scope || branches.length < 2 || !branches.some((r) => r.path === scope)) return roots
  return roots.filter((r) => r.scratch || r.plain || r.path === scope)
}

/** The branch a path (a file, or the folder a terminal starts in) belongs to, when the WorkDesk has several. */
export function branchOf(roots: FileRoot[], abs: string | undefined): FileRoot | undefined {
  const branches = branchRoots(roots)
  if (!abs || branches.length < 2) return undefined
  return branches.filter((r) => abs === r.path || abs.startsWith(r.path + '/')).sort((a, b) => b.path.length - a.path.length)[0]
}

const COLORS = ['var(--blue)', 'var(--orange)', 'var(--purple)', 'var(--green)', 'var(--red)']

/** How a branch is shown in a chip: its name without the project when the branches share one (cut at the front when long), and a colour of its own. */
export function branchChip(roots: FileRoot[], root: FileRoot): { text: string; title: string; color: string } {
  const branches = branchRoots(roots)
  const sameProject = new Set(branches.map((r) => r.label.split('/')[0])).size === 1
  const full = root.label
  let text = sameProject && full.includes('/') ? full.slice(full.indexOf('/') + 1) : full
  if (text.length > 16) text = '…' + text.slice(-15)
  return { text, title: full, color: COLORS[Math.max(0, branches.findIndex((r) => r.path === root.path)) % COLORS.length] }
}

/** The Tabs in the order of a list grouped by branch: what is not a Pane Tab and the pinned ones first, then each branch's, then the rest. */
export function groupedOrder<T extends { id: string; kind: string; pinned?: boolean }>(tabs: readonly T[], branchOfTab: (t: T) => string | undefined, branches: readonly string[]): T[] {
  const front = tabs.filter((t) => t.kind !== 'panes' || t.pinned)
  const rest = tabs.filter((t) => !front.includes(t))
  return [...front, ...branches.flatMap((b) => rest.filter((t) => branchOfTab(t) === b)), ...rest.filter((t) => !branches.includes(branchOfTab(t) ?? ''))]
}
