import { useCallback, useEffect, useRef, useState } from 'react'
import { memoryLabel, tabsToHibernate, trackHidden } from '../main/domain/hibernate'
import { isTabHibernated, type DeskLayout, type Tab } from '../main/domain/layout'
import { getAutoHibernate } from './auto-hibernate'

interface PageElement extends HTMLElement {
  getWebContentsId(): number
  isCurrentlyAudible?(): boolean
  executeJavaScript(code: string): Promise<unknown>
}

/** Where a page was scrolled to when it was unloaded, by Pane; the page goes back there when it loads again. */
const scrolls = new Map<string, [number, number]>()
/** What a Tab's pages used when they were unloaded (MB), by Tab, for its tooltip. */
const freed = new Map<string, number>()

export function restoreScroll(paneId: string, el: PageElement): void {
  const at = scrolls.get(paneId)
  if (!at) return
  scrolls.delete(paneId)
  const go = () => void el.executeJavaScript(`window.scrollTo(${at[0]}, ${at[1]})`).catch(() => undefined)
  // single-page apps draw after the load: try again a little later
  el.addEventListener('did-stop-loading', () => (go(), setTimeout(go, 800)), { once: true })
}

const pagesOf = (tabId: string): PageElement[] => [...document.querySelectorAll<PageElement>(`.tab-pane[data-tab="${tabId}"] webview`)]

/** Memory (MB) of the pages shown in a Tab right now. */
async function tabMemory(tabId: string): Promise<number> {
  const mem = await window.workdesk.pageMemory()
  let total = 0
  for (const el of pagesOf(tabId)) {
    try {
      total += mem[el.getWebContentsId()] ?? 0
    } catch {
      // not attached yet
    }
  }
  return total
}

const TICK_MS = 30_000

interface Options {
  deskId: string
  /** the WorkDesk is on screen */
  visible: boolean
  shownTabId: string | undefined
  tabs: readonly Tab[]
  onLayout: (l: DeskLayout) => void
}

/**
 * A Tab with pages that has been out of sight for the delay of Settings → Browser is hibernated, exactly as *Hibernate* in its
 * right-click menu does (its address stays, and the scroll position is kept); it wakes only with the button of its Wake up screen. Also the tooltip of a
 * Tab: what its pages use, or what unloading them freed.
 */
export function useTabHibernation({ deskId, visible, shownTabId, tabs, onLayout }: Options): { tip: (tabId: string) => string | undefined; hover: (tabId: string) => void } {
  const hidden = useRef(new Map<string, number>())
  const latest = useRef({ tabs, visible, shownTabId })
  latest.current = { tabs, visible, shownTabId }
  const [tips, setTips] = useState<Record<string, string>>({})

  // the clock of a Tab starts when it leaves the screen, also when the whole WorkDesk does
  useEffect(() => {
    hidden.current = trackHidden(hidden.current, tabs.map((t) => t.id), visible ? shownTabId : undefined, Date.now())
  }, [tabs, visible, shownTabId])

  useEffect(() => {
    const timer = setInterval(() => {
      const { tabs: now, visible: v, shownTabId: shown } = latest.current
      hidden.current = trackHidden(hidden.current, now.map((t) => t.id), v ? shown : undefined, Date.now())
      // a Tab whose pages were never built (it was not shown yet) has nothing to unload
      const busy = (id: string) => pagesOf(id).length === 0 || pagesOf(id).some((el) => { try { return !!el.isCurrentlyAudible?.() } catch { return false } })
      for (const id of tabsToHibernate(now, { since: hidden.current, now: Date.now() }, getAutoHibernate(), busy)) {
        void (async () => {
          const els = pagesOf(id)
          await Promise.all(
            els.map(async (el) => {
              try {
                const at = (await el.executeJavaScript('[window.scrollX, window.scrollY]')) as [number, number]
                const paneId = el.closest<HTMLElement>('.pane-cell')?.dataset.paneId
                if (paneId && (at[0] || at[1])) scrolls.set(paneId, at)
              } catch {
                // the page does not answer: it comes back at the top
              }
            })
          )
          freed.set(id, await tabMemory(id).catch(() => 0))
          onLayout(await window.workdesk.hibernateTab(deskId, id, true))
        })()
      }
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [deskId, onLayout])

  const hover = useCallback(
    (tabId: string) => {
      const tab = latest.current.tabs.find((t) => t.id === tabId)
      if (!tab || tab.kind !== 'panes') return
      void tabMemory(tabId).then(
        (mb) => {
          const text = mb > 0 ? `Pages use about ${memoryLabel(mb)}` : freed.has(tabId) ? `Unloading its pages freed about ${memoryLabel(freed.get(tabId) ?? 0)}` : ''
          setTips((cur) => (cur[tabId] === text ? cur : { ...cur, [tabId]: text }))
        },
        () => undefined
      )
    },
    []
  )

  const tip = (tabId: string): string | undefined => {
    const t = tabs.find((x) => x.id === tabId)
    if (!t || t.kind !== 'panes') return undefined
    const mb = freed.get(tabId)
    // an unloaded Tab remembers what it used; a loaded one is asked on hover
    if (isTabHibernated(t)) return mb ? `Unloaded: it freed about ${memoryLabel(mb)}` : undefined
    return tips[tabId] || undefined
  }

  return { tip, hover }
}
