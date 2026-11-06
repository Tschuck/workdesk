import { Fragment, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppState } from '../shared/api'
import { ICONS } from './Icons'
import { Chevron } from './FileIcon'
import { setPanesActiveOnly, usePanesActiveOnly } from './pane-list'
import { PANEL_SIZES, Resizer } from './Resizer'
import type { FileRoot } from '../main/files'
import { useLiveCwds } from './live-cwds'
import { useOpenRequests } from './open-requests'
import { branchChip, branchOf, branchRoots, groupedOrder, setScope, useScope } from './scope'
import { listTitle, useTerminalTitles } from './terminal-titles'
import { tabsClass, useDeskTabsPosition } from './tabs-layout'
import { cycleTab, findPane, fullTabName, paneSummaries, hasPages, paneIds, isTabHibernated, singleBrowserFavicon, type DeskLayout, type PaneTab, type SplitDirection, type Tab } from '../main/domain/layout'
import { cycleDelta, recentDelta } from './terminal-keys'
import { touchRecent, walkRecent } from './recent-tabs'
import type { RestackStep } from '../main/domain/stack'
import type { WorkDesk } from '../main/domain/types'
import type { DeskPrs } from '../main/sources/desk-prs'
import { DetailsPane } from './DetailsPane'
import { pollWhileFocused } from './poll'
import { isFileDirty } from './file-buffers'
import { toggleFileWrap } from './file-wrap'
import { TabDragContext, type TabSplit } from './TabDropZone'
import { TerminalActiveContext } from './terminal-active'
import { usePaletteCommands, usePaletteFileOpener, type Command } from './command-palette'
import { DeskLinksContext, OpenLinkContext, OpenLinksContext, type DeskLink } from './OpenLink'
import { navDirection, neighbourPane, splitDirection, type NavDirection } from './pane-nav'
import { SplitPicker } from './SplitPicker'
import { FileFinder } from './FileFinder'
import { FINDER_EVENT, SEARCH_EVENT } from './FilePane'
import { ReviewMode } from './ReviewMode'
import { NewNote } from './NewNote'
import { JwtModal } from './JwtModal'
import { USAGES_EVENT, type UsagesMode } from './usages-events'
import { GroupDialog } from './GroupDialog'
import { ContextMenu } from './ContextMenu'
import { IconButton } from './Icons'
import { AttachContext, attachTargets } from './PageRefs'
import { refLabel } from '../main/domain/page-refs'
import { LayoutView, PANE_MIME } from './LayoutView'
import { useTabHibernation } from './tab-hibernation'
import { buildsOnFirstShow } from '../main/domain/hibernate'

interface Props {
  desk: WorkDesk
  state: AppState
  run: (action: () => Promise<AppState>) => Promise<void>
  /** this WorkDesk is the one on screen; the others stay mounted (hidden) so pages and terminals keep running */
  visible: boolean
  onClear: () => void
  /** take another WorkDesk into this one */
  onCombine: () => void
  /** show a branch's details on the Branches page */
}

/** The ids of all Panes of a Tab (none for Tabs without Panes). */
/** The File Panes of a Tab (or just one Pane of it) with the path of their file. */
const filePanesOf = (layout: DeskLayout | undefined, tabId: string, paneId?: string): { paneId: string; path?: string }[] => {
  const t = layout?.tabs.find((x) => x.id === tabId)
  if (t?.kind !== 'panes') return []
  return paneIds(t.layout, 'file')
    .filter((id) => !paneId || id === paneId)
    .map((id) => {
      const p = findPane(t.layout, id)
      return { paneId: id, path: p?.kind === 'file' ? p.path : undefined }
    })
}

/** The icon of a Tab with Panes: that of its only Pane; a Tab with several shows the terminal. */
const tabIcon = (t: { kind: string; layout?: { type: string; kind?: string } }): 'terminal' | 'globe' | 'file' => (t.layout?.type === 'pane' ? (t.layout.kind === 'browser' ? 'globe' : t.layout.kind === 'file' ? 'file' : 'terminal') : 'terminal')

/**
 * The heading above a Tab in a list of tabs, if one starts something there: Pinned, Tabs (those without a group, once something is
 * pinned or grouped) or the name of a group, which folds.
 */
interface GroupDnd {
  /** the group being dragged, or a Tab (dragged onto a heading it joins that group) */
  dragging: boolean
  over?: { group: string; after?: boolean }
  start: (group: string) => void
  hover: (e: React.DragEvent, group: string, reorder: boolean) => void
  drop: (e: React.DragEvent, group: string) => void
  end: () => void
}

