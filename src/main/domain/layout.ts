import { samePage } from './url'
export type SplitDirection = 'horizontal' | 'vertical'

export interface TerminalPaneNode {
  type: 'pane'
  id: string
  kind: 'terminal'
  /** working directory for a new Terminal */
  cwd?: string
}

export interface BrowserPaneNode {
  type: 'pane'
  id: string
  kind: 'browser'
  url: string
  title?: string
  /** the page's icon (an https or data URL), shown in the Tab */
  favicon?: string
  /** the page is unloaded to free memory; it keeps its address, title and icon and loads again when the Tab is opened */
  hibernated?: boolean
}

/** One file, shown in a light editor: a file of a Branch's folder or a scratch file. No path: the file tree to choose one from. */
export interface FilePaneNode {
  type: 'pane'
  id: string
  kind: 'file'
  /** absolute path of the file */
  path?: string
  /** a line to scroll to when it opens */
  line?: number
}

export type PaneNode = TerminalPaneNode | BrowserPaneNode | FilePaneNode

/** a new browser Pane starts on the favorites page */
export const DEFAULT_BROWSER_URL = 'about:blank'

export interface SplitNode {
  type: 'split'
  /** horizontal: children side by side, vertical: stacked */
  direction: SplitDirection
  children: LayoutNode[]
  /** the share of each child (they add up to 1), dragged by the user; none: all the same */
  sizes?: number[]
}

export type LayoutNode = PaneNode | SplitNode

export interface PaneTab {
  kind: 'panes'
  id: string
  name: string
  layout: LayoutNode
  /** the name follows the page title of the Tab's single Browser Pane, until the user renames the Tab */
  autoName?: boolean
  /** pinned Tabs come right after Details, show only their icon, cannot be closed by accident and are listed under their WorkDesk in the left panel */
  pinned?: boolean
  /** the group it is listed under in a list of tabs ("terminals", "prs", "research"); none: among the tabs without a group */
  group?: string
  /** the branch it is listed under in a list grouped by branch, put there by hand (the folder of the branch); none: where its files or its terminal are */
  branch?: string
  /** the pages were unloaded by the app after the Tab was out of sight for a while (not by hand): they load again by themselves when the Tab is shown */
  autoHibernated?: boolean
}

/** The WorkDesk's own page: name, Stage, Todos, Branches, park and clear. Always the first Tab. */
export interface DetailsTab {
  kind: 'details'
  id: string
  name: string
}

/** The review of the WorkDesk's branches (the files that changed, the diff, the comments): a Tab like the others, in any place among them. */
export interface ReviewTab {
  kind: 'review'
  id: string
  name: string
}

export type Tab = PaneTab | DetailsTab | ReviewTab

/** Tabs that are part of every WorkDesk: they cannot be closed or renamed. */
export const isFixedTab = (t: Tab): boolean => t.kind === 'details'

export interface DeskLayout {
  tabs: Tab[]
  activeTabId: string
}

export function newTerminalPane(id: string, cwd?: string): TerminalPaneNode {
  return { type: 'pane', id, kind: 'terminal', cwd }
}

export function newFilePane(id: string, path?: string, line?: number): FilePaneNode {
  return { type: 'pane', id, kind: 'file', ...(path ? { path } : {}), ...(line ? { line } : {}) }
}

/** Remember which file a File Pane shows, so it comes back after a restart. */
export function setFileLocation(node: LayoutNode, paneId: string, path: string | undefined, line?: number): LayoutNode {
  if (node.type === 'pane') {
    if (node.id !== paneId || node.kind !== 'file') return node
    const { path: _p, line: _l, ...rest } = node
    return { ...rest, ...(path ? { path } : {}), ...(line ? { line } : {}) }
  }
  return { ...node, children: node.children.map((c) => setFileLocation(c, paneId, path, line)) }
}

/** The file of the Tab, when it is a single File Pane. */
export const singleFilePath = (tab: { layout: LayoutNode }): string | undefined => (tab.layout.type === 'pane' && tab.layout.kind === 'file' ? tab.layout.path : undefined)

export function newBrowserPane(id: string, url: string = DEFAULT_BROWSER_URL): BrowserPaneNode {
  return { type: 'pane', id, kind: 'browser', url }
}

