import { createElement, type ReactNode, useSyncExternalStore } from 'react'

export type TabsPosition = 'top' | 'left' | 'right'
/** The places that have tabs, each with its own setting: the Browser page, the WorkDesks and the Files page. */
export type TabsArea = 'browser' | 'desks' | 'files'

/** the one setting of the first version, which the others start from */
const OLD_KEY = 'workdesk.tabsLayout'
const keyOf = (area: TabsArea): string => `${OLD_KEY}.${area}`
const listeners = new Set<() => void>()

const valid = (v: string | null): TabsPosition | undefined => (v === 'left' || v === 'right' || v === 'top' ? v : v === 'side' ? 'left' : undefined)

function read(area: TabsArea): TabsPosition {
  try {
    return valid(localStorage.getItem(keyOf(area))) ?? valid(localStorage.getItem(OLD_KEY)) ?? 'top'
  } catch {
    return 'top'
  }
}

// the first version of this setting put these classes on the whole page; a page that was open while the code changed (a hot reload) may still wear them
document.documentElement.classList.remove('tabs-side', 'tabs-right')

const positions: Record<TabsArea, TabsPosition> = { browser: read('browser'), desks: read('desks'), files: read('files') }

/** Where the tabs of one area are: a row on top, or a list at the left or right of the content; kept per machine. */
export function setTabsPosition(area: TabsArea, next: TabsPosition): void {
  positions[area] = next
  try {
    localStorage.setItem(keyOf(area), next)
  } catch {
    // remembering is a convenience only
  }
  listeners.forEach((l) => l())
}

// a WorkDesk can have its own place for its tabs; without one it follows the setting for all WorkDesks (kept per machine too)
const DESK_KEY = `${OLD_KEY}.desk.`
const deskOverrides = new Map<string, TabsPosition>()
const deskOverride = (deskId: string): TabsPosition | undefined => {
  if (!deskOverrides.has(deskId)) {
    let v: TabsPosition | undefined
    try {
      v = valid(localStorage.getItem(DESK_KEY + deskId))
    } catch {
      v = undefined
    }
    if (v) deskOverrides.set(deskId, v)
  }
  return deskOverrides.get(deskId)
}

/** The tabs of one WorkDesk at a place of its own, or `undefined` to follow the setting of all WorkDesks. */
export function setDeskTabsPosition(deskId: string, next: TabsPosition | undefined): void {
  if (next) deskOverrides.set(deskId, next)
  else deskOverrides.delete(deskId)
  try {
    if (next) localStorage.setItem(DESK_KEY + deskId, next)
    else localStorage.removeItem(DESK_KEY + deskId)
  } catch {
    // remembering is a convenience only
  }
  listeners.forEach((l) => l())
}

export const useDeskTabsOverride = (deskId: string): TabsPosition | undefined =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => deskOverride(deskId)
  )

/** Where the tabs of this WorkDesk are: its own choice, else the setting of all WorkDesks. */
export const useDeskTabsPosition = (deskId: string): TabsPosition => {
  const all = useTabsPosition('desks')
  return useDeskTabsOverride(deskId) ?? all
}

export const tabsPosition = (area: TabsArea): TabsPosition => positions[area]
/** Are the tabs of this area a list at a side (not a row on top)? */
export const tabsSide = (area: TabsArea): boolean => positions[area] !== 'top'
/** The classes the page of an area wears, which the styles of the tab list hang on. */
export const tabsClass = (position: TabsPosition): string => (position === 'top' ? '' : position === 'right' ? 'tabs-side tabs-right' : 'tabs-side')

export const useTabsPosition = (area: TabsArea): TabsPosition =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => positions[area]
  )

/**
 * In a list of tabs, pinned ones are listed under a "Pinned" heading and the others under "Tabs" (once something is pinned).
 * `isPinned` and `isFixed` say which tabs are which (a fixed one, like Details, stays above both). The headings are not shown in a row on top.
 */
export function tabGroupHeader<T>(tabs: readonly T[], index: number, isPinned: (t: T) => boolean = (t) => !!(t as { pinned?: boolean }).pinned, isFixed: (t: T) => boolean = () => false): ReactNode {
  const t = tabs[index]
  if (isFixed(t) || !tabs.some((x) => !isFixed(x) && isPinned(x))) return null
  const prev = tabs.slice(0, index).filter((x) => !isFixed(x))
  const first = (pinned: boolean): boolean => isPinned(t) === pinned && !prev.some((x) => isPinned(x) === pinned)
  if (first(true)) return createElement('div', { className: 'tab-group', key: 'pinned' }, 'Pinned')
  if (first(false)) return createElement('div', { className: 'tab-group', key: 'others' }, 'Tabs')
  return null
}
