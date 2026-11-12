import { isoWeek } from '../main/domain/time-tracking'
import { PerformanceView } from './PerformanceView'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppState } from '../shared/api'
import { deskAtShortcut } from '../main/domain/navigation'
import { PostponeDialog } from './PostponeDialog'
import { sectionOf, sidebarOrder } from '../main/domain/order'
import { closableDeskIds } from '../main/domain/closable'
import { useLivePrStates } from './PrStates'
import { openSignals } from '../main/domain/signal'
import { missingRequired, type ToolCheck } from '../main/tools-shared'
import { Dashboard } from './Dashboard'
import { TimeView } from './TimeView'
import { DeskPrsView } from './DeskPrsView'
import { OrchestratorView } from './OrchestratorView'
import { CombineDesks } from './CombineDesks'
import { WaitingModal } from './WaitingModal'
import { isWaitingSkipped, waitingPolicy } from './waiting-policy'
import { enteredWaiting } from '../main/domain/waiting'
import type { DeskRunning } from '../main/park-all'
import type { WorkDesk } from '../main/domain/types'
import { NewNote } from './NewNote'
import { JwtModal } from './JwtModal'
import { GO_TIME_EVENT } from './TimeSpent'
import { DeskView } from './DeskView'
import { ClearDialog } from './ClearDialog'
import { OpenLinkContext, OpenLinksContext } from './OpenLink'
import { PrStatesProvider } from './PrStates'
import { ParkAllDialog } from './ParkAllDialog'
import { BrowserView } from './BrowserView'
import { closeFilesTab, FilesView } from './FilesView'
import { currentFileTabs, fileTabs } from './file-tabs'
import { PANEL_SIZES, Resizer } from './Resizer'
import { FileFinder } from './FileFinder'
import { GLOBAL_DESK } from '../main/domain/file-tabs'
import { currentPageTabs, pageTabs, reloadShownPage, toggleShownPageDevTools, usePageTabs } from './browser-tabs'
import './pane-controls'
import { tabLabel } from '../main/domain/browser-tabs'
import { samePage } from '../main/domain/url'
import { WorkItemsPage, type WorkTab } from './WorkItemsPage'
import { useSortable } from './useSortable'
import { Sidebar } from './Sidebar'
import { ActivityFeed } from './ActivityFeed'
import { UsageMeter } from './UsageMeter'
import type { SidebarPanels } from '../main/quit'
import type { PinnedTab } from '../main/domain/layout'
import { SideSection } from './SideSection'
import { deskOfPage } from '../main/domain/time-tracking'
import { PerformanceMeter } from './PerformanceMeter'
import { Palette } from './Palette'
import { SearchAll } from './SearchAll'
import { requestOpen } from './open-requests'
import { deskPaletteActions } from './desk-actions'
import { JumpTo } from './JumpTo'
import { deskJumpItems, fileJumpItems, pageJumpItems, type JumpItem } from './jump-to'
import { usePaletteCommands, usePaletteFileOpener, type Command } from './command-palette'
import { useBookmarks } from './Bookmarks'
import { SettingsView, SECTIONS, type SettingsSection } from './SettingsView'
import { TodoDetail } from './TodoDetail'
import { StartPanel } from './StartPanel'
import { CaptureTodo } from './CaptureTodo'
import { useTemplates } from './TemplatesSettings'
import { SaveTemplateDialog } from './SaveTemplateDialog'
import { whatNext } from '../main/domain/what-next'
import { ICONS } from './Icons'
import { RefreshButton } from './RefreshButton'
import { ProfileSelector } from './ProfileSelector'
import { defaultConfig, filterState, signalCounts, type ProfilesConfig } from '../main/domain/profiles'
import './app.css'

type Page = { kind: 'dashboard' } | { kind: 'desk-prs' } | { kind: 'work'; tab: WorkTab; focus?: { project: string; branch: string } } | { kind: 'performance' } | { kind: 'settings'; section: SettingsSection } | { kind: 'browser' } | { kind: 'files' } | { kind: 'time' } | { kind: 'orchestrator' } | { kind: 'desk'; id: string }
/** A Todo is opened from a page and goes back to it */
type Selection = Page | { kind: 'todo'; id: string; back: Page }

/** The time of day, to the minute, in the left panel's header. */
function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(t)
  }, [])
  return <span className="nav-clock" title={`${now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · week ${isoWeek(now)}`}>{now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
}

