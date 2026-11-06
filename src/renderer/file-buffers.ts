import { useSyncExternalStore } from 'react'

/** File Panes (and tabs of the Files page) whose file has changes that are not saved yet; asked before one is closed. */
const dirty = new Set<string>()
const listeners = new Set<() => void>()
let version = 0
export function setFileDirty(paneId: string, on: boolean): void {
  if (dirty.has(paneId) === on) return
  on ? dirty.add(paneId) : dirty.delete(paneId)
  version++
  listeners.forEach((l) => l())
}
export const isFileDirty = (paneId: string): boolean => dirty.has(paneId)
/** For a tab that shows a dot while its file has unsaved changes. */
export const useFileDirty = (paneId: string): boolean =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => (void version, dirty.has(paneId))
  )

/** A path as a tree: folders with their files, folders first, names in order. */
export interface TreeNode {
  name: string
  /** relative path of the file or folder */
  path: string
  children?: TreeNode[]
}

/** `files` are paths of files; a path ending in `/` is an empty folder. */
export function buildTree(files: readonly string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] }
  for (const entry of files) {
    let node = root
    const folder = entry.endsWith('/')
    const parts = (folder ? entry.slice(0, -1) : entry).split('/')
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/')
      if (i === parts.length - 1 && !folder) {
        node.children!.push({ name, path })
        return
      }
      let next = node.children!.find((c) => c.children && c.name === name)
      if (!next) {
        next = { name, path, children: [] }
        node.children!.push(next)
      }
      node = next
    })
  }
  const order = (n: TreeNode): void => {
    n.children?.sort((a, b) => (!!b.children as unknown as number) - (!!a.children as unknown as number) || a.name.localeCompare(b.name))
    n.children?.forEach(order)
  }
  order(root)
  return root.children!
}

const isSubsequence = (text: string, word: string): boolean => {
  let at = 0
  for (const c of text) if (c === word[at] && ++at === word.length) return true
  return false
}

/**
 * The files for what was typed (shortest paths first): the paths that contain every word; when there are none, the paths in which every
 * word is found letter by letter (a typo, a missing folder name); and when a typed extension is the reason (`.js` for a `.ts` file), the
 * same without it. A `./` in front is ignored, so a relative path from the project's root can be pasted as it is.
 */
export function filterFiles(files: readonly string[], query: string): string[] {
  const words = query.trim().replace(/^\.?\/+/, '').toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const lower = files.map((f) => [f, f.toLowerCase()] as const)
  const byLength = (a: string, b: string) => a.length - b.length || a.localeCompare(b)
  const pick = (ws: string[], fits: (l: string, w: string) => boolean): string[] => lower.filter(([, l]) => ws.every((w) => fits(l, w))).map(([f]) => f).sort(byLength)
  const exact = pick(words, (l, w) => l.includes(w))
  if (exact.length > 0) return exact.slice(0, 200)
  const loose = pick(words, isSubsequence)
  if (loose.length > 0) return loose.slice(0, 200)
  const last = words[words.length - 1]
  const stem = last.replace(/\.[a-z0-9]{1,8}$/, '')
  if (stem !== last && stem) {
    const ws = [...words.slice(0, -1), stem]
    const near = pick(ws, (l, w) => l.includes(w))
    return (near.length > 0 ? near : pick(ws, isSubsequence)).slice(0, 200)
  }
  return []
}