export function paneIds(node: LayoutNode, kind?: PaneNode['kind']): string[] {
  if (node.type === 'pane') return !kind || node.kind === kind ? [node.id] : []
  return node.children.flatMap((c) => paneIds(c, kind))
}

/** The Tab and Pane that show this page (a Pane in a split counts), if any. */
export function findBrowserPage(layout: DeskLayout, url: string): { tabId: string; paneId: string } | undefined {
  for (const t of layout.tabs) {
    if (t.kind !== 'panes') continue
    for (const id of paneIds(t.layout, 'browser')) {
      const p = findPane(t.layout, id)
      if (p?.kind === 'browser' && samePage(p.url, url)) return { tabId: t.id, paneId: id }
    }
  }
  return undefined
}

/** Remember where a Browser Pane is, so it comes back after a restart. */
export function setBrowserLocation(node: LayoutNode, paneId: string, url: string, title?: string, favicon?: string): LayoutNode {
  if (node.type === 'pane') {
    if (node.id !== paneId || node.kind !== 'browser') return node
    // a new icon replaces the old one; without one, the old one stays only while the page stays on the same site
    const keep = sameSite(node.url, url) ? node.favicon : undefined
    return { ...node, url, title: title ?? node.title, favicon: favicon ?? keep }
  }
  return { ...node, children: node.children.map((c) => setBrowserLocation(c, paneId, url, title, favicon)) }
}

function sameSite(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host
  } catch {
    return false
  }
}

/** The icon of the Tab's page, when it is a single Browser Pane. */
export function singleBrowserFavicon(tab: { layout: LayoutNode }): string | undefined {
  return tab.layout.type === 'pane' && tab.layout.kind === 'browser' ? tab.layout.favicon : undefined
}

/** Icons are shown as images: only https and data URLs, nothing else. */
export const isIconUrl = (u: unknown): u is string => typeof u === 'string' && /^(https:\/\/|data:image\/)/.test(u) && u.length < 20_000

export function findPane(node: LayoutNode, id: string): PaneNode | undefined {
  if (node.type === 'pane') return node.id === id ? node : undefined
  for (const child of node.children) {
    const found = findPane(child, id)
    if (found) return found
  }
  return undefined
}

/** Replace a Pane by a split holding it and the new Pane (after it, or before it: left / above); flattens same-direction splits. */
export function splitPane(node: LayoutNode, paneId: string, direction: SplitDirection, added: LayoutNode, before = false): LayoutNode {
  // a split going the same way as the one it joins is flattened into it
  const parts = added.type === 'split' && added.direction === direction ? added.children : [added]
  if (node.type === 'pane') {
    return node.id === paneId ? { type: 'split', direction, children: before ? [...parts, node] : [node, ...parts] } : node
  }
  const at = node.children.findIndex((c) => c.type === 'pane' && c.id === paneId)
  if (at !== -1 && node.direction === direction) {
    const children = [...node.children]
    children.splice(before ? at : at + 1, 0, ...parts)
    // the new Panes share the space of the one they were split from
    const sizes = node.sizes && splitSizes(node)
    if (!sizes) return { ...node, children }
    const share = Array<number>(parts.length + 1).fill(sizes[at] / (parts.length + 1))
    return { ...node, children, sizes: [...sizes.slice(0, at), ...share, ...sizes.slice(at + 1)] }
  }
  return { ...node, children: node.children.map((c) => splitPane(c, paneId, direction, added, before)) }
}

/**
 * A whole Tab is dropped on a Pane of another Tab: what the dropped Tab shows is put beside (or above) that Pane,
 * and the dropped Tab is gone. The Tab that was dropped on is shown.
 */
export function mergeTab(layout: DeskLayout, fromTabId: string, toTabId: string, paneId: string, direction: SplitDirection, before: boolean): DeskLayout {
  if (fromTabId === toTabId) return layout
  const from = layout.tabs.find((t): t is PaneTab => t.kind === 'panes' && t.id === fromTabId)
  const to = layout.tabs.find((t): t is PaneTab => t.kind === 'panes' && t.id === toTabId)
  if (!from || !to || !findPane(to.layout, paneId)) throw new Error('Cannot put that Tab there')
  const merged: PaneTab = { ...to, layout: splitPane(to.layout, paneId, direction, from.layout, before) }
  return { ...layout, tabs: layout.tabs.filter((t) => t.id !== fromTabId).map((t) => (t.id === toTabId ? merged : t)), activeTabId: toTabId }
}

