/** The id that stands for "no WorkDesk" where files are asked for: the Files page, whose roots are the Status Repo's. */
export const GLOBAL_DESK = '@global'

/** A tab of the Files page (outside any WorkDesk): one file, or none yet (the file tree). */
export interface FileTab {
  id: string
  path?: string
  /** a line to scroll to when it opens */
  line?: number
}

export interface FileTabs {
  tabs: FileTab[]
  active?: string
}

/** A new tab without a file, shown. */
export function newFileTab(s: FileTabs, id: string): FileTabs {
  return { tabs: [...s.tabs, { id }], active: id }
}

/** A file in a tab: the one that shows it already, or an empty tab that has no file yet, or a new one. */
export function openFile(s: FileTabs, path: string, id: string, line?: number): FileTabs {
  const known = s.tabs.find((t) => t.path === path)
  if (known) return { tabs: s.tabs.map((t) => (t === known ? withLine(t, line) : t)), active: known.id }
  const empty = s.tabs.find((t) => t.id === s.active && !t.path)
  if (empty) return { ...s, tabs: s.tabs.map((t) => (t === empty ? { id: t.id, path, ...(line ? { line } : {}) } : t)) }
  return { tabs: [...s.tabs, { id, path, ...(line ? { line } : {}) }], active: id }
}

const withLine = (t: FileTab, line?: number): FileTab => {
  const { line: _old, ...rest } = t
  return line ? { ...rest, line } : rest
}

/** The tab shows another file (or none), as the Tab's own navigation. */
export function setFilePath(s: FileTabs, id: string, path: string | undefined, line?: number): FileTabs {
  return { ...s, tabs: s.tabs.map((t) => (t.id === id ? { id, ...(path ? { path } : {}), ...(path && line ? { line } : {}) } : t)) }
}

export const activateFileTab = (s: FileTabs, id: string): FileTabs => (s.tabs.some((t) => t.id === id) ? { ...s, active: id } : s)

/** Closes a tab; the one next to it is shown. */
export function closeFileTab(s: FileTabs, id: string): FileTabs {
  const at = s.tabs.findIndex((t) => t.id === id)
  if (at < 0) return s
  const tabs = s.tabs.filter((t) => t.id !== id)
  const active = s.active === id ? tabs[Math.min(at, tabs.length - 1)]?.id : s.active
  return { tabs, ...(active ? { active } : {}) }
}

/** What was kept in the browser storage: anything unusable is left out. */
export function parseFileTabs(data: unknown): FileTabs {
  const o = (data && typeof data === 'object' ? data : {}) as { tabs?: unknown; active?: unknown }
  const tabs = (Array.isArray(o.tabs) ? o.tabs : [])
    .filter((t): t is FileTab => !!t && typeof t.id === 'string')
    .map((t) => ({ id: t.id, ...(typeof t.path === 'string' && t.path ? { path: t.path } : {}), ...(typeof t.line === 'number' ? { line: t.line } : {}) }))
  const active = typeof o.active === 'string' && tabs.some((t) => t.id === o.active) ? o.active : tabs[0]?.id
  return { tabs, ...(active ? { active } : {}) }
}
