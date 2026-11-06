import { useSyncExternalStore } from 'react'
import * as t from '../main/domain/file-tabs'

const KEY = 'workdesk.files.tabs'

function load(): t.FileTabs {
  try {
    return t.parseFileTabs(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
  } catch {
    return { tabs: [] }
  }
}

let state = load()
const listeners = new Set<() => void>()
const id = (): string => Math.random().toString(36).slice(2, 10)

function set(next: t.FileTabs): void {
  if (next === state) return
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // remembering the tabs is a convenience only
  }
  listeners.forEach((l) => l())
}

/** The tabs of the Files page, which belongs to no WorkDesk; kept on this machine. */
export const fileTabs = {
  new: () => set(t.newFileTab(state, id())),
  open: (path: string, line?: number) => set(t.openFile(state, path, id(), line)),
  setPath: (tabId: string, path: string | undefined, line?: number) => set(t.setFilePath(state, tabId, path, line)),
  activate: (tabId: string) => set(t.activateFileTab(state, tabId)),
  close: (tabId: string) => set(t.closeFileTab(state, tabId))
}

export const currentFileTabs = (): t.FileTabs => state

export const useFileTabs = (): t.FileTabs =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state
  )