/** Remove a Pane; a split left with one child collapses into it. Returns undefined when nothing is left. */
export function removePane(node: LayoutNode, paneId: string): LayoutNode | undefined {
  if (node.type === 'pane') return node.id === paneId ? undefined : node
  const sizes = node.sizes && splitSizes(node)
  const kept = node.children.map((c) => removePane(c, paneId))
  const children = kept.filter((c): c is LayoutNode => !!c)
  if (children.length === 0) return undefined
  if (children.length === 1) return children[0]
  // the others keep their shares among themselves
  return sizes ? { ...node, children, sizes: normalise(sizes.filter((_, i) => kept[i])) } : { ...node, children }
}

const normalise = (sizes: readonly number[]): number[] => {
  const sum = sizes.reduce((a, b) => a + b, 0)
  return sizes.map((s) => s / sum)
}

/** The share of each child of a split: what the user dragged, or all the same when that does not fit the children (any more). */
export function splitSizes(node: SplitNode): number[] {
  const { sizes, children } = node
  if (sizes && sizes.length === children.length && sizes.every((s) => Number.isFinite(s) && s > 0)) return normalise(sizes)
  return children.map(() => 1 / children.length)
}

/** Set the shares of the split at `at` (the index of each child on the way from the Tab's root; [] is the root itself). */
export function setSplitSizes(node: LayoutNode, at: readonly number[], sizes: readonly number[]): LayoutNode {
  if (node.type !== 'split') throw new Error('There is no split there')
  if (at.length > 0) {
    const [i, ...rest] = at
    if (!node.children[i]) throw new Error('There is no split there')
    return { ...node, children: node.children.map((c, j) => (j === i ? setSplitSizes(c, rest, sizes) : c)) }
  }
  if (sizes.length !== node.children.length || !sizes.every((s) => Number.isFinite(s) && s > 0)) throw new Error('The sizes do not fit the split')
  return { ...node, sizes: normalise(sizes) }
}

/** A new WorkDesk starts on its Details when it has them. */
export function defaultLayout(tabId: string, paneId: string, cwd?: string, detailsTabId?: string): DeskLayout {
  const tabs: Tab[] = [{ kind: 'panes', id: tabId, name: 'Terminal', layout: newTerminalPane(paneId, cwd) }]
  return withFixedTabs({ tabs, activeTabId: detailsTabId ?? tabId }, detailsTabId)
}

/**
 * Layouts saved while the Editor was a Tab lose it: VS Code is a window of its own, opened from a button.
 * Returns the same object when there is none.
 */
export function withoutEditorTabs(layout: DeskLayout): DeskLayout {
  const tabs = layout.tabs.filter((t) => (t as { kind: string }).kind !== 'editor')
  if (tabs.length === layout.tabs.length) return layout
  const activeTabId = tabs.some((t) => t.id === layout.activeTabId) ? layout.activeTabId : (tabs[0]?.id ?? layout.activeTabId)
  return { tabs, activeTabId }
}

/**
 * Layouts saved earlier get the Details Tab in front, and lose the Todos Tab: the work items are part of Details now.
 * Returns the same object when nothing is to be done.
 */
export function withFixedTabs(layout: DeskLayout, detailsId?: string): DeskLayout {
  // saved layouts can still hold the old Todos Tab
  let tabs = layout.tabs.filter((t) => (t as { kind: string }).kind !== 'todos')
  if (detailsId && !tabs.some((t) => t.kind === 'details')) tabs = [{ kind: 'details', id: detailsId, name: 'Details' }, ...tabs]
  if (tabs.length === layout.tabs.length && tabs.every((t, i) => t === layout.tabs[i])) return layout
  const first = tabs.find((t) => t.kind === 'details') ?? tabs[0]
  return { ...layout, tabs, activeTabId: tabs.some((t) => t.id === layout.activeTabId) ? layout.activeTabId : (first?.id ?? layout.activeTabId) }
}

export function paneTab(layout: DeskLayout, tabId: string): PaneTab | undefined {
  const tab = layout.tabs.find((t) => t.id === tabId)
  return tab?.kind === 'panes' ? tab : undefined
}

