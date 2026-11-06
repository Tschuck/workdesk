import { useSyncExternalStore } from 'react'
import * as t from '../main/domain/browser-tabs'

const KEY = 'workdesk.browser.tabs'

function load(): t.PageTabs {
  try {
    return t.parsePageTabs(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
  } catch {
    return { tabs: [] }
  }
}

let state = load()
const listeners = new Set<() => void>()

function set(next: t.PageTabs): void {
  if (next === state) return
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // remembering the Tabs is a convenience only
  }
  listeners.forEach((l) => l())
}

/** The Tabs of the Browser page, shared by the page and the pinned icons in the left panel. */
export const pageTabs = {
  open: (url: string = t.BLANK) => set(t.openTab(state, url, Math.random().toString(36).slice(2, 10))),
  close: (id: string) => set(t.closeTab(state, id)),
  activate: (id: string) => set(t.activate(state, id)),
  rename: (id: string, name: string) => set(t.renameTab(state, id, name)),
  duplicate: (id: string) => set(t.duplicateTab(state, id, Math.random().toString(36).slice(2, 10))),
  togglePin: (id: string) => set(t.togglePin(state, id)),
  move: (id: string, targetId: string, after: boolean) => set(t.moveTab(state, id, targetId, after)),
  hibernate: (id: string) => set(t.hibernate(state, id)),
  wake: (id: string) => set(t.wake(state, id)),
  locate: (id: string, l: { url: string; title?: string; favicon?: string }) => set(t.locate(state, id, l))
}

export const currentPageTabs = (): t.PageTabs => state

export const usePageTabs = (): t.PageTabs =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state
  )

type ShownPage = HTMLElement & { reload(): void; openDevTools(): void; closeDevTools(): void; isDevToolsOpened(): boolean }

/** The web page that is shown (the one with the focus if several are). */
function shownPage(): ShownPage | undefined {
  const shown = [...document.querySelectorAll<ShownPage>('webview')].filter((el) => !el.closest('.desk-layer:not(.on), .tab-pane:not(.on)'))
  return shown.find((el) => el === document.activeElement) ?? shown[0]
}

/** Cmd+R: reload the web page that is shown, never the app itself. */
export function reloadShownPage(): void {
  shownPage()?.reload()
}

/** Open the Chrome developer tools of the web page that is shown, or close them. */
export function toggleShownPageDevTools(): void {
  const page = shownPage()
  if (!page) return
  if (page.isDevToolsOpened()) page.closeDevTools()
  else page.openDevTools()
}