function deskTabHeader(tabs: readonly Tab[], index: number, folded: ReadonlySet<string>, toggle: (group: string) => void, dnd: GroupDnd): ReactNode {
  const t = tabs[index]
  if (t.kind !== 'panes') return null
  const before = tabs.slice(0, index).filter((x): x is PaneTab => x.kind === 'panes')
  const pinned = (x: PaneTab) => !!x.pinned
  const any = tabs.some((x) => x.kind === 'panes' && (x.pinned || x.group))
  if (t.pinned) return before.some(pinned) ? null : <div className="tab-group" key="pinned">Pinned</div>
  if (t.group) {
    const g = t.group
    return before.some((x) => !x.pinned && x.group === g) ? null : (
      <div
        className={['tab-group', 'tab-group-fold', dnd.over?.group === g ? (dnd.over.after === undefined ? 'drop-into' : dnd.over.after ? 'drop-after' : 'drop-before') : ''].filter(Boolean).join(' ')}
        key={`group-${g}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('application/x-workdesk-group', g)
          dnd.start(g)
        }}
        onDragOver={(e) => dnd.hover(e, g, true)}
        onDrop={(e) => dnd.drop(e, g)}
        onDragEnd={dnd.end}
        onClick={() => toggle(g)}
        title={folded.has(g) ? 'Show this group' : 'Hide this group'}
      >
        {g}
        <Chevron open={!folded.has(g)} />
      </div>
    )
  }
  return any && !before.some((x) => !x.pinned && !x.group) ? (
    <div
      className={['tab-group', dnd.over?.group === '' ? 'drop-into' : ''].filter(Boolean).join(' ')}
      key="others"
      onDragOver={(e) => dnd.hover(e, '', false)}
      onDrop={(e) => dnd.drop(e, '')}
    >
      Tabs
    </div>
  ) : null
}

const paneIdsOf = (layout: DeskLayout | undefined, tabId: string): string[] => {
  const t = layout?.tabs.find((x) => x.id === tabId)
  return t?.kind === 'panes' ? paneIds(t.layout) : []
}

export function DeskView({ desk, state, run, visible, onClear, onCombine }: Props) {
  const api = window.workdesk
  // how the app opens a link (its Browser page): what a parked WorkDesk falls back to
  const outerOpenLink = useContext(OpenLinkContext)
  const outerOpenLinks = useContext(OpenLinksContext)
  const tabsPos = useDeskTabsPosition(desk.id)
  // review mode: the changes tree and the diff take the place of the tabs; kept per WorkDesk
  const remembered = (key: string): boolean => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  }
  const remember = (key: string, on: boolean) => {
    try {
      localStorage.setItem(key, on ? '1' : '0')
    } catch {
      /* not remembered */
    }
  }
  // the list of tabs at the side folded to a strip of icons (kept per WorkDesk, on this machine)
  const [noting, setNoting] = useState(false)
  const [jwt, setJwt] = useState(false)
  const [tabsFolded, setTabsFolded] = useState(() => remembered(`workdesk.tabsFolded.${desk.id}`))
  const foldTabs = () => (remember(`workdesk.tabsFolded.${desk.id}`, !tabsFolded), setTabsFolded(!tabsFolded))
  const termTitles = useTerminalTitles()
  // the Pane that has the keyboard, and the Tabs whose Panes are folded away in a list of tabs
  const [focusedPane, setFocusedPane] = useState<string>()
  const [folded, setFolded] = useState<Set<string>>(new Set())
  // with the panes only under the active tab: the other tabs whose panes were opened by hand
  const [opened, setOpened] = useState<Set<string>>(new Set())
  const activeOnly = usePanesActiveOnly()
  // groups of tabs folded away in a list of tabs, and the tab whose group is being typed
  const [foldedGroups, setFoldedGroups] = useState<Set<string>>(new Set())
  const [grouping, setGrouping] = useState<string>()
  const deskId = desk.id
  // a planned WorkDesk, like a parked one, shows only its Details until it is started
  const parked = desk.presence === 'parked' || desk.presence === 'planned'
  const branchesKey = JSON.stringify(desk.branches.map((b) => b.branch))
  const [layout, setLayout] = useState<DeskLayout>()
  const [editing, setEditing] = useState<string>()
  // the right-click menu of a Tab
  const [menu, setMenu] = useState<{ x: number; y: number; tabId: string }>()
  const [confirm, setConfirm] = useState<{ tabId: string; paneId?: string; running: string[] }>()
  // dragging a Tab to resort them
  const [dragTab, setDragTab] = useState<string>()
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean }>()
  const [dragGroup, setDragGroup] = useState<string>()
  const [groupOver, setGroupOver] = useState<{ group: string; after?: boolean }>()
  const groupDnd: GroupDnd = {
    dragging: !!dragTab || !!dragGroup,
    over: groupOver,
    start: (g) => setDragGroup(g),
    hover: (e, g, reorder) => {
      if (dragGroup && reorder && dragGroup !== g) {
        e.preventDefault()
        const box = e.currentTarget.getBoundingClientRect()
        setGroupOver({ group: g, after: e.clientY > box.top + box.height / 2 })
      } else if (dragTab) {
        e.preventDefault()
        setGroupOver({ group: g })
      }
    },
    drop: (e, g) => {
      e.preventDefault()
      const tabId = dragTab
      const group = dragGroup
      const at = groupOver
      setDragTab(undefined)
      setDragGroup(undefined)
      setGroupOver(undefined)
      if (group && at && at.after !== undefined && group !== g) update(api.moveGroup(deskId, group, g, at.after))
      else if (tabId) update(api.moveTabToGroup(deskId, tabId, g))
    },
    end: () => (setDragGroup(undefined), setGroupOver(undefined))
  }
  // a Pane is being dragged: the Tabs and the Tab bar take it
  const [paneDrag, setPaneDrag] = useState<{ tabId: string; paneId: string }>()
  const [paneOver, setPaneOver] = useState<string>()
  useEffect(() => {
    const start = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes(PANE_MIME)) return
      try {
        setPaneDrag(JSON.parse(e.dataTransfer.getData(PANE_MIME)) as { tabId: string; paneId: string })
      } catch {
        // not ours
      }
    }
    const end = () => (setPaneDrag(undefined), setPaneOver(undefined))
    window.addEventListener('dragstart', start)
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)
    return () => {
      window.removeEventListener('dragstart', start)
      window.removeEventListener('dragend', end)
      window.removeEventListener('drop', end)
    }
  }, [])
  const dropPane = (e: React.DragEvent, toTabId?: string) => {
    const raw = e.dataTransfer.getData(PANE_MIME)
    if (!raw) return
    e.preventDefault()
    e.stopPropagation()
    setPaneDrag(undefined)
    setPaneOver(undefined)
    try {
      const { tabId, paneId } = JSON.parse(raw) as { tabId: string; paneId: string }
      // a pane of this WorkDesk only
      if (layout?.tabs.some((t) => t.id === tabId)) update(api.movePane(deskId, tabId, paneId, toTabId))
    } catch {
      // not ours
    }
  }
  const [plan, setPlan] = useState<RestackStep[]>([])
  // Pull Requests of the branches: asked when the Details tab is on screen, then every two minutes
  const [prData, setPrData] = useState<DeskPrs>()
  const loadPrs = useCallback(
    async (refresh: boolean) => {
      try {
        setPrData(await api.deskPrs(deskId, refresh))
      } catch {
        // the branches show "no PR" until GitHub answers
      }
    },
    [api, deskId]
  )

  useEffect(() => {
    if (visible && !parked) void api.restackPlan(deskId).then(setPlan, () => setPlan([]))
  }, [api, deskId, branchesKey, visible, parked])

  // the app added a Tab itself (a Project's setup commands run in a new terminal)
  useEffect(() => api.onLayoutChanged((d) => d === deskId && void api.getLayout(deskId).then(setLayout)), [api, deskId])

  // Whenever the WorkDesk comes on screen: back to the Tab it was left on, or to the Tab of its oldest Signal
  useEffect(() => {
    if (!visible) return
    void Promise.all([api.getLayout(deskId), api.getJumpTarget(deskId)]).then(async ([l, jump]) => {
      setLayout(jump && jump.tabId !== l.activeTabId ? await api.setActiveTab(deskId, jump.tabId) : l)
    })
  }, [api, deskId, visible])

  const activeKind = layout?.tabs.find((t) => t.id === layout.activeTabId)?.kind
  const watchPrs = visible && !parked && desk.branches.length > 0 && activeKind === 'details'
  useEffect(() => {
    if (!watchPrs) return
    // read when the Details come on screen; the answer is kept for five minutes, and the reload icon asks again
    void loadPrs(false)
  }, [watchPrs, loadPrs, branchesKey])

  // The content of a Tab takes the keyboard whenever the Tab or the WorkDesk comes on screen: the pane you were in last,
  // else the first terminal or page. Details and Todos get the focus themselves, so arrow keys scroll them.
  const body = useRef<HTMLDivElement>(null)
  const lastFocus = useRef<Record<string, HTMLElement>>({})
  const shownTabId = layout && !parked ? (layout.tabs.find((t) => t.id === layout.activeTabId) ?? layout.tabs[0])?.id : undefined
  const builtTabs = useRef(new Set<string>())
  const tabTips = useTabHibernation({ deskId, visible: visible && !parked, shownTabId, tabs: layout?.tabs ?? [], onLayout: setLayout })
  useEffect(() => {
    if (!visible || !shownTabId) return
    const raf = requestAnimationFrame(() => {
      const pane = body.current?.querySelector<HTMLElement>(`.tab-pane.on[data-tab="${shownTabId}"]`)
      if (!pane) return
      const remembered = lastFocus.current[shownTabId]
      const target = remembered?.isConnected ? remembered : pane.querySelector<HTMLElement>('.fav-search, .xterm-helper-textarea, webview, .file-pane .native-edit-context, .file-pane .inputarea, .file-focus') ?? (pane.classList.contains('scroll') ? pane : undefined)
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(raf)
  }, [visible, shownTabId])

  const update = useCallback((p: Promise<DeskLayout>) => void p.then(setLayout), [])
  // the Review Tab is a Tab like the others (any place among them, Ctrl+Tab reaches it); Review fills the page while it is the Tab on screen
  const reviewTab = layout?.tabs.find((t) => t.kind === 'review')
  const reviewOpen = !!reviewTab
  const reviewing = !!reviewTab && layout?.activeTabId === reviewTab.id && !parked
  const openReview = () => update(api.openReviewTab(deskId, true))
  const closeReview = () => reviewTab && update(api.closeTab(deskId, reviewTab.id))
  // a Review WorkDesk gets its Review Tab once, and so does a WorkDesk that had the Review open before it was a Tab; closing it is for good
  useEffect(() => {
    if (!layout || parked) return
    const marker = `workdesk.reviewTab.${desk.id}`
    if (remembered(marker)) return
    remember(marker, true)
    let was: string | null = null
    try {
      was = localStorage.getItem(`workdesk.review.${desk.id}`)
    } catch {
      /* not remembered */
    }
    if ((was === '1' || (was === null && (desk.reviews ?? []).length > 0)) && !layout.tabs.some((t) => t.kind === 'review')) update(api.openReviewTab(deskId, false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!layout, parked])

  // is the WorkDesk's VS Code window open: the button says "Open" or "Show"
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorBusy, setEditorBusy] = useState(false)
  useEffect(() => {
    if (!visible || parked) return
    let stop = false
    const look = () => void api.editorIsOpen(deskId).then((o) => !stop && setEditorOpen(o), () => undefined)
    // asking VS Code (through System Events) is not cheap: only while the window has the focus, and not too often
    const off = pollWhileFocused(look, 10_000)
    return () => {
      stop = true
      off()
    }
  }, [api, deskId, visible, parked])
  const openEditor = async () => {
    setEditorBusy(true)
    try {
      await api.editorOpen(deskId)
      setEditorOpen(true)
    } catch {
      // the window did not come up: the button stays
    } finally {
      setEditorBusy(false)
    }
  }

  // Command+arrows: move the focus between the Panes of the Tab on screen (never to another WorkDesk);
  // Command+Shift+arrows: split the Pane that has the focus, after asking what the new Pane shows
  const [picking, setPicking] = useState<{ tabId: string; paneId: string; direction: SplitDirection; before: boolean }>()
  // Command+T: the same question for a new Tab
  const [pickingTab, setPickingTab] = useState(false)
  // finding a file or searching in files, and what to do with the one chosen
  const [finder, setFinder] = useState<{ mode: 'find' | 'search' | 'definition'; then: (path: string, line?: number) => void }>()
  const parkedRef = useRef(parked)
  parkedRef.current = parked
  /** set on every render: closes a Pane the way its close button does */
  const closing = useRef<(tabId: string, paneId: string) => void>(() => undefined)
  useEffect(() => {
    if (!visible) return
    const cellsOnScreen = () => [...document.querySelectorAll<HTMLElement>('.desk-view.on .pane-cell')].filter((c) => c.getBoundingClientRect().width > 0)
    const focusedIndex = (cells: HTMLElement[]) => cells.findIndex((c) => c.contains(document.activeElement))
    const move = (dir: NavDirection) => {
      const cells = cellsOnScreen()
      if (cells.length === 0) return
      const from = focusedIndex(cells)
      const to = from === -1 ? 0 : neighbourPane(cells.map((c) => c.getBoundingClientRect()), from, dir)
      const target = to === undefined ? undefined : cells[to].querySelector<HTMLElement>('.fav-search, .xterm-helper-textarea, webview, .file-pane .native-edit-context, .file-pane .inputarea, .file-focus')
      // WORKDESK_DEBUG_KEYS=1 shows these lines in the terminal the app was started from
      const box = (c: HTMLElement) => { const r = c.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)}` }
      console.debug(`[pane-nav] ${dir} from=${from} to=${to} target=${target?.tagName ?? 'none'} boxes=${cells.map(box).join(' | ')}`)
      target?.focus()
      console.debug(`[pane-nav] focus now in cell ${cellsOnScreen().findIndex((c) => c.contains(document.activeElement))} (${document.activeElement?.tagName})`)
    }
    const split = (s: { direction: SplitDirection; before: boolean }) => {
      const cells = cellsOnScreen()
      const cell = cells[focusedIndex(cells)]
      const paneId = cell?.dataset.paneId
      const tabId = cell?.closest<HTMLElement>('[data-tab]')?.dataset.tab
      if (paneId && tabId) setPicking({ tabId, paneId, ...s })
    }
    const keyLike = (key: string, shiftKey: boolean) => ({ key, shiftKey, metaKey: true, ctrlKey: false, altKey: false })
    const handle = (e: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean => {
      const dir = navDirection(e)
      const sp = splitDirection(e)
      if (!dir && !sp) return false
      if (dir) move(dir)
      else if (sp) split(sp)
      return true
    }
    // when the page itself saw the key (below), the copy the main process sent is not acted on a second time
    let pageSawKeyAt = 0
    /** may a Command+arrow act on the Panes now? Not while a field outside them is typed in, nor while a dialog is open. */
    const mayAct = (): boolean => {
      const here = document.activeElement
      const cells = cellsOnScreen()
      if (focusedIndex(cells) === -1 && here instanceof HTMLElement && (here.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(here.tagName))) return false
      return cells.length > 0 && !document.querySelector('.modal-backdrop')
    }
    const onKey = (e: KeyboardEvent) => {
      if (!navDirection(e) && !splitDirection(e)) return
      pageSawKeyAt = Date.now()
      if (!mayAct()) return
      e.preventDefault()
      // taken before the editor of a File Pane (or anything else in a Pane) can use it for the line start or end
      e.stopPropagation()
      handle(e)
    }
    window.addEventListener('keydown', onKey, true)
    // ⇧⌘F with the keyboard outside a File pane (a terminal, a page): the search of the File pane on screen takes it
    const onSearchKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey || !e.shiftKey || e.key.toLowerCase() !== 'f') return
      if (document.querySelector('.modal-backdrop')) return
      const here = document.activeElement
      if (here instanceof HTMLElement && (here.closest('.file-pane, .files-view') || (/^(INPUT|TEXTAREA|SELECT)$/.test(here.tagName) && !here.closest('.xterm')))) return
      const panes = [...document.querySelectorAll<HTMLElement>('.desk-view.on .file-pane')].filter((c) => c.getBoundingClientRect().width > 0)
      if (panes.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      panes[0].dispatchEvent(new Event(SEARCH_EVENT))
    }
    window.addEventListener('keydown', onSearchKey, true)
    // a page (browser Pane) has the focus: the app hears of the key through the main process
    const offKey = api.onPaneKey((k) => {
      if (!k.fromWindow) {
        if (!document.querySelector('.modal-backdrop')) handle(keyLike(k.key, k.shiftKey))
        return
      }
      // the window's own key, as the main process saw it: acted on only when the page did not get it as well
      const at = Date.now()
      setTimeout(() => {
        if (pageSawKeyAt >= at - 20 || !mayAct()) {
          console.debug(`[pane-nav] ${k.key} from the window not acted on: page saw it=${pageSawKeyAt >= at - 20}, may act=${mayAct()}`)
          return
        }
        handle(keyLike(k.key, k.shiftKey))
      }, 40)
    })
    // Command+W (a menu item, so it also works with a page in focus): close the Pane that has the focus
    const offMenu = api.onMenuAction((a) => {
      if (a === 'new-tab') {
        if (!parkedRef.current) setPickingTab(true)
        return
      }
      if (a === 'definition') {
        if (!parkedRef.current) setFinder({ mode: 'definition', then: (path, line) => openFileRef.current(path, line) })
        return
      }
      if (a === 'reopen-closed') {
        if (!parkedRef.current) update(api.reopenClosed(deskId))
        return
      }
      if (a !== 'close-pane') return
      const cells = cellsOnScreen()
      const cell = cells[focusedIndex(cells)]
      const paneId = cell?.dataset.paneId
      const tabId = cell?.closest<HTMLElement>('[data-tab]')?.dataset.tab
      if (paneId && tabId) closing.current(tabId, paneId)
    })
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keydown', onSearchKey, true)
      offKey()
      offMenu()
    }
  }, [visible, api])

  // the Tabs in the order they were used; while Option+Tab walks through them, they stay as they were when it started
  const recentTabs = useRef<string[]>([])
  const walk = useRef<{ list: string[]; at: number } | undefined>(undefined)
  useEffect(() => {
    if (!layout || walk.current) return
    recentTabs.current = touchRecent(recentTabs.current, layout.activeTabId, layout.tabs.map((t) => t.id))
  }, [layout, layout?.activeTabId])
  // Ctrl+Tab / Ctrl+Shift+Tab: next and previous Tab of the WorkDesk on screen; Opt+Tab / Opt+Shift+Tab: the Tab used before, and further back
  const tabIds = layout ? (parked ? layout.tabs.filter((t) => t.kind === 'details') : layout.tabs).map((t) => ({ id: t.id })) : []
  const activeTabId = layout?.activeTabId ?? ''
  useEffect(() => {
    if (!visible) return
    const switchTo = (id: string) => void api.setActiveTab(deskId, id).then(setLayout)
    const go = (delta: 1 | -1 | 0, recent?: boolean) => {
      if (recent) {
        // Option+Tab: one step back in the order of use per press, until Option is let go
        if (delta === 0) {
          // the Tab the walk ended on is now the one used last
          if (walk.current) recentTabs.current = touchRecent(recentTabs.current, activeTabId, tabIds.map((t) => t.id))
          walk.current = undefined
          return
        }
        const ids = tabIds.map((t) => t.id)
        const w = (walk.current ??= { list: touchRecent(recentTabs.current, activeTabId, ids), at: 0 })
        const step = walkRecent(w.list, w.at, delta)
        if (!step) return
        w.at = step.at
        switchTo(step.id)
        return
      }
      if (delta === 0) return
      const next = cycleTab(tabIds, activeTabId, delta)
      if (next) switchTo(next)
    }
    const onKey = (e: KeyboardEvent) => {
      const recent = recentDelta(e)
      const delta = recent || cycleDelta(e)
      if (delta === 0) return
      e.preventDefault()
      go(delta, recent !== 0)
    }
    const onKeyUp = (e: KeyboardEvent) => e.key === 'Alt' && go(0, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    const off = api.onCycleTab(go)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, deskId, visible, activeTabId, tabIds.map((t) => t.id).join()])

  // what an empty new browser tab offers besides the favorites: the Pull Requests and tickets of this WorkDesk
  const deskLinks: DeskLink[] = []
  const addLink = (l: DeskLink) => deskLinks.some((x) => x.url === l.url) || deskLinks.push(l)
  for (const i of desk.items ?? []) i.url && addLink({ title: i.ticketKey ? `${i.ticketKey} ${i.title}` : i.title, url: i.url, kind: i.kind })
  for (const r of desk.refs ?? []) addLink({ title: refLabel(r), url: r.url, kind: 'page' })
  for (const b of prData?.branches ?? []) for (const pr of b.prs) pr.state === 'open' && addLink({ title: `#${pr.number} ${pr.title}`, url: pr.url, kind: 'pr' })
  // the command palette (Cmd+P) offers, while this WorkDesk is on screen: its tabs, new tabs, and its Pull Requests and tickets
  const live = visible && !parked
  const palette: Command[] = !live
    ? []
    : [
        ...(layout?.tabs ?? []).filter((t) => t.id !== layout?.activeTabId).map((t): Command => ({ id: `tab:${t.id}`, title: `Go to tab ${t.name}`, group: 'Tab', keywords: t.kind, run: () => update(api.setActiveTab(deskId, t.id)) })),
        ...(() => {
          const active = layout?.tabs.find((t) => t.id === layout.activeTabId)
          return active?.kind === 'panes' ? [{ id: 'pin-tab', title: active.pinned ? 'Unpin this tab' : 'Pin this tab', group: 'Tab', keywords: 'icon keep', run: () => update(api.togglePinTab(deskId, active.id)) } as Command] : []
        })(),
        { id: 'new-terminal', title: 'New terminal tab', group: 'Tab', run: () => update(api.addTab(deskId, 'terminal', undefined, scopeCwd)) },
        { id: 'new-browser', title: 'New browser tab', group: 'Tab', run: () => update(api.addTab(deskId, 'browser')) },
        ...(filePanesOf(layout, layout?.activeTabId ?? '').length > 0 ? [{ id: 'file-wrap', title: 'Toggle word wrap in files', group: 'Files', keywords: 'wrap lines editor', run: toggleFileWrap } as Command] : []),
        ...(layout?.tabs.find((t) => t.id === layout.activeTabId)?.kind === 'panes' ? [{ id: 'group-tab', title: 'Put this tab in a group…', group: 'Tab', keywords: 'folder organize list', run: () => setGrouping(layout!.activeTabId) } as Command] : []),
        { id: 'review-mode', title: 'Open Review: what changed in this WorkDesk\'s branches', group: 'Files', keywords: 'review changes diff comments git branch', run: openReview },
        { id: 'find-file', title: 'Find a file…', group: 'Files', keywords: 'fuzzy open quick name', run: () => setFinder({ mode: 'find', then: openFileTab }) },
        { id: 'go-definition', title: 'Go to definition…', group: 'Files', keywords: 'class interface const type function declaration clipboard jump', run: () => setFinder({ mode: 'definition', then: openFileTab }) },
        ...(['usages', 'rename'] as const).filter(() => filePanesOf(layout, layout?.activeTabId ?? '').length > 0).map((mode): Command => ({
          id: `symbol-${mode}`,
          title: mode === 'usages' ? 'Find usages of the name at the cursor…' : 'Rename the symbol at the cursor…',
          group: 'Files',
          keywords: 'references symbol variable function class text based whole word',
          run: () => [...document.querySelectorAll<HTMLElement>('.desk-view.on .file-pane')].find((c) => c.getBoundingClientRect().width > 0)?.dispatchEvent(new CustomEvent<UsagesMode>(USAGES_EVENT, { detail: mode }))
        })),
        { id: 'search-files', title: 'Search in files…', group: 'Files', keywords: 'grep text content find', run: () => setFinder({ mode: 'search', then: openFileTab }) },
        { id: 'new-file', title: 'New file tab', group: 'Tab', keywords: 'editor open file', run: () => update(api.addTab(deskId, 'file')) },
        { id: 'analyse-jwt', title: 'Analyse JWT…', group: 'Files', keywords: 'token decode json web token sd-jwt claims bearer', run: () => setJwt(true) },
        { id: 'new-note', title: 'New note…', group: 'Tab', keywords: 'markdown file notes write', run: () => setNoting(true) },
        { id: 'new-scratch', title: 'New scratch file', group: 'Tab', keywords: 'temporary note text', run: () => void api.filesNewScratch(deskId).then((p) => update(api.addTab(deskId, 'file', p))) },
        { id: 'vscode', title: 'Open VS Code', group: desk.name, keywords: 'editor', run: () => void openEditor() },
        ...deskLinks.map((l): Command => ({ id: `link:${l.url}`, title: `Open ${l.kind === 'pr' ? 'PR' : l.kind === 'page' ? 'page' : 'ticket'} ${l.title}`, group: desk.name, hint: l.url, keywords: l.kind === 'pr' ? 'pull request' : l.kind === 'page' ? 'attached reference' : 'notion', run: () => update(api.addTab(deskId, 'browser', l.url)) }))
      ]
  usePaletteCommands(`desk:${deskId}`, palette)

  // where a file typed into ⌘P is opened; a hook, so before the return below (openFileTab is defined after it)
  const openFileRef = useRef<(path: string, line?: number) => void>(() => undefined)
  // the page of a new file offers the finders as buttons
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ deskId: string; mode: 'find' | 'definition' }>).detail
      if (d.deskId === deskId && !parkedRef.current) setFinder({ mode: d.mode, then: (path, line) => openFileRef.current(path, line) })
    }
    window.addEventListener(FINDER_EVENT, on)
    return () => window.removeEventListener(FINDER_EVENT, on)
  }, [deskId])
  usePaletteFileOpener(`desk:${deskId}`, visible && !parked ? { deskId, open: (path, line) => openFileRef.current(path, line) } : undefined, 2)
  // with several branches, the scope of the files follows the Pane you work in: a terminal that started in a branch, a file of one
  const [fileRoots, setFileRoots] = useState<FileRoot[]>([])
  const liveCwds = useLiveCwds(deskId)
  useOpenRequests(deskId, visible && !parked && !!layout,(path, line) => openFileRef.current(path, line), (tabId) => update(api.setActiveTab(deskId, tabId)))
  useEffect(() => void api.filesRoots(deskId).then(setFileRoots, () => setFileRoots([])), [api, deskId, layout?.tabs.length, desk.branches.length])
  const lastFollowed = useRef<string | undefined>(undefined)
  const followFocus = (paneId: string) => {
    for (const t of layout?.tabs ?? []) {
      if (t.kind !== 'panes') continue
      const node = findPane(t.layout, paneId)
      if (!node) continue
      const where = node?.kind === 'terminal' ? (liveCwds[node.id] ?? node.cwd) : node?.kind === 'file' ? node.path : undefined
      const branch = branchOf(fileRoots, where)
      if (branch) setScope(deskId, branch.path)
      return
    }
  }
  /** the branch a Pane works in: the folder a terminal started in, the folder of its file */
  const paneBranch = (t: Tab, paneId: string): FileRoot | undefined => {
    const node = t.kind === 'panes' ? findPane(t.layout, paneId) : undefined
    // a terminal counts where it is now (it follows `cd`), not where it started
    return branchOf(fileRoots, node?.kind === 'terminal' ? (liveCwds[node.id] ?? node.cwd) : node?.kind === 'file' ? node.path : undefined)
  }
  /** the branch of a Tab when every Pane of it that has one agrees */
  const tabBranch = (t: Tab): FileRoot | undefined => {
    if (t.kind !== 'panes') return undefined
    const found = new Map(paneIds(t.layout).flatMap((id) => { const b = paneBranch(t, id); return b ? [[b.path, b] as const] : [] }))
    return found.size === 1 ? [...found.values()][0] : undefined
  }
  // the list of tabs grouped by branch (only with several branches, and in a list at the side)
  const groupWanted = !!desk.groupTabsByBranch
  const scope = useScope(deskId)
  const branches = branchRoots(fileRoots)
  const groupByBranch = groupWanted && branches.length >= 2 && tabsPos !== 'top'
  /** where a new terminal starts: the folder of the branch in scope, else the folder of the WorkDesk */
  const scopeCwd = branches.length >= 2 && branches.some((r) => r.path === scope) ? scope : undefined
  /** the heading above the first Tab of a branch in the list grouped by branch: its name, the scope it sets, and a fold */
  const branchHeader = (t: Tab, prev: Tab | undefined, key: string | undefined): ReactNode => {
    if (t.kind !== 'panes') return null
    if (t.pinned) return prev && prev.kind === 'panes' && prev.pinned ? null : <div className="tab-group" key="pinned">Pinned</div>
    // the branch of the Tab before it as the list has it, so one that was put there by hand does not start a heading again
    const prevKey = prev && prev.kind === 'panes' && !prev.pinned ? (keyOfTab(prev) ?? 'other') : undefined
    if (key === prevKey) return null
    const root = branches.find((r) => r.path === key)
    const c = root ? branchChip(fileRoots, root) : undefined
    const folded = foldedGroups.has(`branch:${key}`)
    return (
      <div
        className={'tab-group tab-group-fold branch-group' + (key && key === scope ? ' on' : '')}
        key={`branch-${key}`}
        onDragOver={(e) => {
          if (!dragTab) return
          e.preventDefault()
          e.stopPropagation()
        }}
        onDrop={(e) => {
          if (!dragTab) return
          e.preventDefault()
          e.stopPropagation()
          const moving = dragTab
          setDragTab(undefined)
          setDropAt(undefined)
          update(api.setTabBranch(deskId, moving, root?.path ?? ''))
        }}
        title={root ? `${root.label}: hide or show its tabs, and look for files here` : 'Tabs that belong to no branch'}
        // anywhere on the heading: hide or show its tabs, and look for files in this branch
        onClick={() => {
          setFoldedGroups((f) => new Set(f.has(`branch:${key}`) ? [...f].filter((x) => x !== `branch:${key}`) : [...f, `branch:${key}`]))
          if (root) setScope(deskId, root.path)
        }}
      >
        {c && <i className="branch-dot" style={{ background: c.color }} />}
        {c ? c.text : 'Other'}
        <Chevron open={!folded} />
      </div>
    )
  }
  if (!layout) return null
  // links of this WorkDesk open as its own browser Tabs (a parked one has no pages to show: system browser)
  // a parked WorkDesk has no browser tabs to add to: its links open on the Browser page of the app, not in the system browser
  const openLink = parked ? outerOpenLink : (url: string) => update(api.addTab(deskId, 'browser', url))
  const openLinks = parked ? outerOpenLinks : (urls: string[]) => update(api.addBrowserTabs(deskId, urls))
  // a parked WorkDesk has no terminals or editor to show: only its Details
  const tabs = parked ? layout.tabs.filter((t) => t.kind === 'details') : layout.tabs
  const tab = tabs.find((t) => t.id === layout.activeTabId) ?? tabs[0]
  // the tabs as the list shows them: in the order of the layout, or one run per branch
  // what you put under a branch stays there; the rest is sorted by where its files and terminals are
  const keyOfTab = (t: Tab): string | undefined => (t.kind === 'panes' && t.branch && branches.some((r) => r.path === t.branch) ? t.branch : tabBranch(t)?.path)
  /** are the panes of a tab listed under it: all tabs unless folded, or only the active tab unless opened by hand */
  const panesShown = (t: Tab): boolean => (activeOnly ? (t.id === tab.id ? !folded.has(t.id) : opened.has(t.id)) : !folded.has(t.id))
  const togglePanes = (t: Tab): void => {
    const flip = (s: Set<string>) => new Set(s.has(t.id) ? [...s].filter((x) => x !== t.id) : [...s, t.id])
    if (activeOnly && t.id !== tab.id) setOpened(flip)
    else setFolded(flip)
  }
  const shownTabs = groupByBranch ? groupedOrder(tabs, keyOfTab, branches.map((r) => r.path)) : tabs
  /** closes at once unless something other than a shell prompt runs in it; then asks like on quit */
  const askClose = async (tabId: string, paneId?: string) => {
    // a pinned Tab stays: its Panes can be closed, the Tab itself has to be unpinned first
    const asked = layout.tabs.find((x) => x.id === tabId)
    if (asked?.kind === 'panes' && asked.pinned && (!paneId || asked.layout.type === 'pane')) return
    // a File with changes that are not saved: ask; a scratch file that was never written to goes with its Pane
    const files = filePanesOf(layout, tabId, paneId)
    if (files.some((f) => isFileDirty(f.paneId)) && !window.confirm('This file has changes that are not saved. Close it anyway?')) return
    files.forEach((f) => f.path && void api.filesDropEmptyScratch(deskId, f.path).catch(() => undefined))
    const running = await api.tabRunning(deskId, tabId, paneId).catch(() => [] as string[])
    if (running.length === 0) update(paneId ? api.closePane(deskId, tabId, paneId) : api.closeTab(deskId, tabId))
    else setConfirm({ tabId, paneId, running })
  }
  /** A Pane was added to a Tab: show the new layout and put the focus in the new Pane (its terminal or page is made a moment later, so ask a few times). */
  const splitAndFocus = (tabId: string, request: Promise<DeskLayout>) => {
    const before = new Set(paneIdsOf(layout, tabId))
    void request.then((next) => {
      setLayout(next)
      const added = paneIdsOf(next, tabId).find((id) => !before.has(id))
      if (!added) return
      focusPaneSoon(added)
    })
  }
  /** Puts the keyboard in a Pane (its terminal or page is made a moment after a Tab is shown, so ask a few times). */
  const focusPaneSoon = (paneId: string) => {
    let tries = 0
    const look = () => {
      const target = document.querySelector<HTMLElement>(`.desk-view.on .pane-cell[data-pane-id="${paneId}"] :is(.fav-search, .xterm-helper-textarea, webview, .file-pane .native-edit-context, .file-pane .inputarea, .file-focus)`)
      if (target) target.focus()
      else if (++tries < 20) setTimeout(look, 50)
    }
    setTimeout(look, 0)
  }
  /** A file in a File tab (the tab that has it, or a new one), at a line when it is a hit of a search. */
  const openFileTab = (path: string, line?: number) =>
    void api.addTab(deskId, 'file', path).then(async (l) => {
      const tab = l.tabs.find((t) => t.id === l.activeTabId)
      const pane = tab?.kind === 'panes' ? paneIds(tab.layout)[0] : undefined
      setLayout(line && tab && pane ? await api.setFileLocation(deskId, tab.id, pane, path, line) : l)
    })
  openFileRef.current = openFileTab
  /** A click on a Pane in the list of tabs: its Tab is shown and the keyboard goes there. */
  const goToPane = (tabId: string, paneId: string) => void api.setActiveTab(deskId, tabId).then((l) => (setLayout(l), focusPaneSoon(paneId)))
  /** the dragged Tab was dropped on a Pane: its content goes beside / above it */
  const dropTab = (toTabId: string, paneId: string, split: TabSplit) => {
    const moving = dragTab
    setDragTab(undefined)
    setDropAt(undefined)
    if (moving) update(api.mergeTab(deskId, moving, toTabId, paneId, split.direction, split.before))
  }
  /** a dragged Pane was dropped on the edge of another Pane */
  const dropPaneBeside = (toTabId: string, targetPaneId: string, split: TabSplit) => {
    const moving = paneDrag
    setPaneDrag(undefined)
    setPaneOver(undefined)
    if (moving && layout?.tabs.some((t) => t.id === moving.tabId)) update(api.movePaneBeside(deskId, moving.tabId, moving.paneId, toTabId, targetPaneId, split.direction, split.before))
  }
  /** the dialog took the focus: give it back to the Pane it was for */
  const refocus = (paneId: string) => setTimeout(() => document.querySelector<HTMLElement>(`.desk-view.on .pane-cell[data-pane-id="${paneId}"] :is(.fav-search, .xterm-helper-textarea, webview, .file-pane .native-edit-context, .file-pane .inputarea, .file-focus)`)?.focus(), 0)
  closing.current = (tabId, paneId) => {
    const t = layout.tabs.find((x) => x.id === tabId)
    if (t?.kind !== 'panes') return
    // the only Pane of a Tab: closing it closes the Tab, so ask first
    if (t.layout.type === 'pane') void askClose(tabId, paneId)
    else update(api.closePane(deskId, tabId, paneId))
  }
  const confirmTab = confirm && layout.tabs.find((t) => t.id === confirm.tabId)

  return (
    <AttachContext.Provider value={parked ? undefined : attachTargets(desk, state, run)}>
    <DeskLinksContext.Provider value={deskLinks}>
    <OpenLinkContext.Provider value={openLink}>
    <OpenLinksContext.Provider value={openLinks}>
    <div className={'desk-view' + (visible ? ' on' : '') + ' ' + tabsClass(tabsPos)}>
      {plan.length > 0 && !parked && (
        <div className="restack">
          <span title="Rebase them in their folders when you are ready; WorkDesk never does it for you">
            Behind their base: {plan.map((s) => `${s.branch} → ${s.onto}`).join(', ')}
          </span>
        </div>
      )}
      {grouping && layout.tabs.find((t) => t.id === grouping)?.kind === 'panes' && (
        <GroupDialog
          current={(layout.tabs.find((t) => t.id === grouping) as PaneTab).group}
          groups={[...new Set(layout.tabs.flatMap((t) => (t.kind === 'panes' && t.group ? [t.group] : [])))]}
          onCancel={() => setGrouping(undefined)}
          onSave={(name) => (update(api.setTabGroup(deskId, grouping, name)), setGrouping(undefined))}
        />
      )}
      {jwt && <JwtModal deskId={deskId} onClose={() => setJwt(false)} onOpen={(path) => (setJwt(false), update(api.addTab(deskId, 'file', path)))} />}
      {noting && <NewNote deskId={deskId} onClose={() => setNoting(false)} onCreated={(path) => (setNoting(false), update(api.addTab(deskId, 'file', path)))} />}
      {finder && (
        <FileFinder
          deskId={deskId}
          mode={finder.mode}
          onCancel={() => setFinder(undefined)}
          onPick={(path, line) => {
            const then = finder.then
            setFinder(undefined)
            then(path, line)
          }}
        />
      )}
      {pickingTab && (
        <SplitPicker
          title="New Tab"
          onFinder={(mode) => (setPickingTab(false), setFinder({ mode, then: openFileTab }))}
          onCancel={() => setPickingTab(false)}
          onPick={(kind, url) => {
            setPickingTab(false)
            update(api.addTab(deskId, kind, url))
          }}
        />
      )}
      {picking && (
        <SplitPicker
          onFinder={(mode) => {
            const p = picking
            setPicking(undefined)
            setFinder({ mode, then: (path) => splitAndFocus(p.tabId, api.splitPane(deskId, p.tabId, p.paneId, p.direction, 'file', p.before, path)) })
          }}
          onCancel={() => {
            setPicking(undefined)
            refocus(picking.paneId)
          }}
          onPick={(kind, url) => {
            const p = picking
            setPicking(undefined)
            splitAndFocus(p.tabId, api.splitPane(deskId, p.tabId, p.paneId, p.direction, kind, p.before, url))
          }}
        />
      )}
      {confirmTab && (
        <div className="confirm-bar" onKeyDown={(e) => e.key === 'Escape' && setConfirm(undefined)}>
          <span>
            Close the Tab "{confirmTab.name}"? {confirm!.running.join(', ')} {confirm!.running.length === 1 ? 'is' : 'are'} still running in it and will end.
          </span>
          <button
            className="danger"
            autoFocus
            onClick={() => {
              const c = confirm!
              setConfirm(undefined)
              update(c.paneId ? api.closePane(deskId, c.tabId, c.paneId) : api.closeTab(deskId, c.tabId))
            }}
          >
            Close Tab
          </button>
          <button onClick={() => setConfirm(undefined)}>Cancel</button>
        </div>
      )}
      <div className={'tabs-frame' + (reviewing && !parked ? ' reviewing' : '') + (tabsFolded && tabsPos !== 'top' ? ' tabs-folded' : '')}>
      <div
        className={'tabbar' + (paneDrag && paneOver === 'new' ? ' pane-drop-new' : '')}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(PANE_MIME)) return
          e.preventDefault()
          setPaneOver('new')
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setPaneOver(undefined)}
        onDrop={(e) => dropPane(e)}
      >
        <div className="desk-bar">
          <span className="desk-bar-name" title={desk.name}>{desk.name}</span>
          {!parked && (
            <span className="desk-tools">
            {tabsPos !== 'top' && (
              <span className="fold-toggle">
                <IconButton icon="sidebar" primary={tabsFolded} title={tabsFolded ? 'Show the list of tabs' : 'Fold the list of tabs to a strip of icons'} onClick={foldTabs} />
              </span>
            )}
            {tabsPos !== 'top' && (
              <IconButton
                icon="panes"
                primary={activeOnly}
                title={activeOnly ? 'The panes of a tab are listed under the active tab only (click: under every tab)' : 'The panes of a tab are listed under every tab (click: under the active tab only)'}
                onClick={() => (setFolded(new Set()), setOpened(new Set()), setPanesActiveOnly(!activeOnly))}
              />
            )}
            {branches.length >= 2 && tabsPos !== 'top' && (
              <IconButton icon="branches" primary={groupByBranch} title={groupByBranch ? 'Group by branch: on (the list is in runs per branch)' : 'Group the tabs by branch'} onClick={() => void run(() => api.setDeskGroupByBranch(deskId, !groupByBranch))} />
            )}
            </span>
          )}
        </div>
        {shownTabs.map((t, tabIndex) => {
          const renamable = t.kind === 'panes'
          const pinned = t.kind === 'panes' && !!t.pinned
          // in a list of tabs, a Tab with several Panes lists them under it
          const panes = t.kind === 'panes' && tabsPos !== 'top' ? paneSummaries(t) : []
          // a folded group hides its tabs (the one you are in stays)
          const branchKey = groupByBranch && t.kind === 'panes' && !t.pinned ? (keyOfTab(t) ?? 'other') : undefined
          const hiddenByGroup = branchKey !== undefined ? foldedGroups.has(`branch:${branchKey}`) && t.id !== tab.id : tabsPos !== 'top' && t.kind === 'panes' && !t.pinned && !!t.group && foldedGroups.has(t.group) && t.id !== tab.id
          const cls = ['tab', t.id === tab.id ? 'active' : '', pinned ? 'pinned' : '', (t.kind === 'panes' && t.group && !t.pinned) || branchKey !== undefined ? 'grouped' : '', hiddenByGroup ? 'tab-hidden' : '', dragTab === t.id ? 'dragging' : '', isTabHibernated(t) ? 'hibernated' : '']
          if (dragTab && dropAt?.id === t.id && dragTab !== t.id) cls.push(dropAt.after ? 'drop-after' : 'drop-before')
          if (paneDrag && paneOver === t.id && t.kind === 'panes') cls.push('pane-drop')
          return (
            <Fragment key={t.id}>
            {groupByBranch ? branchHeader(t, shownTabs[tabIndex - 1], branchKey) : tabsPos !== 'top' && deskTabHeader(tabs, tabIndex, foldedGroups, (g) => setFoldedGroups((f) => new Set(f.has(g) ? [...f].filter((x) => x !== g) : [...f, g])), groupDnd)}
            <div
              className={cls.filter(Boolean).join(' ')}
              // Details stays in front; every other Tab can be dragged to a new place
              draggable={t.kind !== 'details' && editing !== t.id}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('application/x-workdesk-tab', t.id)
                setDragTab(t.id)
              }}
              onDragOver={(e) => {
                // a dragged Pane goes into this Tab
                if (e.dataTransfer.types.includes(PANE_MIME)) {
                  if (t.kind !== 'panes') return
                  e.preventDefault()
                  e.stopPropagation()
                  setPaneOver(t.id)
                  return
                }
                if (!dragTab || dragTab === t.id) return
                e.preventDefault()
                if (groupOver) setGroupOver(undefined)
                const box = e.currentTarget.getBoundingClientRect()
                setDropAt({ id: t.id, after: tabsPos !== 'top' ? e.clientY > box.top + box.height / 2 : e.clientX > box.left + box.width / 2 })
              }}
              onDrop={(e) => {
                if (e.dataTransfer.types.includes(PANE_MIME)) return t.kind === 'panes' ? dropPane(e, t.id) : undefined
                e.preventDefault()
                const moving = dragTab
                const at = dropAt
                setDragTab(undefined)
                setDropAt(undefined)
                setGroupOver(undefined)
                // in a list by branch: dropped on a tab of another branch it joins that branch, and it lands before or after the tab either way
                if (moving && groupByBranch && moving !== t.id) {
                  const dragged = tabs.find((x) => x.id === moving)
                  const sameBranch = !!dragged && keyOfTab(dragged) === keyOfTab(t)
                  update(
                    (async () => {
                      if (!sameBranch) await api.setTabBranch(deskId, moving, keyOfTab(t) ?? '')
                      return api.moveTab(deskId, moving, t.id, at?.after ?? false, true)
                    })()
                  )
                } else if (moving && at && moving !== t.id) update(api.moveTab(deskId, moving, t.id, at.after))
              }}
              onDragEnd={() => (setDragTab(undefined), setDropAt(undefined), setGroupOver(undefined))}
              onMouseEnter={() => tabTips.hover(t.id)}
              title={pinned ? `${t.name} (pinned: unpin it to close it)` : isTabHibernated(t) ? ['Hibernated: its page is unloaded', tabTips.tip(t.id)].filter(Boolean).join('. ') : tabTips.tip(t.id) ?? (renamable ? 'Double-click to set an alias for this tab' : undefined)}
              onContextMenu={(e) => t.kind === 'panes' && (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, tabId: t.id }))}
              // the middle mouse button closes a Tab, asking only when something runs in it
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onAuxClick={(e) => {
                if (e.button !== 1 || t.kind !== 'panes' || pinned) return
                e.preventDefault()
                void askClose(t.id)
              }}
              // a click on another tab shows it; a click on the active one hides or shows its panes in the list (when it has several)
              onClick={() => (t.id !== tab.id ? update(api.setActiveTab(deskId, t.id)) : panes.length > 1 && togglePanes(t))}
              onDoubleClick={() => renamable && !pinned && setEditing(t.id)}
            >
              {editing === t.id ? (
                <input
                  autoFocus
                  defaultValue={t.name}
                  onFocus={(e) => e.target.select()}
                  onClick={(e) => e.stopPropagation()}
                  placeholder={t.kind === 'panes' && t.autoName ? 'page title' : undefined}
                  onBlur={(e) => {
                    setEditing(undefined)
                    const v = e.target.value.trim()
                    // an empty name is only allowed on Browser Tabs, where it means "follow the page title"
                    if (v !== t.name && (v || (t.kind === 'panes' && t.layout.type === 'pane' && t.layout.kind === 'browser'))) update(api.renameTab(deskId, t.id, v))
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setEditing(undefined)
                  }}
                />
              ) : (
                pinned ? (
                  // pinned: only the icon of what it shows (the name is its tooltip)
                  <>
                    <span className="pin-icon">{singleBrowserFavicon(t) ? <img className="tab-icon" src={singleBrowserFavicon(t)} alt="" width={14} height={14} /> : ICONS[tabIcon(t)]}</span>
                    <span className="tab-label">{tabsPos !== 'top' && t.kind === 'panes' ? fullTabName(t) : t.name}</span>
                  </>
                ) : (
                  <>
                    {t.kind === 'panes' && singleBrowserFavicon(t) && <img className="tab-icon" src={singleBrowserFavicon(t)} alt="" width={14} height={14} />}
                    {/* a tab with a terminal in it (a page's own icon comes first) */}
                    {t.kind === 'review' && <span className="tab-term" title="Review">{ICONS.review}</span>}
                    {t.kind === 'panes' && !singleBrowserFavicon(t) && paneSummaries(t).some((p) => p.kind === 'terminal') && <span className="tab-term" title="Terminal">{ICONS.terminal}</span>}
                    <span className="tab-initial" aria-hidden>{(t.kind === 'details' ? desk.name : t.name).trim().slice(0, 2)}</span>
                    <span>{tabsPos !== 'top' && t.kind === 'panes' ? fullTabName(t) : t.name}</span>
                  </>
                )
              )}
              {panes.length > 1 && (
                <button
                  className="tab-fold"
                  title={panesShown(t) ? 'Hide its panes' : 'Show its panes'}
                  onClick={(e) => (e.stopPropagation(), togglePanes(t))}
                >
                  {panesShown(t) ? '▾' : '▸'}
                </button>
              )}
              {t.kind === 'review' && (
                <button className="x" title="Close the Review tab" onClick={(e) => (e.stopPropagation(), closeReview())}>
                  ×
                </button>
              )}
              {t.kind === 'panes' && !pinned && (
                <button
                  className="x"
                  onClick={(e) => {
                    e.stopPropagation()
                    void askClose(t.id)
                  }}
                >
                  ×
                </button>
              )}
            </div>
            {panes.length > 1 && panesShown(t) && !hiddenByGroup && (
              <div className="tab-panes">
                {panes.map((p) => (
                  <div key={p.paneId} className={'tab-pane-item' + (t.id === tab.id && p.paneId === focusedPane ? ' on' : '')} title={(p.kind === 'terminal' ? termTitles[p.paneId] : undefined) ?? p.label} onClick={() => goToPane(t.id, p.paneId)}>
                    <span className="pin-icon">{p.favicon ? <img className="pane-favicon" src={p.favicon} alt="" width={11} height={11} onError={(e) => (e.currentTarget.style.display = 'none')} /> : ICONS[p.kind === 'browser' ? 'globe' : p.kind]}</span>
                    <span className="tab-pane-label">{p.kind === 'terminal' && termTitles[p.paneId] ? listTitle(termTitles[p.paneId]) : p.label}</span>
                    <button className="x" title="Close this pane" onClick={(e) => (e.stopPropagation(), void askClose(t.id, p.paneId))}>×</button>
                  </div>
                ))}
              </div>
            )}
            </Fragment>
          )
        })}
        {/* new terminal, browser and file Tab and VS Code (grouped, so a list of tabs at the side can put them below the list) */}
        <div className="tab-actions">
        {!parked && (
          <>
            <IconButton icon="terminal" title="New terminal Tab" onClick={() => update(api.addTab(deskId, 'terminal', undefined, scopeCwd))} />
            <IconButton icon="globe" title="New browser Tab" onClick={() => update(api.addTab(deskId, 'browser'))} />
            <IconButton icon="file" title="New file Tab: a file or a scratch file" onClick={() => update(api.addTab(deskId, 'file'))} />
            <IconButton icon="review" primary={reviewing} title="Review: what changed in this WorkDesk's branches, with the diff and comments, as a tab" onClick={openReview} />
            <IconButton
              icon="code"
              primary={editorOpen}
              disabled={editorBusy}
              title={editorBusy ? 'Opening VS Code…' : editorOpen ? "Show VS Code: bring this WorkDesk's window to the front; the other WorkDesks' windows are minimised" : "Open VS Code: this WorkDesk's folders in VS Code; the other WorkDesks' windows are minimised"}
              onClick={() => void openEditor()}
            />
          </>
        )}
        </div>
      </div>
      <Resizer size={PANEL_SIZES.tabs} min={120} max={480} edge={tabsPos === 'right' ? 'left' : 'right'} panel={(h) => h.parentElement?.querySelector<HTMLElement>(':scope > .tabbar')} className="tabs-resizer" />
      <div
        className="tab-body"
        ref={body}
        onFocusCapture={(e) => {
          // remember where you were in each Tab
          const id = (e.target as HTMLElement).closest<HTMLElement>('.tab-pane')?.dataset.tab
          if (id) lastFocus.current[id] = e.target as HTMLElement
          // which Pane has it, for the list of tabs
          const pane = (e.target as HTMLElement).closest<HTMLElement>('.pane-cell')?.dataset.paneId
          if (pane) {
            setFocusedPane(pane)
            // the scope follows you to another Pane, not a click in the tree or the switcher of the one you are in (that would undo your choice)
            if (pane !== lastFollowed.current && !(e.target as HTMLElement).closest('.file-side')) {
              lastFollowed.current = pane
              followFocus(pane)
            }
          }
        }}
      >
        {tabs.map((t) => {
          const on = visible && t.id === tab.id
          if (t.kind === 'details') {
            return on ? (
              <div key={t.id} data-tab={t.id} tabIndex={-1} className="tab-pane on scroll">
                <DetailsPane desk={desk} state={state} run={run} onClear={onClear} onCombine={onCombine} prs={prData} onRefreshPrs={() => loadPrs(true)} />
              </div>
            ) : null
          }
          // the Review Tab's page is Review itself, below
          if (t.kind === 'review') return null
          // terminals and pages stay mounted when their Tab or WorkDesk is hidden, so nothing is lost; pages and editors are
          // built only when their Tab is first shown (a Tab with a terminal at once: what starts in it must run)
          if (on) builtTabs.current.add(t.id)
          if (buildsOnFirstShow(t) && !builtTabs.current.has(t.id)) return null
          return (
            <div key={t.id} data-tab={t.id} className={'tab-pane' + (on ? ' on' : '')}>
              <TabDragContext.Provider value={{ dragging: on ? dragTab : undefined, drop: dropTab, pane: on ? paneDrag : undefined, dropPane: dropPaneBeside }}>
              <TerminalActiveContext.Provider value={on}>
                <LayoutView
                  deskId={deskId}
                  tabId={t.id}
                  node={t.layout}
                  onSplit={(paneId, dir: SplitDirection, kind) => splitAndFocus(t.id, api.splitPane(deskId, t.id, paneId, dir, kind))}
                  onClose={(paneId) =>
                    // the only Pane of a Tab: closing it closes the Tab, so ask first
                    t.layout.type === 'pane' ? void askClose(t.id, paneId) : update(api.closePane(deskId, t.id, paneId))
                  }
                  onLayout={setLayout}
                />
              </TerminalActiveContext.Provider>
              </TabDragContext.Provider>
            </div>
          )
        })}
      </div>
      {reviewOpen && !parked && (
        <div className="review-host" style={{ display: reviewing ? 'flex' : 'none', flex: 1, minHeight: 0, minWidth: 0 }}>
          <ReviewMode deskId={deskId} roots={fileRoots} onExit={closeReview} onOpenFile={(path, line) => openFileTab(path, line)} />
        </div>
      )}
      </div>
    </div>
      {menu && (() => {
        const target = layout.tabs.find((t) => t.id === menu.tabId)
        if (!target) return null
        const asleep = isTabHibernated(target)
        return (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(undefined)}
            items={[
              ...(target.kind === 'panes' && !target.pinned ? [{ label: 'Set tab alias…', onClick: () => setEditing(target.id) }] : []),
              ...(hasPages(target) ? [{ label: 'Duplicate', onClick: () => update(api.duplicateTab(deskId, target.id)) }] : []),
              ...(groupByBranch && target.kind === 'panes' && !target.pinned
                ? [
                    ...branches.map((r) => ({ label: `List under ${branchChip(fileRoots, r).text}`, onClick: () => update(api.setTabBranch(deskId, target.id, r.path)) })),
                    ...(target.branch ? [{ label: 'List in its own branch again', onClick: () => update(api.setTabBranch(deskId, target.id, '')) }] : [])
                  ]
                : []),
              ...(target.kind === 'panes' && !target.pinned ? [{ label: target.group ? `Group (${target.group})…` : 'Add to a group…', onClick: () => setGrouping(target.id) }] : []),
              target.kind === 'panes' ? { label: target.pinned ? 'Unpin' : 'Pin', onClick: () => update(api.togglePinTab(deskId, target.id)) } : { label: 'Pin', disabled: true, onClick: () => undefined },
              hasPages(target)
                ? { label: asleep ? 'Wake up' : 'Hibernate', onClick: () => update(api.hibernateTab(deskId, target.id, !asleep)) }
                : { label: 'Hibernate', disabled: true, why: 'Only pages can be hibernated; the shell of a terminal keeps running', onClick: () => undefined }
            ]}
          />
        )
      })()}
    </OpenLinksContext.Provider>
    </OpenLinkContext.Provider>
    </DeskLinksContext.Provider>
    </AttachContext.Provider>
  )
}