/**
 * Details first, then the pinned Tabs, then the Tabs without a group, then the groups (in the order their first Tab came), the Tabs
 * of a group together; everything else keeps its order.
 */
export function orderPins(tabs: readonly Tab[]): Tab[] {
  const pinned = (t: Tab): boolean => t.kind === 'panes' && !!t.pinned
  const groupOf = (t: Tab): string | undefined => (t.kind === 'panes' && !t.pinned ? t.group : undefined)
  const movable = tabs.filter((t) => !isFixedTab(t) && !pinned(t))
  const groups = [...new Set(movable.map(groupOf).filter((g): g is string => !!g))]
  return [
    ...tabs.filter(isFixedTab),
    ...tabs.filter((t) => !isFixedTab(t) && pinned(t)),
    ...movable.filter((t) => !groupOf(t)),
    ...groups.flatMap((g) => movable.filter((t) => groupOf(t) === g))
  ]
}

/** A Tab goes into a group (an empty name takes it out); the Tabs are put in order again. */
export function setTabGroup(layout: DeskLayout, tabId: string, group: string): DeskLayout {
  const tab = layout.tabs.find((t) => t.id === tabId)
  if (!tab || tab.kind !== 'panes') throw new Error('Only a Tab with Panes can be put in a group')
  const name = group.trim()
  const { group: _old, ...rest } = tab
  return { ...layout, tabs: orderPins(layout.tabs.map((t) => (t.id === tabId ? (name ? { ...rest, group: name } : rest) : t))) }
}

/** A Tab is listed under a branch by hand in a list grouped by branch (an empty path gives it back to the automatic place). */
export function setTabBranch(layout: DeskLayout, tabId: string, path: string): DeskLayout {
  const tab = layout.tabs.find((t) => t.id === tabId)
  if (!tab || tab.kind !== 'panes') throw new Error('Only a Tab with Panes can be put under a branch')
  const { branch: _old, ...rest } = tab
  return { ...layout, tabs: layout.tabs.map((t) => (t.id === tabId ? (path ? { ...rest, branch: path } : rest) : t)) }
}

/** A Tab into a group, as its last Tab (a dropped Tab on the heading of a group). */
export function moveTabToGroup(layout: DeskLayout, tabId: string, group: string): DeskLayout {
  const tab = layout.tabs.find((t) => t.id === tabId)
  if (!tab || tab.kind !== 'panes' || tab.pinned) throw new Error('Only a Tab that is not pinned can be put in a group')
  const name = group.trim()
  const { group: _old, ...bare } = tab
  const moved: PaneTab = name ? { ...bare, group: name } : bare
  const others = layout.tabs.filter((t) => t.id !== tabId)
  const last = name ? others.map((t, i) => (t.kind === 'panes' && !t.pinned && t.group === name ? i : -1)).reduce((a, b) => Math.max(a, b), -1) : -1
  const at = last === -1 ? others.length : last + 1
  return { ...layout, tabs: orderPins([...others.slice(0, at), moved, ...others.slice(at)]) }
}

/** A whole group before (or after) another group in the list. */
export function moveGroup(layout: DeskLayout, group: string, target: string, after: boolean): DeskLayout {
  if (group === target) return layout
  const inGroup = (name: string) => (t: Tab): boolean => t.kind === 'panes' && !t.pinned && t.group === name
  const moving = layout.tabs.filter(inGroup(group))
  const rest = layout.tabs.filter((t) => !moving.includes(t))
  const targets = rest.map((t, i) => (inGroup(target)(t) ? i : -1)).filter((i) => i >= 0)
  if (moving.length === 0 || targets.length === 0) return layout
  const at = after ? targets[targets.length - 1] + 1 : targets[0]
  return { ...layout, tabs: orderPins([...rest.slice(0, at), ...moving, ...rest.slice(at)]) }
}

