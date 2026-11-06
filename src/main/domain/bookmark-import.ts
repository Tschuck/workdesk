import { findBookmark, isBookmarkable, type Bookmark } from './bookmarks'

/** The bookmarks of another browser as a tree: folders and pages. */
export type ImportNode = { type: 'folder'; name: string; children: ImportNode[] } | { type: 'url'; name: string; url: string }

/** A page picked for import, with the folders it lay in. */
export interface ImportItem {
  title: string
  url: string
  /** folders below the browser's top level, joined with " / "; empty: not in a folder */
  group: string
}

/** Chromium family (Vivaldi): the roots of Bookmarks.json as top-level folders. The trash and empty folders are left out. */
export function parseChromiumBookmarks(data: unknown): ImportNode[] {
  const roots = (data as { roots?: Record<string, unknown> } | null)?.roots
  if (!roots || typeof roots !== 'object') return []
  const walk = (n: unknown): ImportNode | undefined => {
    const o = n as { type?: string; name?: string; url?: string; children?: unknown[] }
    if (!o || typeof o !== 'object') return undefined
    if (o.type === 'url' && typeof o.url === 'string' && isBookmarkable(o.url)) return { type: 'url', name: String(o.name ?? '') || o.url, url: o.url }
    if (o.type === 'folder' && Array.isArray(o.children)) {
      const children = o.children.map(walk).filter((c): c is ImportNode => !!c)
      return children.length > 0 ? { type: 'folder', name: String(o.name ?? '') || 'Folder', children } : undefined
    }
    return undefined
  }
  return Object.entries(roots)
    .filter(([key]) => key !== 'trash' && key !== 'sync_transaction_version')
    .map(([, v]) => walk(v))
    .filter((n): n is ImportNode => !!n)
}

/** One row of Firefox's places database: a bookmark (type 1, with its page's address) or a folder (type 2). */
export interface FirefoxRow {
  id: number
  type: number
  parent: number
  title: string | null
  url: string | null
}

/** Firefox: the folders under the root (menu, toolbar, others, mobile) with what is in them; the root itself and "place:" queries are left out. */
export function treeFromFirefoxRows(rows: readonly FirefoxRow[]): ImportNode[] {
  const byParent = new Map<number, FirefoxRow[]>()
  for (const r of rows) byParent.set(r.parent, [...(byParent.get(r.parent) ?? []), r])
  const walk = (r: FirefoxRow, seen: Set<number>): ImportNode | undefined => {
    if (r.type === 1 && r.url && isBookmarkable(r.url)) return { type: 'url', name: r.title?.trim() || r.url, url: r.url }
    if (r.type !== 2 || seen.has(r.id)) return undefined
    const next = new Set(seen).add(r.id)
    const children = (byParent.get(r.id) ?? []).map((c) => walk(c, next)).filter((c): c is ImportNode => !!c)
    return children.length > 0 ? { type: 'folder', name: r.title?.trim() || 'Folder', children } : undefined
  }
  // the places root has parent 0 and the id 1; its folders are the top level
  const root = rows.find((r) => r.parent === 0 && r.type === 2)
  return (root ? (byParent.get(root.id) ?? []) : []).map((r) => walk(r, new Set([root!.id]))).filter((n): n is ImportNode => !!n)
}

/** How many pages are in the tree. */
export const countPages = (nodes: readonly ImportNode[]): number => nodes.reduce((n, x) => n + (x.type === 'url' ? 1 : countPages(x.children)), 0)

/** Every page of the tree with its folders, in order. Top-level folders only name where it came from, so they do not become part of the group. */
export function importItems(nodes: readonly ImportNode[]): ImportItem[] {
  const out: ImportItem[] = []
  const walk = (list: readonly ImportNode[], path: string[]) => {
    for (const n of list) {
      if (n.type === 'url') out.push({ title: n.name, url: n.url, group: path.join(' / ') })
      else walk(n.children, [...path, n.name])
    }
  }
  for (const n of nodes) n.type === 'url' ? out.push({ title: n.name, url: n.url, group: '' }) : walk(n.children, [])
  return out
}

/** Adds the picked pages as bookmarks; a page that is a favorite already is left as it is. */
export function importBookmarks(list: readonly Bookmark[], items: readonly ImportItem[], id: () => string): { list: Bookmark[]; added: number; skipped: number } {
  let out = [...list]
  let added = 0
  let skipped = 0
  for (const i of items) {
    if (!isBookmarkable(i.url) || findBookmark(out, i.url)) {
      skipped++
      continue
    }
    const group = i.group.trim()
    out = [...out, { id: id(), title: i.title.trim() || i.url, url: i.url, ...(group ? { group } : {}) }]
    added++
  }
  return { list: out, added, skipped }
}
