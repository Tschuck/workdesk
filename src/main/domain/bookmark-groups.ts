/** How the groups of the favorites are laid out: their order, and which ones are closed. */
export interface GroupSettings {
  /** groups in the order they are shown; '' is the ungrouped favorites. Groups not named come after, by name. */
  order: string[]
  /** new groups, and every group that was not toggled, start closed */
  collapseByDefault: boolean
  /** groups that are the other way round than the default (open when the default is closed, and the other way) */
  toggled: string[]
}

export const DEFAULT_GROUP_SETTINGS: GroupSettings = { order: [], collapseByDefault: false, toggled: [] }

const strings = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : [])

export function parseGroupSettings(data: unknown): GroupSettings {
  const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  return { order: strings(o.order), collapseByDefault: o.collapseByDefault === true, toggled: strings(o.toggled) }
}

/** The groups as they are shown: the ones in `order` first, the rest by name with the ungrouped ones last. */
export function orderGroups<T extends { group: string }>(sections: readonly T[], s: GroupSettings, key: (x: T) => string = (x) => x.group): T[] {
  const rank = (g: string): number => (s.order.includes(g) ? s.order.indexOf(g) : Infinity)
  return [...sections].sort((a, b) => {
    const [ga, gb] = [key(a), key(b)]
    const ra = rank(ga)
    const rb = rank(gb)
    if (ra !== rb) return ra < rb ? -1 : 1
    return ga === '' ? 1 : gb === '' ? -1 : ga.localeCompare(gb)
  })
}

export const isCollapsed = (s: GroupSettings, group: string): boolean => s.collapseByDefault !== s.toggled.includes(group)

export function toggleGroup(s: GroupSettings, group: string): GroupSettings {
  return { ...s, toggled: s.toggled.includes(group) ? s.toggled.filter((g) => g !== group) : [...s.toggled, group] }
}

/** A group got another name: its place in the order and its open / closed state go with it (merged into the group of that name when there is one). */
export function renameInSettings(s: GroupSettings, from: string, to: string): GroupSettings {
  const name = to.trim()
  const swap = (list: string[]): string[] => [...new Set(list.map((g) => (g === from ? name : g)))]
  return { ...s, order: swap(s.order), toggled: swap(s.toggled) }
}

/** Closes or opens every group, and makes that what new groups do. */
export const collapseAll = (s: GroupSettings, collapse: boolean): GroupSettings => ({ ...s, collapseByDefault: collapse, toggled: [] })

/** Puts `group` before (or after) `target` among the groups that are `shown` now; the order of the others is kept. */
export function moveGroup(s: GroupSettings, shown: readonly string[], group: string, target: string, after = false): GroupSettings {
  if (group === target) return s
  const rest = shown.filter((g) => g !== group)
  const at = rest.indexOf(target)
  if (at === -1) return s
  rest.splice(after ? at + 1 : at, 0, group)
  // groups that are not shown (filtered out by a search) keep their place after the shown ones
  return { ...s, order: [...rest, ...s.order.filter((g) => !rest.includes(g))] }
}
