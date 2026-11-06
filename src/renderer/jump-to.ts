import type { DeskLayout, LayoutNode, PaneTab } from '../main/domain/layout'
import { fullTabName } from '../main/domain/layout'
import { BLANK, tabLabel, type PageTab } from '../main/domain/browser-tabs'
import type { FileTab } from '../main/domain/file-tabs'

export type JumpTarget = { kind: 'desk'; deskId: string; tabId: string } | { kind: 'page'; tabId: string } | { kind: 'file'; tabId: string }

/** One place "Jump to" can go to: a Pane of a WorkDesk's Tab, a tab of the Browser page, a tab of the Files page. */
export interface JumpItem {
  key: string
  /** the WorkDesk's name, `Browser` or `Files`: the list is grouped by it */
  group: string
  title: string
  /** the address, path or folder */
  hint: string
  badge: 'terminal' | 'browser' | 'file'
  /** everything it is found by, lower case */
  haystack: string
  target: JumpTarget
}

const fileName = (path: string): string => path.split('/').pop() || path

const item = (group: string, key: string, title: string, hint: string, badge: JumpItem['badge'], extra: string[], target: JumpTarget): JumpItem => ({
  key,
  group,
  title,
  hint,
  badge,
  haystack: [group, title, hint, ...extra].join(' ').toLowerCase(),
  target
})

/** The Panes of a WorkDesk's Tabs, one row each (a Tab with one Pane is one row named like the Tab). */
export function deskJumpItems(deskId: string, deskName: string, layout: DeskLayout): JumpItem[] {
  const out: JumpItem[] = []
  for (const tab of layout.tabs) {
    if (tab.kind !== 'panes') continue
    const panes: Exclude<LayoutNode, { type: 'split' }>[] = []
    const walk = (n: LayoutNode): void => (n.type === 'split' ? n.children.forEach(walk) : void panes.push(n))
    walk(tab.layout)
    const name = fullTabName(tab as PaneTab)
    for (const p of panes) {
      const what = p.kind === 'browser' ? p.url : p.kind === 'file' ? (p.path ?? '') : (p.cwd ?? '')
      const own = p.kind === 'browser' ? p.title?.replace(/\s+/g, ' ').trim() : p.kind === 'file' ? (p.path ? fileName(p.path) : 'File') : 'Terminal'
      const title = panes.length === 1 ? name : `${name} › ${own || p.kind}`
      out.push(item(deskName, `${deskId}/${tab.id}/${p.id}`, title, what, p.kind, [tab.name, own ?? '', tab.group ?? ''], { kind: 'desk', deskId, tabId: tab.id }))
    }
  }
  return out
}

export const pageJumpItems = (tabs: readonly PageTab[]): JumpItem[] =>
  tabs.map((t) => item('Browser', `page/${t.id}`, tabLabel(t), t.url === BLANK ? '' : t.url, 'browser', [t.title, t.name ?? ''], { kind: 'page', tabId: t.id }))

export const fileJumpItems = (tabs: readonly FileTab[]): JumpItem[] =>
  tabs.filter((t) => t.path).map((t) => item('Files', `file/${t.id}`, fileName(t.path!), t.path!, 'file', [], { kind: 'file', tabId: t.id }))

/** The rows that have every typed word somewhere in their name, address, path, Tab or WorkDesk; no words: all. The order stays. */
export function filterJump(items: readonly JumpItem[], query: string): JumpItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return items.filter((i) => words.every((w) => i.haystack.includes(w)))
}