/** Pins a Tab (it goes to the end of the pinned ones) or unpins it (it becomes the first of the others). */
export function togglePin(layout: DeskLayout, tabId: string): DeskLayout {
  const tab = layout.tabs.find((t) => t.id === tabId)
  if (!tab || tab.kind !== 'panes') throw new Error(`Only a Tab with Panes can be pinned`)
  const { pinned: _was, ...rest } = tab
  const { group: _group, ...ungrouped } = rest
  const toggled: PaneTab = tab.pinned ? rest : { ...ungrouped, pinned: true }
  const others = layout.tabs.filter((t) => t.id !== tabId)
  // pinned: last of the pinned; unpinned: first of the others
  const pinnedCount = orderPins(others).filter((t) => t.kind === 'panes' && t.pinned).length
  const fixed = others.filter(isFixedTab)
  const movable = others.filter((t) => !isFixedTab(t))
  const at = toggled.pinned ? pinnedCount : pinnedCount
  return { ...layout, tabs: [...fixed, ...movable.slice(0, at), toggled, ...movable.slice(at)] }
}

/** The pinned Tabs as the left panel shows them: an icon each, and where to go. */
export interface PinnedTab {
  tabId: string
  name: string
  /** what the Tab shows: its only Pane's kind, or `terminal` when it holds several */
  icon: 'terminal' | 'browser' | 'file'
  favicon?: string
}

export function pinnedTabs(layout: DeskLayout): PinnedTab[] {
  return layout.tabs.flatMap((t): PinnedTab[] => {
    if (t.kind !== 'panes' || !t.pinned) return []
    const only = t.layout.type === 'pane' ? t.layout : undefined
    return [{ tabId: t.id, name: t.name, icon: only?.kind === 'browser' ? 'browser' : only?.kind === 'file' ? 'file' : 'terminal', ...(only?.kind === 'browser' && only.favicon ? { favicon: only.favicon } : {}) }]
  })
}

/** The Review Tab, made right after the fixed Tabs when there is none yet; `activate` brings it to the front. */
export function openReviewTab(layout: DeskLayout, newId: string, activate = true): DeskLayout {
  const open = layout.tabs.find((t) => t.kind === 'review')
  if (open) return activate ? { ...layout, activeTabId: open.id } : layout
  const at = layout.tabs.filter(isFixedTab).length
  const tabs = [...layout.tabs.slice(0, at), { kind: 'review' as const, id: newId, name: 'Review' }, ...layout.tabs.slice(at)]
  return { tabs, activeTabId: activate ? newId : layout.activeTabId }
}

/**
 * How a Review WorkDesk starts: the pull request's page(s) first, then the Review Tab, then the rest (the terminal); the pull
 * request is the Tab on screen. Makes the Review Tab when there is none.
 */
export function arrangeReviewStart(layout: DeskLayout, prUrls: readonly string[], reviewId: string): DeskLayout {
  const fixed = layout.tabs.filter(isFixedTab)
  const pages = layout.tabs.filter((t) => t.kind === 'panes' && t.layout.type === 'pane' && t.layout.kind === 'browser' && prUrls.includes(t.layout.url))
  const review: Tab = layout.tabs.find((t) => t.kind === 'review') ?? { kind: 'review', id: reviewId, name: 'Review' }
  const placed = new Set([...fixed, ...pages, review].map((t) => t.id))
  return { tabs: [...fixed, ...pages, review, ...layout.tabs.filter((t) => !placed.has(t.id))], activeTabId: pages[0]?.id ?? layout.activeTabId }
}

export function addTab(layout: DeskLayout, tab: Tab): DeskLayout {
  return { tabs: [...layout.tabs, tab], activeTabId: tab.id }
}

/**
 * Move a Pane to another Tab, or to a new one of its own (no `toTabId`). The Pane keeps its id, so a terminal keeps
 * running. A Tab left without Panes goes away; a Tab's only Pane cannot move to a new Tab (nothing would change).
 */
