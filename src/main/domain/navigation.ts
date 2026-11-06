import type { WorkDesk } from './types'

/** `⌘1…9`: the nth WorkDesk of the sidebar. */
export function deskAtShortcut(ordered: readonly WorkDesk[], n: number): WorkDesk | undefined {
  return n >= 1 && n <= 9 ? ordered[n - 1] : undefined
}

/**
 * While a drag is in progress the sidebar keeps the order it had at drag start, so rows do not
 * jump under the cursor when a Signal arrives. New WorkDesks are appended, removed ones dropped.
 */
export function freezeOrder<T extends { id: string }>(current: readonly T[], frozenIds: readonly string[] | null): T[] {
  if (!frozenIds) return [...current]
  const byId = new Map(current.map((d) => [d.id, d]))
  const kept = frozenIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
  return [...kept, ...current.filter((d) => !frozenIds.includes(d.id))]
}
