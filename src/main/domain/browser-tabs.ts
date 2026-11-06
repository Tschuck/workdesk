/** A web page Tab of the Browser page (outside any WorkDesk). */
export interface PageTab {
  id: string
  url: string
  title: string
  favicon?: string
  /** a name the user gave; it replaces the page title (empty: follow the title again) */
  name?: string
  /** pinned Tabs come first, show only their icon, and are listed under Browser in the left panel */
  pinned?: boolean
  /** the page is unloaded to free memory; the Tab keeps its address, title and icon, and loads again when it is opened */
  hibernated?: boolean
}

export interface PageTabs {
  tabs: PageTab[]
  active?: string
}

export const BLANK = 'about:blank'

/** Pinned Tabs first, otherwise in the order they were opened. */
export const ordered = (tabs: readonly PageTab[]): PageTab[] => [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)]

/** A new Tab, or the one that already shows the page. */
export function openTab(s: PageTabs, url: string, id: string): PageTabs {
  const known = url !== BLANK ? s.tabs.find((t) => t.url === url) : undefined
  if (known) return { tabs: s.tabs.map((t) => (t.id === known.id ? { ...t, hibernated: undefined } : t)), active: known.id }
  return { tabs: [...s.tabs, { id, url, title: '' }], active: id }
}

/** A copy of a Tab, right after it and shown: the same page, a name of its own if it had one; not pinned, not hibernated. */
export function duplicateTab(s: PageTabs, id: string, newId: string): PageTabs {
  const at = s.tabs.findIndex((t) => t.id === id)
  if (at < 0) return s
  const { pinned: _pinned, hibernated: _hibernated, ...rest } = s.tabs[at]
  const tabs = [...s.tabs]
  tabs.splice(at + 1, 0, { ...rest, id: newId })
  return { tabs, active: newId }
}

/** Pinned Tabs stay: they have to be unpinned first. */
export function closeTab(s: PageTabs, id: string): PageTabs {
  const shown = ordered(s.tabs)
  const i = shown.findIndex((t) => t.id === id)
  if (i < 0 || shown[i].pinned) return s
  const tabs = s.tabs.filter((t) => t.id !== id)
  const next = ordered(tabs)
  return { tabs, active: s.active === id ? next[Math.min(i, next.length - 1)]?.id : s.active }
}

/**
 * Put a Tab before or after another one. Pinned Tabs keep their own order (they come first), so a Tab can only be
 * moved within its group: a pinned one next to a pinned one, an open one next to an open one.
 */
export function moveTab(s: PageTabs, id: string, targetId: string, after: boolean): PageTabs {
  const moved = s.tabs.find((t) => t.id === id)
  const target = s.tabs.find((t) => t.id === targetId)
  if (!moved || !target || id === targetId || !!moved.pinned !== !!target.pinned) return s
  const rest = s.tabs.filter((t) => t.id !== id)
  const at = rest.findIndex((t) => t.id === targetId) + (after ? 1 : 0)
  return { ...s, tabs: [...rest.slice(0, at), moved, ...rest.slice(at)] }
}

/** The name shown for a Tab. */
export const tabLabel = (t: PageTab): string => t.name || t.title || (t.url === BLANK ? 'New tab' : t.url)

export const renameTab = (s: PageTabs, id: string, name: string): PageTabs => ({ ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, name: name.trim() || undefined } : t)) })

export const togglePin = (s: PageTabs, id: string): PageTabs => ({ ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)) })

/** Going to a Tab shows it; a hibernated one shows its wake-up screen and loads only when asked. */
export const activate = (s: PageTabs, id: string): PageTabs => (s.tabs.some((t) => t.id === id) ? { ...s, active: id } : s)

/** Unload the page of a Tab to free memory; the Tab stays. */
export const hibernate = (s: PageTabs, id: string): PageTabs => ({ ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, hibernated: true } : t)) })

export const wake = (s: PageTabs, id: string): PageTabs => ({ ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, hibernated: undefined } : t)) })

export const locate = (s: PageTabs, id: string, l: { url: string; title?: string; favicon?: string }): PageTabs => ({
  ...s,
  tabs: s.tabs.map((t) => (t.id === id ? { ...t, url: l.url, title: l.title ?? t.title, favicon: l.favicon } : t))
})

/** What was saved: anything unusable is left out. */
export function parsePageTabs(data: unknown): PageTabs {
  const j = (data ?? {}) as { tabs?: unknown; active?: unknown }
  const tabs = (Array.isArray(j.tabs) ? j.tabs : [])
    .filter((t): t is PageTab => !!t && typeof t.id === 'string' && typeof t.url === 'string')
    .map((t) => ({ id: t.id, url: t.url, title: String(t.title ?? ''), favicon: typeof t.favicon === 'string' ? t.favicon : undefined, name: typeof t.name === 'string' && t.name.trim() ? t.name.trim() : undefined, pinned: t.pinned === true || undefined, hibernated: t.hibernated === true || undefined }))
  return { tabs, active: tabs.some((t) => t.id === j.active) ? (j.active as string) : ordered(tabs)[0]?.id }
}