export function movePane(layout: DeskLayout, fromTabId: string, paneId: string, toTabId: string | undefined, newTabId: string): DeskLayout {
  const from = layout.tabs.find((t): t is PaneTab => t.kind === 'panes' && t.id === fromTabId)
  const pane = from && findPane(from.layout, paneId)
  if (!from || !pane) throw new Error(`Unknown Pane ${paneId}`)
  if (toTabId === fromTabId) return layout
  const to = toTabId === undefined ? undefined : layout.tabs.find((t): t is PaneTab => t.kind === 'panes' && t.id === toTabId)
  if (toTabId !== undefined && !to) throw new Error(`Unknown Tab ${toTabId}`)
  const rest = removePane(from.layout, paneId)
  if (!to && !rest) return layout
  const target: PaneTab = to
    ? { ...to, layout: to.layout.type === 'split' && to.layout.direction === 'horizontal' ? { ...to.layout, children: [...to.layout.children, pane], sizes: undefined } : { type: 'split', direction: 'horizontal', children: [to.layout, pane] } }
    : {
        kind: 'panes',
        id: newTabId,
        name: `${pane.kind === 'browser' ? 'Browser' : pane.kind === 'file' ? 'File' : 'Terminal'} ${layout.tabs.filter((t) => t.kind === 'panes').length + 1}`,
        layout: pane,
        ...(pane.kind === 'browser' || pane.kind === 'file' ? { autoName: true } : {})
      }
  const tabs = layout.tabs.flatMap((t): Tab[] => {
    if (t.id === fromTabId) return rest ? [{ ...from, layout: rest }] : []
    if (to && t.id === to.id) return [target]
    return [t]
  })
  return { ...layout, tabs: to ? tabs : [...tabs, target], activeTabId: target.id }
}

/** A name chosen by the user ends automatic naming. */
/**
 * Move a Tab right before or after another one. The Details Tab stays in front: they cannot be
 * moved, and dropping on one puts the Tab first among the others.
 */
/** `keepGroup`: the Tab keeps its own group (a list by branch does not show the groups, so the Tabs around it say nothing about them). */
export function moveTab(layout: DeskLayout, tabId: string, targetId: string, after: boolean, keepGroup = false): DeskLayout {
  const moved = layout.tabs.find((t) => t.id === tabId)
  if (!moved) throw new Error(`Unknown Tab ${tabId}`)
  if (!layout.tabs.some((t) => t.id === targetId)) throw new Error(`Unknown Tab ${targetId}`)
  if (isFixedTab(moved)) throw new Error(`The ${moved.name} Tab cannot be moved`)
  if (tabId === targetId) return layout
  const fixed = layout.tabs.filter(isFixedTab)
  const rest = layout.tabs.filter((t) => !isFixedTab(t) && t.id !== tabId)
  const target = rest.findIndex((t) => t.id === targetId)
  // a fixed Tab as target: first among the movable ones
  const at = target === -1 ? 0 : target + (after ? 1 : 0)
  // dropped among the Tabs of a group it joins that group, among the Tabs without a group it leaves its own; pinned ones have none
  const onto = layout.tabs.find((t) => t.id === targetId)
  let landed: Tab = moved
  if (!keepGroup && moved.kind === 'panes' && !moved.pinned && onto?.kind === 'panes' && !onto.pinned) {
    const { group: _was, ...bare } = moved
    landed = onto.group ? { ...bare, group: onto.group } : bare
  }
  // a pinned Tab stays among the pinned ones, an open one among the open ones
  return { ...layout, tabs: orderPins([...fixed, ...rest.slice(0, at), landed, ...rest.slice(at)]) }
}

/** The Tab after (or before) the active one, wrapping around; undefined when there is nothing to switch to. */
export function cycleTab(tabs: readonly { id: string }[], activeId: string, delta: 1 | -1): string | undefined {
  if (tabs.length < 2) return undefined
  const at = tabs.findIndex((t) => t.id === activeId)
  return tabs[((at === -1 ? 0 : at) + delta + tabs.length) % tabs.length].id
}

export function renameTab(layout: DeskLayout, tabId: string, name: string): DeskLayout {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A Tab needs a name')
  const fixed = layout.tabs.find((t) => t.id === tabId)
  if (fixed && isFixedTab(fixed)) throw new Error(`The ${fixed.name} Tab cannot be renamed`)
  return { ...layout, tabs: layout.tabs.map((t) => (t.id === tabId ? (t.kind === 'panes' ? { ...t, name: trimmed, autoName: false } : { ...t, name: trimmed }) : t)) }
}

