/** The Tabs of a WorkDesk in the order they were used, last used first (Opt+Tab walks through it). */
export function touchRecent(recent: readonly string[], activeId: string, existing: readonly string[]): string[] {
  return [activeId, ...recent.filter((id) => id !== activeId)].filter((id) => existing.includes(id))
}

/**
 * Opt+Tab: while Option is held, each press goes one step further back in the order of use (Shift goes forward again);
 * `at` is where the walk is (0 is where it started). Undefined when there is nowhere to go.
 */
export function walkRecent(list: readonly string[], at: number, delta: 1 | -1): { at: number; id: string } | undefined {
  if (list.length < 2) return undefined
  const next = (at + delta + list.length) % list.length
  return { at: next, id: list[next] }
}