export function App() {
  // everything of every Profile (the WorkDesks keep running whichever Profile is in view) and the Profile in view
  const [full, setState] = useState<AppState>({ todos: [], desks: [] })
  const [pcfg, setPcfg] = useState<ProfilesConfig>(defaultConfig())
  // what the sidebar, Dashboard, Work items, palette and search show
  const state = useMemo(() => filterState(full, pcfg.active, pcfg), [full, pcfg])
  // the WorkDesks of the Profile in view that run / are parked: what the menu and ⌘P "Park all" and "Reactivate all" act on (never another Profile's)
  const viewDesksRef = useRef(state.desks)
  viewDesksRef.current = state.desks
  const runningIds = () => viewDesksRef.current.filter((d) => d.presence !== 'parked' && d.presence !== 'planned').map((d) => d.id)
  const parkedIds = () => viewDesksRef.current.filter((d) => d.presence === 'parked').map((d) => d.id)
  const signalsPerProfile = useMemo(() => signalCounts(full.desks, pcfg), [full.desks, pcfg])
  const [selection, setSelection] = useState<Selection>({ kind: 'dashboard' })
  // the whole side panel can be hidden (⌘\); kept on this machine
  // WorkDesks that just moved to Waiting and are asked about (a park, or keep it active)
  const [waitingAsk, setWaitingAsk] = useState<{ desk: WorkDesk; running?: DeskRunning }[]>([])
  const prevDesks = useRef<WorkDesk[] | undefined>(undefined)
  const [noteOnFiles, setNoteOnFiles] = useState(false)
  const [jwtOnFiles, setJwtOnFiles] = useState(false)
  const [navHidden, setNavHiddenState] = useState(() => {
    try {
      return localStorage.getItem('workdesk.navHidden') === '1'
    } catch {
      return false
    }
  })
  const setNavHidden = useCallback((hidden: boolean) => {
    setNavHiddenState(hidden)
    try {
      localStorage.setItem('workdesk.navHidden', hidden ? '1' : '0')
    } catch {
      /* not remembered */
    }
  }, [])
  // the tab the Work Items were left on
  const [workTab, setWorkTab] = useState<WorkTab>('todos')
  const [error, setError] = useState<string>()
  // which parts at the bottom of the left panel are open; kept by the main process, which stops what a closed part watches
  const [panels, setPanels] = useState<SidebarPanels>()
  useEffect(() => void window.workdesk.panelsGet().then(setPanels), [])
  const togglePanel = (key: keyof SidebarPanels) => (open: boolean) => {
    setPanels((p) => p && { ...p, [key]: open })
    void window.workdesk.panelsSet({ [key]: open }).then(setPanels)
  }
  const [missing, setMissing] = useState<ToolCheck[]>([])
  const [clearing, setClearing] = useState<string>()
  // WorkDesks that are being cleared in the background: shown with a spinner, not to be opened
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(new Set())
  // the WorkDesk that takes another one in
  const [combining, setCombining] = useState<string>()
  // the WorkDesks everything of which is done: the pull requests merged or closed, the Todos resolved
  const livePrs = useLivePrStates()
  const closable = useMemo(() => closableDeskIds(state.desks, state.todos, livePrs), [state.desks, state.todos, livePrs])
  // "Park all" of a section of the left panel: only these WorkDesks
  const [parkingWaiting, setParkingWaiting] = useState<string[]>()
  // the WorkDesk the time to postpone it to is asked for
  const [postponing, setPostponing] = useState<string>()
  const [capturing, setCapturing] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState<string>()
  const templates = useTemplates()
  // a postponement ends by itself: look again now and then
  const [, setTick] = useState(0)
  // the box on a WorkDesk's Details page offers the Time page
  useEffect(() => {
    const go = () => setSelection({ kind: 'time' })
    window.addEventListener(GO_TIME_EVENT, go)
    return () => window.removeEventListener(GO_TIME_EVENT, go)
  }, [])
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
  const [adding, setAdding] = useState(false)
  const [palette, setPalette] = useState(false)
  const [jumping, setJumping] = useState(false)
  const [searchingAll, setSearchingAll] = useState(false)
  // finding a file or searching in files on the Files page
  const [fileFinder, setFileFinder] = useState<'find' | 'search' | 'definition'>()
  // the pinned Tabs of the WorkDesks, listed under them in the left panel
  const [pins, setPins] = useState<Record<string, PinnedTab[]>>({})
  useEffect(() => {
    void window.workdesk.pinnedTabs().then(setPins)
    return window.workdesk.onPinnedTabs(setPins)
  }, [])
  // WorkDesks opened once stay mounted, hidden, so their pages and terminals keep running
  // the Browser's pages load when it is first opened, and stay while another page is shown
  const [browserOpened, setBrowserOpened] = useState(false)
  // the Files page is made when it is first opened, and stays while another page is shown (its editors keep their cursor and changes)
  const [filesOpened, setFilesOpened] = useState(false)
  const pageTabsState = usePageTabs()
  const pageTabsAll = pageTabsState.tabs
  const pinned = pageTabsAll.filter((t) => t.pinned)
  // the pinned icons can be sorted by dragging (the Browser page shows the same order)
  const pinSort = useSortable(pageTabs.move)
  const [visited, setVisited] = useState<string[]>([])
  const selectionRef = useRef(selection)
  selectionRef.current = selection

  useEffect(() => {
    void window.workdesk.profilesState().then((s) => setPcfg(s.config))
    return window.workdesk.onProfilesChanged(setPcfg)
  }, [])
  const pickProfile = (view: string) =>
    void window.workdesk.profilesSetActive(view).then((s) => {
      setPcfg(s.config)
      // a WorkDesk or Todo of the Profile that was left is not in the new view
      const sel = selectionRef.current
      const inNew = (id: string, list: { id: string }[]) => list.some((x) => x.id === id)
      const next = filterState(full, s.config.active, s.config)
      if ((sel.kind === 'desk' && !inNew(sel.id, next.desks)) || (sel.kind === 'todo' && !inNew(sel.id, next.todos))) setSelection({ kind: 'dashboard' })
    })

  useEffect(() => {
    void window.workdesk.getState().then(setState)
    void window.workdesk.checkTools().then((c) => setMissing(missingRequired(c)))
    const offState = window.workdesk.onStateChanged(setState)
    const offMenu = window.workdesk.onMenuAction((a) => {
      if (a === 'park-all') setParkingWaiting(runningIds())
      else if (a === 'capture-todo') setCapturing(true)
      else if (a.startsWith('open-desk:')) selectDeskRef.current(a.slice('open-desk:'.length))
      else if (a === 'what-next') setSelection({ kind: 'dashboard' })
      else if (a === 'reload-page') reloadShownPage()
      else if (a === 'page-devtools') toggleShownPageDevTools()
      else if (a === 'palette') setPalette((p) => !p)
      else if (a === 'definition' && selectionRef.current.kind === 'files') setFileFinder('definition')
      else if (a === 'reactivate-all') void reactivateAllRef.current(parkedIds())
      // Command+T on the Browser page: a new page tab (in a WorkDesk, its own view asks what to open)
      else if (a === 'new-tab' && selectionRef.current.kind === 'browser') pageTabs.open()
      // the same on the Files page, where ⌘W closes the tab
      else if (a === 'new-tab' && selectionRef.current.kind === 'files') fileTabs.new()
      else if (a === 'close-pane' && selectionRef.current.kind === 'files') {
        const { tabs, active } = currentFileTabs()
        const tab = tabs.find((t) => t.id === active)
        if (tab) closeFilesTab(tab)
      }
    })
    return () => (offState(), offMenu())
  }, [])

  const run = useCallback(async (action: () => Promise<AppState>) => {
    try {
      setState(await action())
      setError(undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    }
  }, [])

  // a running WorkDesk moved to Waiting: park it, ask, or leave it, as the setting says
  useEffect(() => {
    const before = prevDesks.current
    prevDesks.current = state.desks
    if (!before) return
    // not the WorkDesk you are working in, and not one you said to leave alone
    const here = selectionRef.current.kind === 'desk' ? selectionRef.current.id : undefined
    const moved = enteredWaiting(before, state.desks).filter((d) => d.id !== here && !isWaitingSkipped(d.id))
    if (moved.length === 0) return
    const policy = waitingPolicy()
    if (policy === 'keep') return
    void (async () => {
      const api = window.workdesk
      const asks: { desk: WorkDesk; running?: DeskRunning }[] = []
      for (const desk of moved) {
        const running = (await api.parkAllPreflight([desk.id]).catch(() => []))[0]
        // parked without a question only when nothing would be lost: no program but a shell, no Claude that cannot be resumed
        if (policy === 'park' && running && running.programs.length === 0 && running.claudeWithoutSession === 0) await run(() => api.parkDesk(desk.id))
        else asks.push({ desk, running })
      }
      if (asks.length > 0) setWaitingAsk((q) => [...q, ...asks.filter((a) => !q.some((x) => x.desk.id === a.desk.id))])
    })()
  }, [state.desks, run])

  const openTodo = useCallback((id: string) => setSelection((cur) => (cur.kind === 'todo' ? cur : { kind: 'todo', id, back: cur })), [])


  const reactivateAll = useCallback(async (ids?: string[]) => {
    try {
      const { state: next, opened } = await window.workdesk.reactivateAll(ids)
      setState(next)
      if (opened) selectDeskRef.current(opened)
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    }
  }, [])
  const reactivateAllRef = useRef(reactivateAll)
  reactivateAllRef.current = reactivateAll

  const deletingRef = useRef(deleting)
  deletingRef.current = deleting
  const selectDesk = useCallback(
    (id: string) => {
      if (deletingRef.current.has(id)) return
      setSelection({ kind: 'desk', id })
      setVisited((v) => (v.includes(id) ? v : [...v, id]))
      // a parked WorkDesk only shows its Details; it is reactivated from there
      const presence = full.desks.find((d) => d.id === id)?.presence
      if (presence !== 'parked' && presence !== 'planned') void run(() => window.workdesk.activateDesk(id))
    },
    [run, full.desks]
  )

  // a file or a terminal of any WorkDesk (palette, search over all WorkDesks): go to the WorkDesk, the view opens it once it is shown
  const openInDesk = useCallback((deskId: string, path: string, line?: number) => {
    requestOpen(deskId, { kind: 'file', path, line })
    selectDeskRef.current(deskId)
  }, [])
  const openTabInDesk = useCallback((deskId: string, tabId: string) => {
    requestOpen(deskId, { kind: 'tab', tabId })
    selectDeskRef.current(deskId)
  }, [])
  // the time tracking counts the WorkDesk on screen
  // (a page of the Browser that a WorkDesk holds, a pull request it reviews or a page attached to it, counts for that WorkDesk)
  const browserUrl = selection.kind === 'browser' ? pageTabsAll.find((t) => t.id === pageTabsState.active)?.url : undefined
  const shownDesk = selection.kind === 'desk' ? selection.id : browserUrl ? deskOfPage(full.desks, browserUrl) : undefined
  useEffect(() => window.workdesk.timeShown(shownDesk), [shownDesk])

  /** Outside a WorkDesk (the dashboard, the pull request and Notion pages) a link opens as a page of the Browser, never in the system browser. */
  const openUrls = useCallback((urls: string[]) => {
    for (const url of urls) pageTabs.open(url)
    setBrowserOpened(true)
    setSelection({ kind: 'browser' })
  }, [])
  const openInBrowser = useCallback((url: string) => openUrls([url]), [openUrls])
  const openAllInBrowser = openUrls

  // the command palette (Cmd+P): what is possible everywhere; the WorkDesk on screen adds its own
  const favorites = useBookmarks()
  const inDesk = selection.kind === 'desk'
  const nextCount = whatNext(state.todos, state.desks, Date.now(), closable).filter((i) => i.kind !== 'postponed' || i.due).length
  const WORK_TABS: { tab: WorkTab; label: string }[] = [{ tab: 'todos', label: 'Todos' }, { tab: 'prs', label: 'Pull requests' }, { tab: 'notion', label: 'Notion tickets' }, { tab: 'branches', label: 'Branches' }, { tab: 'archive', label: 'Archive' }]
  const appCommands: Command[] = [
    { id: 'go-dashboard', title: 'Go to Dashboard', group: 'Go to', keywords: 'home overview', run: () => setSelection({ kind: 'dashboard' }) },
    { id: 'go-desk-prs', title: 'Go to Pull requests in WorkDesks', group: 'Go to', keywords: 'pr review github', run: () => setSelection({ kind: 'desk-prs' }) },
    ...WORK_TABS.map((w): Command => ({ id: `go-work-${w.tab}`, title: `Go to Work items: ${w.label}`, group: 'Go to', run: () => (setWorkTab(w.tab), setSelection({ kind: 'work', tab: w.tab })) })),
    { id: 'go-next', title: 'Go to What next? (on the Dashboard)', group: 'Go to', keywords: 'todos signals due postponed overview', run: () => setSelection({ kind: 'dashboard' }) },
    ...templates.map((t): Command => ({
      id: `template-${t.id}`,
      title: `New WorkDesk from template: ${t.name}`,
      group: 'Todos',
      keywords: 'preset checklist panes',
      run: () => void window.workdesk.startTemplateDesk(t.id, '').then((s) => (setState(s), selectDesk(s.desks[s.desks.length - 1].id)), (e) => setError(String(e instanceof Error ? e.message : e)))
    })),
    { id: 'repeat-template', title: 'Repeat a WorkDesk template…', group: 'Todos', keywords: 'schedule recurring daily weekly repeating', run: () => setSelection({ kind: 'settings', section: 'repeating' }) },
    { id: 'capture-todo', title: 'Capture a Todo…', group: 'Todos', keywords: 'add new todo quick', run: () => setCapturing(true) },
    { id: 'jump-to', title: 'Jump to…', group: 'Go to', keywords: 'switch open tab page file workdesk find', run: () => setJumping(true) },
    { id: 'go-browser', title: 'Go to Browser', group: 'Go to', run: () => (setBrowserOpened(true), setSelection({ kind: 'browser' })) },
    { id: 'go-orchestrator', title: 'Go to Orchestrator', group: 'Go to', keywords: 'claude automation agents', run: () => setSelection({ kind: 'orchestrator' }) },
    { id: 'go-time', title: 'Go to Time: this week', group: 'Go to', keywords: 'hours worked tracking week', run: () => setSelection({ kind: 'time' }) },
    { id: 'go-files', title: 'Go to Files', group: 'Go to', keywords: 'editor notes knowledge scratch', run: () => (setFilesOpened(true), setSelection({ kind: 'files' })) },
    { id: 'files-find', title: 'Find a file on the Files page…', group: 'Files', keywords: 'fuzzy open quick name knowledge notes', run: () => setFileFinder('find') },
    { id: 'files-definition', title: 'Go to definition on the Files page…', group: 'Files', keywords: 'class interface const type function declaration clipboard jump', run: () => setFileFinder('definition') },
    { id: 'files-search', title: 'Search in files on the Files page…', group: 'Files', keywords: 'grep text content knowledge notes', run: () => setFileFinder('search') },
    { id: 'files-jwt', title: 'Analyse JWT on the Files page…', group: 'Files', keywords: 'token decode json web token sd-jwt claims bearer', run: () => setJwtOnFiles(true) },
    { id: 'files-note', title: 'New note on the Files page…', group: 'Files', keywords: 'markdown notes knowledge write', run: () => setNoteOnFiles(true) },
    { id: 'files-scratch', title: 'New scratch file on the Files page', group: 'Files', keywords: 'note temporary', run: () => void window.workdesk.filesNewScratch(GLOBAL_DESK).then((p) => (fileTabs.open(p), setFilesOpened(true), setSelection({ kind: 'files' }))) },
    { id: 'toggle-sidebar', title: navHidden ? 'Show the side panel' : 'Hide the side panel', group: 'View', keywords: 'sidebar nav collapse left panel', run: () => setNavHidden(!navHidden) },
    { id: 'go-performance', title: 'Go to Performance', group: 'Go to', keywords: 'memory cpu', run: () => setSelection({ kind: 'performance' }) },
    ...SECTIONS.map((s): Command => ({ id: `go-settings-${s.id}`, title: `Open Settings: ${s.label}`, group: 'Settings', run: () => setSelection({ kind: 'settings', section: s.id }) })),
    ...sidebarOrder(state.desks, closable).map(({ desk: d }): Command => ({ id: `desk-${d.id}`, title: `Switch to WorkDesk ${d.name}`, group: d.presence === 'active' ? 'WorkDesk' : `WorkDesk (${d.presence})`, run: () => selectDeskRef.current(d.id) })),
    { id: 'add-desk', title: 'Add an empty WorkDesk', group: 'WorkDesk', run: () => setAdding(true) },
    { id: 'search-all', title: 'Search all WorkDesks…', group: 'Go to', keywords: 'find files text grep terminal output tmux every desk workspace', run: () => setSearchingAll(true) },
    ...deskPaletteActions(selection.kind === 'desk' ? state.desks.find((d) => d.id === selection.id) : undefined, {
      park: (id) => void run(() => window.workdesk.parkDesk(id)),
      reactivate: (id) => void run(async () => (await window.workdesk.reactivateDesk(id), window.workdesk.activateDesk(id))),
      postpone: setPostponing,
      bringBack: (id) => void run(() => window.workdesk.postponeDesk(id, null)),
      groupByBranch: (id, on) => void run(() => window.workdesk.setDeskGroupByBranch(id, on)),
      combine: setCombining
    }),
    ...(state.desks.some((d) => d.presence === 'active') ? [{ id: 'park-all', title: 'Park all WorkDesks', group: 'WorkDesk', run: () => setParkingWaiting(runningIds()) }] : []),
    ...(state.desks.some((d) => d.presence === 'parked') ? [{ id: 'reactivate-all', title: 'Reactivate all parked WorkDesks', group: 'WorkDesk', run: () => void reactivateAllRef.current(parkedIds()) }] : []),
    { id: 'reload-page', title: 'Reload the page that is shown', group: 'Browser', keywords: 'refresh', run: reloadShownPage },
    { id: 'page-devtools', title: 'Toggle developer tools of the page', group: 'Browser', keywords: 'inspect', run: toggleShownPageDevTools },
    { id: 'page-new-tab', title: 'New tab on the Browser page', group: 'Browser', run: () => (pageTabs.open(), setBrowserOpened(true), setSelection({ kind: 'browser' })) },
    ...pageTabsAll.map((t): Command => ({ id: `page-tab-${t.id}`, title: `Browser tab ${tabLabel(t)}`, group: 'Browser', hint: t.url, run: () => (pageTabs.activate(t.id), setBrowserOpened(true), setSelection({ kind: 'browser' })) })),
    // in a WorkDesk a favorite opens as a tab of it (the WorkDesk offers that itself); elsewhere on the Browser page
    ...(inDesk ? [] : favorites.map((b): Command => ({ id: `fav-${b.id}`, title: `Open favorite ${b.title}`, group: b.group ?? 'Favorite', hint: b.url, run: () => openInBrowser(b.url) })))
  ]
  usePaletteCommands('app', appCommands)
  usePaletteFileOpener('app', { deskId: GLOBAL_DESK, open: (path, line) => (fileTabs.open(path, line), setFilesOpened(true), setSelection({ kind: 'files' })) }, 1)

  /** every open place for "Jump to…": the Tabs of the started WorkDesks (the one on screen first), then the Browser and Files pages */
  const loadJumpItems = useCallback(async (): Promise<JumpItem[]> => {
    const shown = selectionRef.current.kind === 'desk' ? selectionRef.current.id : undefined
    const desks = sidebarOrder(state.desks, closable).map((o) => o.desk).filter((d) => d.presence !== 'parked' && d.presence !== 'planned')
    desks.sort((a, b) => Number(b.id === shown) - Number(a.id === shown))
    const perDesk = await Promise.all(desks.map((d) => window.workdesk.getLayout(d.id).then((l) => deskJumpItems(d.id, d.name, l), () => [] as JumpItem[])))
    return [...perDesk.flat(), ...pageJumpItems(currentPageTabs().tabs), ...fileJumpItems(currentFileTabs().tabs)]
  }, [state.desks])

  // a link from another app (WorkDesk as the default browser): go to where the page is open already, else open it on the Browser page
  useEffect(
    () =>
      window.workdesk.onOpenUrl(async (url) => {
        const page = currentPageTabs().tabs.find((t) => samePage(t.url, url))
        if (page) {
          pageTabs.activate(page.id)
          setBrowserOpened(true)
          setSelection({ kind: 'browser' })
          return
        }
        const desk = await window.workdesk.findPage(url).catch(() => undefined)
        if (desk) {
          await window.workdesk.setActiveTab(desk.deskId, desk.tabId)
          selectDeskRef.current(desk.deskId)
          return
        }
        openInBrowser(url)
      }),
    [openInBrowser]
  )

  const selectDeskRef = useRef(selectDesk)
  selectDeskRef.current = selectDesk

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey && e.key === '\\') return (e.preventDefault(), setNavHidden(!navHidden))
      if (!e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return
      const ordered = sidebarOrder(state.desks, closable).map((o) => o.desk)
      const target =
        /^[1-9]$/.test(e.key) ? deskAtShortcut(ordered, Number(e.key))
        : undefined
      if (!target) return
      e.preventDefault()
      selectDesk(target.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.desks, selection, selectDesk, navHidden, setNavHidden])

  return (
    <PrStatesProvider>
    <OpenLinkContext.Provider value={openInBrowser}>
    <OpenLinksContext.Provider value={openAllInBrowser}>
    <div className={'app' + (navHidden ? ' nav-hidden' : '')}>
      {navHidden && (
        <nav className="nav-rail" aria-label="Side panel, hidden">
          <button title="Show the side panel (⌘\\)" aria-label="Show the side panel" onClick={() => setNavHidden(false)}>
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1.8" y="2.5" width="12.4" height="11" rx="1" />
              <path d="M6 2.5v11" />
            </svg>
          </button>
          <button className={selection.kind === 'dashboard' ? 'active' : ''} title={nextCount > 0 ? `Dashboard (${nextCount} to do next)` : 'Dashboard'} aria-label="Dashboard" onClick={() => setSelection({ kind: 'dashboard' })}>{ICONS.sliders}</button>
          <button className={selection.kind === 'work' ? 'active' : ''} title="Work Items" aria-label="Work Items" onClick={() => setSelection({ kind: 'work', tab: workTab })}>{ICONS.panes}</button>
          <button className={selection.kind === 'files' ? 'active' : ''} title="Files" aria-label="Files" onClick={() => (setFilesOpened(true), setSelection({ kind: 'files' }))}>{ICONS.file}</button>
          <button className={selection.kind === 'time' ? 'active' : ''} title="Time" aria-label="Time" onClick={() => setSelection({ kind: 'time' })}>{ICONS.clock}</button>
          <button className={selection.kind === 'orchestrator' ? 'active' : ''} title="Orchestrator" aria-label="Orchestrator" onClick={() => setSelection({ kind: 'orchestrator' })}>{ICONS.orchestrator}</button>
          <span className="nav-rail-sep" />
          {sidebarOrder(state.desks, closable).map((o, i) => o.desk).filter((d) => sectionOf(d, Date.now(), closable) === 'live').map((d) => {
            const n = sidebarOrder(state.desks, closable).findIndex((o) => o.desk.id === d.id) + 1
            const signal = d.signals.some((x) => !x.read)
            return (
              <button key={d.id} className={(selection.kind === 'desk' && selection.id === d.id ? 'active ' : '') + (signal ? 'signal' : '')} title={`${d.name}${n <= 9 ? ` (⌘${n})` : ''}`} aria-label={d.name} onClick={() => selectDesk(d.id)}>
                {n <= 9 ? n : d.name.charAt(0).toUpperCase()}
              </button>
            )
          })}
          <span className="nav-rail-fill" />
          <RefreshButton rail />
          <button className={selection.kind === 'browser' ? 'active' : ''} title="Browser" aria-label="Browser" onClick={() => (setBrowserOpened(true), setSelection({ kind: 'browser' }))}>{ICONS.globe}</button>
          <button className={selection.kind === 'performance' ? 'active' : ''} title="Performance" aria-label="Performance" onClick={() => setSelection({ kind: 'performance' })}>
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 8.5h3l2-5 3 9 2-4h3" /></svg>
          </button>
          <button className={selection.kind === 'settings' ? 'active' : ''} title="Settings" aria-label="Settings" onClick={() => setSelection({ kind: 'settings', section: 'appearance' })}>{ICONS.cog}</button>
        </nav>
      )}
      <Resizer size={PANEL_SIZES.nav} min={180} max={520} edge="right" panel={() => document.querySelector<HTMLElement>('.app > .nav')} className="nav-resizer" />
      <nav className="nav">
        <div className="nav-top">
          <h1>WorkDesk</h1>
          <button className="icon-btn" title="Hide the side panel (⌘\\)" aria-label="Hide the side panel" onClick={() => setNavHidden(true)}>
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1.8" y="2.5" width="12.4" height="11" rx="1" />
              <path d="M6 2.5v11" />
            </svg>
          </button>
          <RefreshButton />
          <button
            className={'icon-btn' + (selection.kind === 'browser' ? ' active' : '')}
            title="Browser: web pages and bookmarks outside any WorkDesk"
            aria-label="Browser"
            onClick={() => (setBrowserOpened(true), setSelection({ kind: 'browser' }))}
          >
            {ICONS.globe}
          </button>
          <button
            className={'icon-btn' + (selection.kind === 'settings' ? ' active' : '')}
            title="Settings: theme, Projects, Claude, Status Repo"
            aria-label="Settings"
            onClick={() => setSelection({ kind: 'settings', section: 'appearance' })}
          >
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
              <path d="M13.23 6.66 L15.14 7.04 L15.14 8.96 L13.23 9.34 L12.65 10.75 L13.72 12.37 L12.37 13.72 L10.75 12.65 L9.34 13.23 L8.96 15.14 L7.04 15.14 L6.66 13.23 L5.25 12.65 L3.63 13.72 L2.28 12.37 L3.35 10.75 L2.77 9.34 L0.86 8.96 L0.86 7.04 L2.77 6.66 L3.35 5.25 L2.28 3.63 L3.63 2.28 L5.25 3.35 L6.66 2.77 L7.04 0.86 L8.96 0.86 L9.34 2.77 L10.75 3.35 L12.37 2.28 L13.72 3.63 L12.65 5.25Z" />
              <circle cx="8" cy="8" r="2.1" />
            </svg>
          </button>
          <div className="pinned-tabs">
            <Clock />
            {pinned.map((t) => (
                <button
                  key={t.id}
                  title={tabLabel(t)}
                  {...pinSort.props(t.id)}
                  className={'pinned-tab ' + pinSort.classes(t.id) + (selection.kind === 'browser' && pageTabsState.active === t.id ? ' active' : '')}
                  onClick={() => (pageTabs.activate(t.id), setBrowserOpened(true), setSelection({ kind: 'browser' }))}
                >
                  {t.favicon ? <img src={t.favicon} alt="" width={16} height={16} onError={(e) => (e.currentTarget.style.display = 'none')} /> : <span>{tabLabel(t).charAt(0).toUpperCase()}</span>}
                </button>
              ))}
          </div>
        </div>
        <ProfileSelector config={pcfg} signals={signalsPerProfile} onPick={pickProfile} />
        <button className={selection.kind === 'dashboard' ? 'active' : ''} onClick={() => setSelection({ kind: 'dashboard' })}>
          Dashboard
          {nextCount > 0 && <span className="chip small sidebar-count" title="What next?: open Signals, open Todos and postponed WorkDesks coming back">{nextCount}</span>}
        </button>
        <button
          className={selection.kind === 'work' ? 'active' : ''}
          title="Your Todos, pull requests, Notion tickets and branches: where work comes from"
          onClick={() => setSelection({ kind: 'work', tab: workTab })}
        >
          Work Items
        </button>
        <button
          className={selection.kind === 'files' ? 'active' : ''}
          title="Files of the Profile: its knowledge, notes and a scratch pad that is kept"
          onClick={() => (setFilesOpened(true), setSelection({ kind: 'files' }))}
        >
          Files
        </button>
        <button className={selection.kind === 'time' ? 'active' : ''} title="Time per day and WorkDesk, week by week" onClick={() => setSelection({ kind: 'time' })}>
          Time
        </button>
        <button className={selection.kind === 'orchestrator' ? 'active' : ''} title="One Claude that looks over the WorkDesks and starts work" onClick={() => setSelection({ kind: 'orchestrator' })}>
          Orchestrator
        </button>
        {(() => {
          const shown = panels ?? { desks: true, waiting: true, reviews: true, closable: true, planned: true, postponed: true }
          const now = Date.now()
          const postponed = state.desks.filter((d) => sectionOf(d, now, closable) === 'postponed')
          const waiting = state.desks.filter((d) => sectionOf(d, now, closable) === 'waiting')
          const reviewing = state.desks.filter((d) => sectionOf(d, now, closable) === 'reviews')
          const closing = state.desks.filter((d) => sectionOf(d, now, closable) === 'closable')
          const planned = state.desks.filter((d) => sectionOf(d, now, closable) === 'planned')
          const live = state.desks.filter((d) => sectionOf(d, now, closable) === 'live')
          const numbering = sidebarOrder(state.desks, closable).map((o) => o.desk.id)
          const list = (desks: typeof state.desks) => (
            <Sidebar
              desks={desks}
              numbering={numbering}
              pins={pins}
              onOpenPinned={(deskId, tabId) => void window.workdesk.setActiveTab(deskId, tabId).then(() => selectDesk(deskId))}
              activeId={selection.kind === 'desk' ? selection.id : undefined}
              onSelect={selectDesk}
              onMove={(id, target) => void run(() => window.workdesk.moveDesk(id, target))}
              onMarkUnread={(id) => void run(() => window.workdesk.markUnread(id))}
              onPark={(id) => void run(() => window.workdesk.parkDesk(id))}
              onPostpone={setPostponing}
              onSaveTemplate={setSavingTemplate}
              onCombine={setCombining}
              onClear={setClearing}
              closable={closable}
              deleting={deleting}
              onBringBack={(id) => void run(() => window.workdesk.postponeDesk(id, null))}
              onStart={(id) =>
                void (async () => {
                  if (state.desks.find((d) => d.id === id)?.presence === 'parked') await run(() => window.workdesk.reactivateDesk(id))
                  await run(() => window.workdesk.activateDesk(id))
                  selectDesk(id)
                })()
              }
              onMarkRead={async (id) => {
                const desk = state.desks.find((d) => d.id === id)
                for (const s of desk ? openSignals(desk) : []) await run(() => window.workdesk.markSignalRead(id, s.id))
              }}
            />
          )
          const sectionRow = (desks: WorkDesk[]) => (desks.some((d) => d.presence !== 'planned') ? <div className="desks-actions">{sectionActions(desks)}</div> : null)
          // Park all / Reactivate all of one section: only its WorkDesks, which are those of the Profile in view
          const sectionActions = (desks: WorkDesk[]) => {
            const running = desks.filter((d) => d.presence !== 'parked' && d.presence !== 'planned').map((d) => d.id)
            const parked = desks.filter((d) => d.presence === 'parked').map((d) => d.id)
            return (
              <>
                {running.length > 0 && <button className="mini" title="Shut the WorkDesks of this section down to free memory; they stay listed here and are still watched" onClick={() => setParkingWaiting(running)}>Park all</button>}
                {parked.length > 0 && <button className="mini" title="Bring the parked WorkDesks of this section back" onClick={() => void reactivateAll(parked)}>Reactivate all</button>}
              </>
            )
          }
          return (
            <>
              <div className="nav-divider" />
              <SideSection
                title={`Working (${live.length})`}
                className="desks-section"
                open={shown.desks}
                onToggle={togglePanel('desks')}
              >
                <div className="desks-actions">
                  <button className="mini" title="Add an empty WorkDesk: no Todos, no branches" onClick={() => setAdding(true)}>+ Add</button>
                  {sectionActions(live)}
                </div>
                {list(live)}
              </SideSection>
              {waiting.length > 0 && (
                <SideSection title={`Waiting (${waiting.length})`} className="desks-section" open={shown.waiting} onToggle={togglePanel('waiting')}>
                  {sectionRow(waiting)}
                  {list(waiting)}
                </SideSection>
              )}
              {reviewing.length > 0 && (
                <SideSection
                  title={`Pull requests (${reviewing.length})`}
                  className="desks-section"
                  open={shown.reviews}
                  onToggle={togglePanel('reviews')}
                >
                  <button className={'section-entry' + (selection.kind === 'desk-prs' ? ' active' : '')} title="The pull requests in your WorkDesks, with their GitHub page" onClick={() => setSelection({ kind: 'desk-prs' })}>
                    All pull requests in WorkDesks
                  </button>
                  {sectionRow(reviewing)}
                  {list(reviewing)}
                </SideSection>
              )}
              {closing.length > 0 && (
                <SideSection title={`Can be cleared (${closing.length})`} className="desks-section" open={shown.closable} onToggle={togglePanel('closable')}>
                  {sectionRow(closing)}
                  {list(closing)}
                </SideSection>
              )}
              {planned.length > 0 && (
                <SideSection title={`Planned (${planned.length})`} className="desks-section" open={shown.planned} onToggle={togglePanel('planned')}>
                  {list(planned)}
                </SideSection>
              )}
              {postponed.length > 0 && (
                <SideSection title={`Postponed (${postponed.length})`} className="desks-section" open={shown.postponed} onToggle={togglePanel('postponed')}>
                  {sectionRow(postponed)}
                  {list(postponed)}
                </SideSection>
              )}
            </>
          )
        })()}
        {panels && (
          <div className="side-bottom">
            <ActivityFeed desks={state.desks} open={panels.activity} onToggle={togglePanel('activity')} onOpen={selectDesk} />
            <UsageMeter open={panels.claude} onToggle={togglePanel('claude')} onSettings={() => setSelection({ kind: 'settings', section: 'claude' })} />
            <PerformanceMeter active={selection.kind === 'performance'} open={panels.performance} onToggle={togglePanel('performance')} onOpenPage={() => setSelection({ kind: 'performance' })} />
          </div>
        )}
      </nav>
      {palette && <Palette onClose={() => setPalette(false)} onOpenInDesk={openInDesk} />}
      {searchingAll && <SearchAll onClose={() => setSearchingAll(false)} onOpenFile={openInDesk} onOpenTab={openTabInDesk} />}
      {jumping && (
        <JumpTo
          load={loadJumpItems}
          onCancel={() => setJumping(false)}
          onPick={(item) => {
            setJumping(false)
            const t = item.target
            if (t.kind === 'desk') void window.workdesk.setActiveTab(t.deskId, t.tabId).then(() => selectDeskRef.current(t.deskId))
            else if (t.kind === 'page') (pageTabs.activate(t.tabId), setBrowserOpened(true), setSelection({ kind: 'browser' }))
            else (fileTabs.activate(t.tabId), setFilesOpened(true), setSelection({ kind: 'files' }))
          }}
        />
      )}
      {fileFinder && (
        <FileFinder
          deskId={GLOBAL_DESK}
          mode={fileFinder}
          onCancel={() => setFileFinder(undefined)}
          onPick={(path, line) => (setFileFinder(undefined), fileTabs.open(path, line), setFilesOpened(true), setSelection({ kind: 'files' }))}
        />
      )}
      {adding && (
        <StartPanel
          request={{ kind: 'plain', todoIds: [], defaultName: '' }}
          run={run}
          onClose={() => setAdding(false)}
          onStarted={(st) => {
            // open the WorkDesk that was just made: the newest one (a diff against what the view knew can hit a WorkDesk of another Profile)
            const made = st.desks.reduce<WorkDesk | undefined>((n, d) => (!n || d.createdAt > n.createdAt ? d : n), undefined)
            if (made) selectDesk(made.id)
          }}
        />
      )}
      {error && <div className="error toast" title="Click to dismiss" onClick={() => setError(undefined)}>{error}</div>}
      <main className={selection.kind === 'orchestrator' || selection.kind === 'desk-prs' ? 'desk-main' : undefined}>
        {missing.length > 0 && (
          <div className="error">
            Missing tools: {missing.map((m) => <div key={m.name}><strong>{m.name}</strong>: {m.hint}</div>)}
          </div>
        )}
        {selection.kind === 'work' && (
          <WorkItemsPage
            key={pcfg.active}
            state={state}
            run={run}
            tab={selection.tab}
            onTab={(tab) => (setWorkTab(tab), setSelection({ kind: 'work', tab }))}
            focus={selection.focus}
            openDesk={selectDesk}
            openSettings={(section) => setSelection({ kind: 'settings', section })}
          />
        )}
        {selection.kind === 'dashboard' && (
          <Dashboard
            key={pcfg.active}
            scoped={pcfg.active !== 'all' && pcfg.profiles.length > 1}
            state={state}
            run={run}
            openDesk={selectDesk}
            openTab={openTabInDesk}
            onClear={setClearing}
            openTodo={openTodo}
            go={(t) =>
              setSelection(
                t === 'todos' ? { kind: 'work', tab: 'todos' }
                : t === 'github-prs' ? { kind: 'settings', section: 'github' }
                : t === 'notion-tickets' ? { kind: 'settings', section: 'notion' }
                : t === 'projects' || t === 'claude' ? { kind: 'settings', section: t }
                : { kind: 'dashboard' }
              )
            }
          />
        )}
        {selection.kind === 'todo' && (
          <TodoDetail todoId={selection.id} state={state} run={run} onBack={() => setSelection(selection.back)} openDesk={selectDesk} />
        )}
        {selection.kind === 'performance' && <PerformanceView state={state} run={run} />}
        {waitingAsk[0] && (
          <WaitingModal
            key={waitingAsk[0].desk.id}
            desk={state.desks.find((d) => d.id === waitingAsk[0].desk.id) ?? waitingAsk[0].desk}
            running={waitingAsk[0].running}
            more={waitingAsk.length - 1}
            onPark={() => {
              const id = waitingAsk[0].desk.id
              setWaitingAsk((q) => q.slice(1))
              void run(() => window.workdesk.parkDesk(id))
            }}
            onKeep={() => setWaitingAsk((q) => q.slice(1))}
          />
        )}
        {jwtOnFiles && <JwtModal deskId={GLOBAL_DESK} onClose={() => setJwtOnFiles(false)} onOpen={(p) => (setJwtOnFiles(false), fileTabs.open(p), setFilesOpened(true), setSelection({ kind: 'files' }))} />}
        {noteOnFiles && <NewNote deskId={GLOBAL_DESK} onClose={() => setNoteOnFiles(false)} onCreated={(p) => (setNoteOnFiles(false), fileTabs.open(p), setFilesOpened(true), setSelection({ kind: 'files' }))} />}
        {selection.kind === 'desk-prs' && <DeskPrsView
            desks={state.desks}
            openDesk={selectDesk}
            onPark={(id) => void run(() => window.workdesk.parkDesk(id))}
            onPostpone={setPostponing}
            onBringBack={(id) => void run(() => window.workdesk.postponeDesk(id, null))}
          />}
        {selection.kind === 'time' && <TimeView desks={state.desks} openDesk={selectDesk} scoped={pcfg.active !== 'all' && pcfg.profiles.length > 1} />}
        {selection.kind === 'orchestrator' && <OrchestratorView state={state} openDesk={selectDesk} openTab={openTabInDesk} />}
        {selection.kind === 'settings' && <SettingsView section={selection.section} onSection={(section) => setSelection({ kind: 'settings', section })} />}
      </main>
      {browserOpened && (
        <div className={'desk-layer' + (selection.kind === 'browser' ? ' on' : '')}>
          <BrowserView />
        </div>
      )}
      {filesOpened && (
        <div className={'desk-layer' + (selection.kind === 'files' ? ' on' : '')}>
          <FilesView key={pcfg.active} />
        </div>
      )}
      <div className={'desk-layer' + (selection.kind === 'desk' ? ' on' : '')}>
        {full.desks
          .filter((d) => visited.includes(d.id) && !deleting.has(d.id))
          .map((d) => (
            <DeskView
              key={d.id}
              desk={d}
              state={full}
              run={run}
              visible={selection.kind === 'desk' && selection.id === d.id}
              onClear={() => setClearing(d.id)}
              onCombine={() => setCombining(d.id)}
            />
          ))}
      </div>
      {savingTemplate && (
        <SaveTemplateDialog deskId={savingTemplate} deskName={state.desks.find((d) => d.id === savingTemplate)?.name ?? ''} onClose={() => setSavingTemplate(undefined)} />
      )}
      {capturing && (
        <CaptureTodo
          deskName={selection.kind === 'desk' ? state.desks.find((d) => d.id === selection.id)?.name : undefined}
          onCancel={() => setCapturing(false)}
          onSave={(title) => (void run(() => window.workdesk.captureTodo(selection.kind === 'desk' ? selection.id : null, title)), setCapturing(false))}
        />
      )}
      {postponing && (
        <PostponeDialog
          name={state.desks.find((d) => d.id === postponing)?.name ?? ''}
          onCancel={() => setPostponing(undefined)}
          onPick={(until) => (void run(() => window.workdesk.postponeDesk(postponing, until)), setPostponing(undefined))}
        />
      )}
      {parkingWaiting && <ParkAllDialog run={run} deskIds={parkingWaiting} onClose={() => setParkingWaiting(undefined)} />}
      {combining && state.desks.find((d) => d.id === combining) && (
        <CombineDesks desk={state.desks.find((d) => d.id === combining)!} desks={state.desks} run={run} onClose={() => setCombining(undefined)} onDone={() => setCombining(undefined)} />
      )}
      {clearing && state.desks.find((d) => d.id === clearing) && (
        <ClearDialog
          desk={state.desks.find((d) => d.id === clearing)!}
          onConfirm={(deleteBranches) => {
            const id = clearing
            if (selection.kind === 'desk' && selection.id === id) setSelection({ kind: 'dashboard' })
            setDeleting((s) => new Set(s).add(id))
            setClearing(undefined)
            // the work goes on in main while you carry on; it is over when the WorkDesk is gone (or it failed, the error shows)
            void run(() => window.workdesk.clearDesk(id, deleteBranches)).finally(() =>
              setDeleting((s) => {
                const next = new Set(s)
                next.delete(id)
                return next
              })
            )
          }}
          onClose={() => setClearing(undefined)}
        />
      )}
    </div>
    </OpenLinksContext.Provider>
    </OpenLinkContext.Provider>
    </PrStatesProvider>
  )
}