/** Short Tab name from a page title. */
export function tabNameFromTitle(title: string | undefined, fallback: string): string {
  const t = (title ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return fallback
  return t.length > 28 ? t.slice(0, 27).trimEnd() + '…' : t
}

/** The title of the Tab's page, when it is a single Browser Pane. */
export function singleBrowserTitle(tab: PaneTab): string | undefined {
  return tab.layout.type === 'pane' && tab.layout.kind === 'browser' ? tab.layout.title : undefined
}

/** One Pane of a Tab, as a list of tabs shows it under the Tab. */
export interface PaneSummary {
  paneId: string
  kind: PaneNode['kind']
  /** what it shows: the folder of a terminal, the title of a page, the name of a file */
  label: string
  /** the icon of the page of a Browser Pane, when it announced one */
  favicon?: string
}

/** The Panes of a Tab in the order of the layout (first to last, left to right, top to bottom). */
export function paneSummaries(tab: PaneTab): PaneSummary[] {
  const out: PaneSummary[] = []
  const walk = (n: LayoutNode): void => {
    if (n.type === 'split') return n.children.forEach(walk)
    const host = (url: string): string => {
      try {
        return new URL(url).host
      } catch {
        return ''
      }
    }
    const label =
      n.kind === 'terminal' ? 'Terminal'
      : n.kind === 'browser' ? (n.title?.replace(/\s+/g, ' ').trim() || host(n.url) || 'Browser')
      : (n.path?.split('/').pop() ?? '') || 'File'
    out.push({ paneId: n.id, kind: n.kind, label, ...(n.kind === 'browser' && n.favicon ? { favicon: n.favicon } : {}) })
  }
  walk(tab.layout)
  return out
}

/** The name of a Tab in full: a Tab that follows its page shows the whole page title (its stored name is cut short for a row of tabs), others their name. */
export function fullTabName(tab: PaneTab): string {
  const title = tab.autoName ? singleBrowserTitle(tab)?.replace(/\s+/g, ' ').trim() : undefined
  return title || tab.name
}

/** A node with new ids for every Pane: a browser page stays on its page, a terminal is a new shell in the same folder. */
export function cloneNode(node: LayoutNode, id: () => string): LayoutNode {
  if (node.type === 'pane') return { ...node, id: id(), hibernated: undefined } as PaneNode
  return { ...node, children: node.children.map((c) => cloneNode(c, id)) }
}

/**
 * A Pane is dropped beside (or above) another Pane, in the same Tab or another one: it leaves its Tab (a Tab left empty goes away)
 * and the Tab it was dropped in is shown.
 */
export function movePaneBeside(layout: DeskLayout, fromTabId: string, paneId: string, toTabId: string, targetPaneId: string, direction: SplitDirection, before: boolean): DeskLayout {
  if (paneId === targetPaneId) return layout
  const from = layout.tabs.find((t): t is PaneTab => t.kind === 'panes' && t.id === fromTabId)
  const pane = from && findPane(from.layout, paneId)
  if (!from || !pane) throw new Error(`Unknown Pane ${paneId}`)
  const rest = removePane(from.layout, paneId)
  const baseOf = (t: PaneTab): LayoutNode | undefined => (t.id === fromTabId ? rest : t.layout)
  const to = layout.tabs.find((t): t is PaneTab => t.kind === 'panes' && t.id === toTabId)
  const base = to && baseOf(to)
  if (!to || !base || !findPane(base, targetPaneId)) throw new Error('Cannot put that Pane there')
  const placed = splitPane(base, targetPaneId, direction, pane, before)
  const tabs = layout.tabs.flatMap((t): Tab[] => {
    if (t.id === toTabId) return [{ ...to, layout: placed }]
    if (t.id === fromTabId) return rest ? [{ ...from, layout: rest }] : []
    return [t]
  })
  return { ...layout, tabs, activeTabId: toTabId }
}

/** What was closed last, to bring it back: a whole Tab, or one Pane of a Tab that stays (with a Pane that was beside it). */
export type ClosedItem = { kind: 'tab'; tab: PaneTab } | { kind: 'pane'; tabId: string; pane: PaneNode; beside: string }

/** Brings a closed Tab or Pane back (terminals start again where they started, pages come back on their page) and shows it. */
export function reopen(layout: DeskLayout, item: ClosedItem, tabId: string, id: () => string): DeskLayout {
  if (item.kind === 'pane') {
    const home = layout.tabs.find((t): t is PaneTab => t.kind === 'panes' && t.id === item.tabId)
    const pane = cloneNode(item.pane, id) as PaneNode
    if (home && findPane(home.layout, item.beside)) {
      return { ...layout, tabs: layout.tabs.map((t) => (t.id === home.id ? { ...home, layout: splitPane(home.layout, item.beside, 'horizontal', pane) } : t)), activeTabId: home.id }
    }
    return { ...layout, tabs: orderPins([...layout.tabs, { kind: 'panes', id: tabId, name: 'Terminal', layout: pane }]), activeTabId: tabId }
  }
  const tab: PaneTab = { ...item.tab, id: tabId, layout: cloneNode(item.tab.layout, id) }
  return { ...layout, tabs: orderPins([...layout.tabs, tab]), activeTabId: tabId }
}

/** A copy of a Tab with pages in it, right after it and shown. */
export function duplicateTab(layout: DeskLayout, tabId: string, newTabId: string, id: () => string): DeskLayout {
  const at = layout.tabs.findIndex((t) => t.id === tabId)
  const tab = layout.tabs[at]
  if (!tab || tab.kind !== 'panes') throw new Error(`Cannot duplicate Tab ${tabId}`)
  const { pinned: _pinned, autoHibernated: _auto, ...unpinned } = tab
  const copy: PaneTab = { ...unpinned, id: newTabId, layout: cloneNode(tab.layout, id) }
  const tabs = [...layout.tabs]
  tabs.splice(at + 1, 0, copy)
  return { ...layout, tabs: orderPins(tabs), activeTabId: newTabId }
}

/** Going to a Tab shows it; a hibernated one shows its wake-up screen and loads only when asked. */
export function setActiveTab(layout: DeskLayout, tabId: string): DeskLayout {
  if (!layout.tabs.some((t) => t.id === tabId)) throw new Error(`Unknown Tab ${tabId}`)
  return { ...layout, activeTabId: tabId }
}

function hibernateNode(node: LayoutNode, on: boolean): LayoutNode {
  if (node.type === 'pane') return node.kind === 'browser' ? { ...node, hibernated: on || undefined } : node
  return { ...node, children: node.children.map((c) => hibernateNode(c, on)) }
}

/** Unload the pages of a Tab (`on`), or load them again. Terminals are never touched: their shells keep running. */
export function withHibernated(tab: Tab, on: boolean, auto = false): Tab {
  return tab.kind === 'panes' ? { ...tab, layout: hibernateNode(tab.layout, on), autoHibernated: on && auto ? true : undefined } : tab
}

/** `auto`: the app did it (the Tab was out of sight); the pages then load again when the Tab is shown. */
export function setTabHibernated(layout: DeskLayout, tabId: string, on: boolean, auto = false): DeskLayout {
  if (!layout.tabs.some((t) => t.id === tabId)) throw new Error(`Unknown Tab ${tabId}`)
  return { ...layout, tabs: layout.tabs.map((t) => (t.id === tabId ? withHibernated(t, on, auto) : t)) }
}

/** Has the Tab pages, and are they all unloaded? */
export function isTabHibernated(tab: Tab): boolean {
  if (tab.kind !== 'panes') return false
  const pages = (n: LayoutNode): boolean[] => (n.type === 'pane' ? (n.kind === 'browser' ? [!!n.hibernated] : []) : n.children.flatMap(pages))
  const all = pages(tab.layout)
  return all.length > 0 && all.every(Boolean)
}

/** Does the Tab have a page that could be unloaded? */
export const hasPages = (tab: Tab): boolean => tab.kind === 'panes' && paneIds(tab.layout, 'browser').length > 0

export function closeTab(layout: DeskLayout, tabId: string): DeskLayout {
  const at = layout.tabs.findIndex((t) => t.id === tabId)
  if (at === -1) throw new Error(`Unknown Tab ${tabId}`)
  if (isFixedTab(layout.tabs[at])) throw new Error(`The ${layout.tabs[at].name} Tab cannot be closed`)
  if (layout.tabs[at].kind === 'panes' && layout.tabs[at].pinned) throw new Error(`Unpin the Tab "${layout.tabs[at].name}" to close it`)
  if (layout.tabs.length === 1) throw new Error('A WorkDesk keeps at least one Tab')
  const tabs = layout.tabs.filter((t) => t.id !== tabId)
  const activeTabId = layout.activeTabId === tabId ? tabs[Math.min(at, tabs.length - 1)].id : layout.activeTabId
  return { tabs, activeTabId }
}

/** Panes of a Tab that closing it will end. */
export function tabPaneIds(layout: DeskLayout, tabId: string): string[] {
  const tab = paneTab(layout, tabId)
  return tab ? paneIds(tab.layout, 'terminal') : []
}
