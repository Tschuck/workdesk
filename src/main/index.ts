import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CertificateLog } from './certificates'
import { listCodeThemes, loadCodeTheme, readEditorFont } from './vscode-themes'
import { HistoryService } from './history'
import { deskDir } from './projects/layout'
import { jobs } from './jobs'
import { closableDeskIds } from './domain/closable'
import { Orchestrator, ORCHESTRATOR_DESK, ORCHESTRATOR_PANE, workerCommand } from './orchestrator'
import { deskOfEditorPath } from './domain/time-tracking'
import { GitService } from './git-service'
import { FileBaseStore, FilePresetStore, ReviewService } from './review-service'
import { DiagnosticsService } from './diagnostics-service'
import { FilesService, GLOBAL_DESK, type RenameRequest, type SearchQuery } from './files'
import { BookmarkImport } from './bookmark-import'
import { app, BrowserWindow, clipboard, desktopCapturer, globalShortcut, session, systemPreferences, webContents, dialog, ipcMain, Menu, Notification, powerMonitor, shell, type IpcMainInvokeEvent, type MessageBoxOptions } from 'electron'
import { spawn as ptySpawn } from 'node-pty'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import type { SetupFacts } from '../shared/setup'
import { ClearService } from './clear-service'
import { ParkAll } from './park-all'
import { checkTools } from './tools'
import { withToolPaths } from './env'
import { BranchesService } from './branches-service'
import { BrowserSessionsService } from './browser-sessions-service'
import { AdBlocker } from './ad-blocker'
import { pageMenu } from './domain/page-menu'
import { markdownLink } from './domain/page-refs'
import { isSignInPopup } from './domain/popup'
import { NO_SESSIONS, partitionFor, partitionsFor, isKnownPartition, isPinnedSession } from './domain/browser-sessions'
import { FileGrantStore, mayAsk, PagePermissions, PERMISSION_LABEL, wanted, type PagePermission } from './page-permissions'
import { ExtensionsService } from './extensions-service'
import { BookmarksService } from './bookmarks-service'
import { cacheFavicon } from './favicon'
import type { Bookmark } from './domain/bookmarks'
import { NotionAuth } from './sources/notion/oauth'
import { NotionService } from './sources/notion/service'
import { ticketTitle } from './sources/notion/board'
import { repoFromUrl } from './domain/prs'
import { parsePrId } from './sources/github/api'
import { ProjectRegistry } from './projects/projects'
import { ProfilesService } from './profiles-service'
import { ProfilesManager } from './profiles-manager'
import { LEGACY_SECRET_KEYS, clearProfileToken, setProfileToken, type CredentialKind, type ProfilesState } from './profiles-ipc'
import { DEFAULT_PROFILE_ID, HOME_REPO_ID, creationProfileId, filterByView, inView } from './domain/profiles'
import { ProjectsService } from './projects/projects-service'
import { realRepoGit } from './projects/repo-git'
import { keychain, type SecretStore } from './secrets'
import { migrateLegacySecrets, profileSecrets, viewSecrets } from './profile-secrets'
import { ProviderRegistry } from './sources/providers/registry'
import type { ProviderKind } from './sources/provider'
import { GithubApi } from './sources/github/api'
import { RemoteCache } from './remote-cache'
import { githubSource } from './sources/github/source'
import { GITHUB_TOKEN_KEY, resolveTransport } from './sources/github/transport'
import { DeskPrsService } from './sources/desk-prs'
import { PrWatch } from './sources/pr-watch'
import { PrsService } from './sources/prs-service'
import { SourcesService } from './sources/sources-service'
import { SourceStore } from './sources/store'
import { createClaudeAuth } from './claude/auth'
import { findClaudeBinary } from './claude/usage'
import { AccountsService } from './claude/accounts'
import { accountEnv, resolveAccount } from './domain/claude-accounts'
import { buildOverview } from './domain/claude-overview'
import { createScreen } from './terminal/tmux-screen'
import { paneInfo } from './terminal/pane-info'
import { createTmuxAdmin, runningIn, summarize } from './terminal/tmux-admin'
import { describeRunning, QuitController, Settings, type QuitBehavior, type SidebarPanels } from './quit'
import { ClaudeConfig, defaultClaudeDirs } from './claude/config'
import { FocusAcknowledger } from './claude/focus-ack'
import { socketPath } from './claude/paths'
import { HookServer } from './claude/socket-server'
import { createControl } from './control'
import { trackOwnPrs } from './sources/own-prs'
import { SiteBlockService } from './site-block-service'
import type { TimeTracker } from './time-tracker'
import { installSkills, skillsStatus, uninstallSkills } from './claude/skills'
import { paneIds as layoutPaneIds, tabPaneIds } from './domain/layout'
import { EditorController } from './editor/controller'
import { existsSync } from 'node:fs'
import { MacEditorWindows, runCode } from './editor/macos'
import { BROWSER_PARTITION, IPC } from '../shared/api'
import { WorkDeskService } from './service'
import { realGit } from './status/git'
import { LayoutService } from './terminal/layout-service'
import { TerminalManager, sessionName } from './terminal/manager'
import { realTmux } from './terminal/tmux'
import { PerformanceSampler, type AppPart } from './performance'
import { registerNavigation } from './nav-ipc'
import { WorkspaceNav } from './workspace-nav'

process.env['PATH'] = withToolPaths(process.env['PATH'])

interface Wiring {
  orchestrator: Orchestrator
  providers: ProviderRegistry
  remote: RemoteCache
  browserSessions: BrowserSessionsService
  pagePermissions: PagePermissions
  extensions: ExtensionsService
  bookmarks: BookmarksService
  service: WorkDeskService
  layouts: LayoutService
  files: FilesService
  terminals: TerminalManager
  editor: EditorController
  shutDown: (deskId: string) => Promise<void>
  clearing: ClearService
  parkAll: ParkAll
  focus: FocusAcknowledger
  claude: ClaudeConfig
  accounts: AccountsService
  settings: Settings
  sources: SourcesService
  prs: PrsService
  deskPrs: DeskPrsService
  prWatch: PrWatch
  notion: NotionService
  notionAuth: NotionAuth
  registry: ProjectRegistry
  projects: ProjectsService
  branches: BranchesService
  profiles: ProfilesService
  profilesManager: ProfilesManager
  hookServer: HookServer
}

/** Where the app's own CPU and memory go: its main process, the window, the GPU and the page of each browser Tab. */
function appParts(): AppPart[] {
  const pages = new Map<number, string[]>()
  for (const w of webContents.getAllWebContents()) {
    const name = w.getType() === 'webview' ? hostOf(w.getURL()) || w.getTitle() || 'Browser page' : 'Window'
    pages.set(w.getOSProcessId(), [...(pages.get(w.getOSProcessId()) ?? []), name])
  }
  return app.getAppMetrics().map((m) => {
    const names = [...new Set(pages.get(m.pid) ?? [])]
    const name =
      m.type === 'Browser' ? 'Main process' : m.type === 'GPU' ? 'GPU' : m.type === 'Tab' ? (names.join(', ') || 'Renderer') : m.type === 'Utility' ? (m.name ?? m.serviceName ?? 'Utility') : m.type
    return { name, memoryMb: Math.round(m.memory.workingSetSize / 1024), cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10 }
  })
}

/** The memory of the process each page runs in (MB), by the id of the page's web contents. */
function pageMemory(): Record<number, number> {
  const byPid = new Map(app.getAppMetrics().map((m) => [m.pid, Math.round(m.memory.workingSetSize / 1024)]))
  const out: Record<number, number> = {}
  for (const w of webContents.getAllWebContents()) if (w.getType() === 'webview') out[w.id] = byPid.get(w.getOSProcessId()) ?? 0
  return out
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/** The GitHub client and the user's login, kept for a while; forgotten when the login changes. */
const githubSessions = new Map<string, { at: number; value: { api: GithubApi; me: string } }>()
/** the credentials of the Profile in view (the pages' Settings read and write these) */
let viewKeychain: SecretStore = keychain

function registerIpc({ orchestrator, settings, remote, browserSessions, pagePermissions, extensions, bookmarks, service, layouts, files, terminals, editor, shutDown, clearing, parkAll, accounts, focus, claude, sources, prs, deskPrs, prWatch, notion, notionAuth, registry, projects, branches, providers, profiles, profilesManager, hookServer }: Wiring): void {
  const sampler = new PerformanceSampler(() => service.state().desks, undefined, undefined, appParts)
  ipcMain.handle(IPC.getState, () => service.state())
  ipcMain.handle(IPC.addTodo, (_e, input) => service.addTodo(input))
  ipcMain.handle(IPC.performance, () => sampler.sample())
  ipcMain.handle(IPC.pageMemory, () => pageMemory())
  ipcMain.handle(IPC.performanceTotal, async () => (await sampler.sample(true)).total)
  ipcMain.handle(IPC.quitGet, () => settings.quit)
  ipcMain.handle(IPC.quitSet, async (_e, v: unknown) => {
    if (v === 'ask' || v === 'keep' || v === 'stop') await settings.setQuit(v)
    refreshMenu?.()
    return settings.quit
  })
  ipcMain.handle(IPC.panelsGet, () => settings.panels)
  ipcMain.handle(IPC.panelsSet, async (_e, patch: Partial<SidebarPanels>) => {
    const before = settings.panels
    const now = await settings.setPanels(patch ?? {})
    // a closed Claude part stops reading the usage (and ends its hidden session); opening it reads again
    if (now.claude !== before.claude) {
      if (now.claude) { if (!process.env['WORKDESK_NO_USAGE']) accounts.start() } else await accounts.pause()
    }
    return now
  })
  ipcMain.handle(IPC.archiveResolvedTodos, (_e, all) => service.archiveResolved(all === true))
  ipcMain.handle(IPC.archivedTodos, () => service.archivedTodos())
  ipcMain.handle(IPC.restoreTodo, (_e, id) => service.restoreTodo(id))
  ipcMain.handle(IPC.setTodoResolved, (_e, id, resolved) => service.setTodoResolved(id, resolved))
  ipcMain.handle(IPC.deleteTodo, (_e, id) => service.deleteTodo(id))
  ipcMain.handle(IPC.editTodo, (_e, id, patch) => service.editTodo(id, patch))
  ipcMain.handle(IPC.deskAddTodo, (_e, d, t) => service.addTodoToDesk(d, t))
  ipcMain.handle(IPC.deskAssignTodo, (_e, t, d: string | null) => service.assignTodoToDesk(t, d ?? undefined))
  ipcMain.handle(IPC.deskRemoveTodo, (_e, t) => service.removeTodoFromDesk(t))
  ipcMain.handle(IPC.deskNewTodo, (_e, d, title) => service.createTodoInDesk(d, title))
  ipcMain.handle(IPC.captureTodo, (_e, d: string | null, title: string) => service.captureTodo(d ?? undefined, String(title)))
  ipcMain.handle(IPC.placeDeskTodo, (_e, d, t, ref, after) => service.placeDeskTodo(String(d), String(t), String(ref), !!after))
  ipcMain.handle(IPC.stepDeskTodo, (_e, d, t, delta) => service.stepDeskTodo(String(d), String(t), delta === -1 ? -1 : 1))
  ipcMain.handle(IPC.setTodoDue, (_e, id, at: unknown) => service.setTodoDue(String(id), typeof at === 'number' ? at : null))
  ipcMain.handle(IPC.snoozeTodo, (_e, id, until) => service.snoozeTodo(String(id), Number(until)))
  ipcMain.handle(IPC.setTodoRepeat, (_e, id, r: unknown) => service.setTodoRepeat(String(id), r === 'daily' || r === 'weekdays' || r === 'weekly' ? r : null))
  ipcMain.handle(IPC.placeTodo, (_e, id, ref, after) => service.placeTodo(id, ref, after))
  ipcMain.handle(IPC.readNotes, (_e, id) => service.readNotes(id))
  ipcMain.handle(IPC.saveNotes, (_e, id, text) => service.saveNotes(id, text))
  ipcMain.handle(IPC.startPlainDesk, (_e, ids, name) => service.startPlainDesk(ids, name))
  /** A WorkDesk that holds Pull requests or tickets opens a browser tab for each of them when it is started. */
  const openItemTabs = async (deskId: string) => {
    const desk = service.getState().desks.find((d) => d.id === deskId)
    // a pull request opens on its overview (the conversation): the files are read in the Review tab
    const urls = (desk?.items ?? []).flatMap((i) => (i.url && /^https:\/\//.test(i.url) ? [i.url] : []))
    if (urls.length > 0) {
      await layouts.addBrowserTabs(deskId, urls.slice(0, 10))
      // a Review WorkDesk starts with the pull request, then the Review tab, then the terminal
      if ((desk?.reviews ?? []).length > 0) await layouts.arrangeReviewStart(deskId, urls.slice(0, 10))
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.layoutChanged, deskId)
    }
  }
  /** A Review WorkDesk that is started or opened gets the pull request's branch checked out at once (the first time the repository is cloned, so in the background); the WorkDesk shows it when it is there. */
  const checkoutReviewInBackground = (deskId: string) => {
    const desk = service.getState().desks.find((d) => d.id === deskId)
    // only when a pull request it reviews has no checkout yet
    if (!desk || (desk.reviews ?? []).every((r) => desk.branches.some((b) => b.pr === `${r.owner}/${r.repo}#${r.number}`))) return
    void sources.checkoutReview(deskId).catch((e) => console.error('checkout of the review branch failed:', e))
  }
  /** The Notion ticket of each pull request of a WorkDesk, asked once per start of the app: attached to the WorkDesk as a page, so it is in its Pages list. */
  const notionAsked = new Set<string>()
  const attachNotionTickets = (deskId: string) => {
    for (const item of service.getState().desks.find((d) => d.id === deskId)?.items ?? []) {
      if (item.kind !== 'pr' || notionAsked.has(item.id)) continue
      notionAsked.add(item.id)
      const { owner, repo, number } = parsePrId(item.id)
      void (async () => {
        const branch = await sources.prHeadRef(owner, repo, number)
        const ticket = await notion.ticketForPr({ owner, repo, number, url: item.url ?? `https://github.com/${owner}/${repo}/pull/${number}`, title: item.title, branch })
        if (!ticket) return
        const desk = service.getState().desks.find((d) => d.id === deskId)
        if (!desk || (desk.refs ?? []).some((r) => r.url === ticket.url)) return
        await service.addPageRef({ kind: 'desk', id: deskId }, { url: ticket.url, title: ticketTitle(ticket) })
      })().catch(() => undefined)
    }
  }
  ipcMain.handle(IPC.deskAddItem, (_e, d, item) => service.addDeskItem(d, item))
  ipcMain.handle(IPC.deskRemoveItem, (_e, d, k, id) => service.removeDeskItem(d, k === 'ticket' ? 'ticket' : 'pr', id))
  // which browser pages (web contents ids) are in a running WorkDesk, and its name, for their right-click menu
  ipcMain.handle(IPC.pageAttachable, (_e, id, name) => void (typeof name === 'string' ? pageDesks.set(Number(id), name) : pageDesks.delete(Number(id))))
  const refTarget = (t: unknown): { kind: 'desk' | 'todo'; id: string } => {
    const x = (t ?? {}) as { kind?: unknown; id?: unknown }
    return { kind: x.kind === 'todo' ? 'todo' : 'desk', id: String(x.id) }
  }
  ipcMain.handle(IPC.addPageRef, (_e, t, page) => service.addPageRef(refTarget(t), page))
  ipcMain.handle(IPC.removePageRef, (_e, t, id) => service.removePageRef(refTarget(t), String(id)))
  ipcMain.handle(IPC.activateDesk, async (_e, id) => {
    const planned = service.getState().desks.find((d) => d.id === id)?.presence === 'planned'
    const state = await service.activateDesk(id)
    attachNotionTickets(id)
    if (planned) {
      await openItemTabs(id)
      checkoutReviewInBackground(id)
      // a planned review has no review state yet: read it now, not at the next round
      void sources.poll().catch(() => undefined)
    }
    return state
  })
  /** Take WorkDesks into one: each one after the other, so a failure leaves the ones before it done and the rest untouched. */
  const combineInto = async (target: string, others: string[]) => {
    let state = service.getState()
    for (const other of others) {
      // its terminals first: the folders are moved from under them
      await shutDown(other)
      const urls = (service.getState().desks.find((d) => d.id === other)?.items ?? []).flatMap((i) => (i.url && /^https:\/\//.test(i.url) ? [i.url] : []))
      await branches.combineDesks(target, other)
      // the time spent in it counts for this WorkDesk now
      timeTracker?.mergeDesk(other, target)
      // the pages of its pull requests and tickets open in this WorkDesk
      if (urls.length > 0 && service.getState().desks.find((d) => d.id === target)?.presence === 'active') {
        await layouts.addBrowserTabs(target, urls.slice(0, 10)).catch(() => undefined)
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.layoutChanged, target)
      }
      state = await clearing.clear(other)
    }
    return state
  }
  ipcMain.handle(IPC.combineDesks, (_e, t, o) => combineInto(String(t), (Array.isArray(o) ? o : [o]).map(String)))
  ipcMain.handle(IPC.moveDesk, (_e, id, targetId) => service.moveDesk(id, targetId))
  ipcMain.handle(IPC.getLayout, (_e, d) => layouts.get(d))
  ipcMain.handle(IPC.splitPane, (_e, d, t, p, dir, kind, before, url) => layouts.splitPane(d, t, p, dir, kind, before === true, typeof url === 'string' && (kind === 'file' || /^https?:\/\//.test(url)) ? url : undefined))
  ipcMain.handle(IPC.setBrowserLocation, (_e, d, t, p, url, title, favicon) => layouts.setBrowserLocation(d, t, p, url, title, favicon))
  ipcMain.handle(IPC.closePane, (_e, d, t, p) => layouts.closePane(d, t, p))
  ipcMain.handle(IPC.addBrowserTabs, (_e, d, urls: unknown) =>
    layouts.addBrowserTabs(d, Array.isArray(urls) ? urls.filter((u): u is string => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 30) : [])
  )
  ipcMain.handle(IPC.openReviewTab, (_e, d, activate) => layouts.openReviewTab(String(d), activate !== false))
  ipcMain.handle(IPC.addTab, (_e, d, kind, url, cwd) =>
    layouts.addTab(d, kind === 'file' ? 'file' : kind === 'browser' ? 'browser' : 'terminal', kind === 'file' ? (typeof url === 'string' ? url : undefined) : typeof url === 'string' && /^https?:\/\//.test(url) ? url : undefined, kind !== 'file' && kind !== 'browser' && typeof cwd === 'string' && cwd.startsWith('/') ? cwd : undefined)
  )
  ipcMain.handle(IPC.setFileLocation, (_e, d, t, p, path, line) => layouts.setFileLocation(d, t, p, typeof path === 'string' ? path : undefined, typeof line === 'number' ? line : undefined))
  ipcMain.handle(IPC.setSplitSizes, (_e, d, t, at, sizes) => {
    const numbers = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === 'number')
    if (!numbers(at) || !numbers(sizes)) throw new Error('The sizes do not fit the split')
    return layouts.setSplitSizes(d, t, at, sizes)
  })
  const pinnedNow = () => layouts.pins(service.state().desks.filter((d) => d.presence !== 'planned').map((d) => d.id))
  ipcMain.handle(IPC.pinnedTabs, () => pinnedNow())
  ipcMain.handle(IPC.moveTabToGroup, (_e, d: string, t: string, g: string) => layouts.moveTabToGroup(String(d), String(t), String(g ?? '')))
  ipcMain.handle(IPC.moveGroup, (_e, d: string, g: string, t: string, after: boolean) => layouts.moveGroup(String(d), String(g), String(t), !!after))
  ipcMain.handle(IPC.setTabBranch, (_e, d: string, t: string, p: string) => layouts.setTabBranch(String(d), String(t), typeof p === 'string' && p.startsWith('/') ? p : ''))
  ipcMain.handle(IPC.setTabGroup, (_e, d: string, t: string, g: string) => layouts.setTabGroup(String(d), String(t), String(g ?? '')))
  ipcMain.handle(IPC.reopenClosed, (_e, d: string) => layouts.reopenClosed(String(d)))
  ipcMain.handle(IPC.togglePinTab, (_e, d: string, t: string) => layouts.togglePin(String(d), String(t)))
  // the left panel lists the pinned Tabs of every WorkDesk: told whenever one changes
  layouts.onPinsChanged = () => void pinnedNow().then((pins) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(IPC.pinnedTabsChanged, pins)))
  ipcMain.handle(IPC.duplicateTab, (_e, d: string, t: string) => layouts.duplicateTab(String(d), String(t)))
  ipcMain.handle(IPC.movePaneBeside, (_e, d: string, from: string, p: string, to: string, target: string, dir: 'horizontal' | 'vertical', before: boolean) => layouts.movePaneBeside(String(d), String(from), String(p), String(to), String(target), dir === 'vertical' ? 'vertical' : 'horizontal', !!before))
  ipcMain.handle(IPC.mergeTab, (_e, d: string, from: string, to: string, p: string, dir: 'horizontal' | 'vertical', before: boolean) => layouts.mergeTab(String(d), String(from), String(to), String(p), dir === 'vertical' ? 'vertical' : 'horizontal', !!before))
  ipcMain.handle(IPC.movePane, (_e, d, t, p, to) => layouts.movePane(d, t, p, typeof to === 'string' ? to : undefined))
  ipcMain.handle(IPC.moveTab, (_e, d, t, target, after, keepGroup) => layouts.moveTab(d, t, target, after, keepGroup === true))
  ipcMain.handle(IPC.renameTab, (_e, d, t, n) => layouts.renameTab(d, t, n))
  ipcMain.handle(IPC.setActiveTab, (_e, d, t) => layouts.setActiveTab(d, t))
  ipcMain.handle(IPC.hibernateTab, (_e, d, t, on, auto) => layouts.setTabHibernated(d, t, on === true, auto === true))
  ipcMain.handle(IPC.closeTab, (_e, d, t) => layouts.closeTab(d, t))
  const paneAdmin = createTmuxAdmin()
  ipcMain.handle(IPC.terminalInfo, (_e, d: string, p: string) => paneInfo(paneAdmin, d, p))
  ipcMain.handle(IPC.tabRunning, async (_e, d: string, t: string, paneId?: string) => {
    const layout = await layouts.get(d)
    return runningIn(await createTmuxAdmin().panes(), paneId ? [paneId] : tabPaneIds(layout, t))
  })
  ipcMain.handle(IPC.prsList, async (_e, mode: 'none' | 'missing' | 'all') => (mode === 'none' ? prs.state() : prs.refresh(mode === 'all')))
  ipcMain.handle(IPC.prsAddRepo, (_e, r) => prs.addRepo(r))
  ipcMain.handle(IPC.prsRemoveRepo, (_e, r) => prs.removeRepo(r))
  ipcMain.handle(IPC.prsSkip, (_e, id, on) => prs.skip(id, on))
  ipcMain.handle(IPC.recentEvents, (_e, limit?: number) => service.recentEvents(typeof limit === 'number' ? limit : 8))
  ipcMain.handle(IPC.deskEvents, (_e, id: string, limit?: number) => service.deskEvents(id, typeof limit === 'number' ? limit : 20))
  ipcMain.handle(IPC.writeClipboard, (_e, text: unknown) => {
    if (typeof text === 'string' && text.length > 0) clipboard.writeText(text.slice(0, 10_000_000))
  })
  ipcMain.handle(IPC.codeThemes, () => listCodeThemes())
  ipcMain.handle(IPC.codeFont, () => readEditorFont())
  ipcMain.handle(IPC.codeTheme, (_e, id: unknown) => loadCodeTheme(String(id)))
  ipcMain.handle(IPC.readClipboard, async () => (await clipboard.readText()).slice(0, 1000))
  ipcMain.handle(IPC.statusRemote, async (_e, repoId?: string) => (await service.status.remoteOf(typeof repoId === 'string' ? repoId : HOME_REPO_ID)) ?? null)
  ipcMain.handle(IPC.setStatusRemote, async (_e, url: unknown, repoId?: string) => {
    const id = typeof repoId === 'string' ? repoId : HOME_REPO_ID
    await service.status.setRemoteOf(id, typeof url === 'string' ? url : '')
    return (await service.status.remoteOf(id)) ?? null
  })
  const historyState = () => ({ enabled: settings.history, count: history.count(), keepDays: settings.historyDays })
  ipcMain.handle(IPC.historySearch, (_e, q: string, limit?: number) => history.search(String(q ?? ''), typeof limit === 'number' ? Math.min(limit, 20) : 8))
  ipcMain.handle(IPC.historyList, (_e, q?: string, limit?: number) => history.list(String(q ?? ''), typeof limit === 'number' ? Math.min(limit, 2000) : 500))
  ipcMain.handle(IPC.historyForget, async (_e, url: string) => (await history.forget(String(url)), historyState()))
  ipcMain.handle(IPC.historyForgetDay, async (_e, d: number) => (await history.forgetDay(Number(d)), historyState()))
  ipcMain.handle(IPC.historyKeepDays, async (_e, n: number) => {
    await settings.setHistoryDays(Number(n))
    await history.prune(settings.historyDays)
    return historyState()
  })
  ipcMain.handle(IPC.historyState, () => historyState())
  ipcMain.handle(IPC.historySet, async (_e, on: boolean) => (await settings.setHistory(!!on), historyState()))
  ipcMain.handle(IPC.historyClear, async () => (await history.clear(), historyState()))
  ipcMain.handle(IPC.certificateInfo, (_e, url: string) => certificates.forUrl(String(url)))
  ipcMain.handle(IPC.filesRoots, (_e, d: string) => files.roots(String(d)))
  ipcMain.handle(IPC.filesList, (_e, d: string, r: string) => files.list(String(d), String(r)))
  ipcMain.handle(IPC.filesEmptyFolders, (_e, d: string, r: string) => files.emptyFolders(String(d), String(r)))
  ipcMain.handle(IPC.filesRemoveFolder, (_e, d: string, p: string) => files.removeFolder(String(d), String(p)))
  ipcMain.handle(IPC.filesMakeFolder, (_e, d: string, dir: string, n: string) => files.makeFolder(String(d), String(dir), String(n)))
  ipcMain.handle(IPC.filesMoveInto, (_e, d: string, p: string, r: string, f: string) => files.moveInto(String(d), String(p), String(r), String(f)))
  ipcMain.handle(IPC.filesRead, (_e, d: string, p: string) => files.read(String(d), String(p)))
  ipcMain.handle(IPC.filesReadBinary, (_e, d: string, p: string) => files.readBinary(String(d), String(p)))
  ipcMain.handle(IPC.filesWrite, (_e, d: string, p: string, c: string) => files.write(String(d), String(p), String(c)))
  ipcMain.handle(IPC.filesNewScratch, (_e, d: string) => files.newScratch(String(d)))
  ipcMain.handle(IPC.filesDropEmptyScratch, (_e, d: string, p: string) => files.dropEmptyScratch(String(d), String(p)))
  ipcMain.handle(IPC.filesDuplicate, (_e, d: string, p: string) => files.duplicate(String(d), String(p)))
  ipcMain.handle(IPC.filesRename, (_e, d: string, p: string, n: string) => files.rename(String(d), String(p), String(n)))
  ipcMain.handle(IPC.filesMove, (_e, d: string, p: string, dir: string) => files.move(String(d), String(p), String(dir)))
  ipcMain.handle(IPC.filesRemove, (_e, d: string, p: string) => files.remove(String(d), String(p)))
  ipcMain.handle(IPC.filesCreate, (_e, d: string, dir: string, n: string) => files.create(String(d), String(dir), String(n)))
  ipcMain.handle(IPC.filesSearch, (_e, d: string, r: string, q: SearchQuery) =>
    files.search(String(d), String(r), { text: String(q?.text ?? ''), regex: !!q?.regex, caseSensitive: !!q?.caseSensitive, glob: String(q?.glob ?? '') })
  )
  ipcMain.handle(IPC.filesUsages, (_e, d: string, r: string, w: string, g: string) => files.usages(String(d), String(r), String(w), String(g ?? '')))
  ipcMain.handle(IPC.filesRenameSymbol, (_e, d: string, req: RenameRequest) =>
    files.renameSymbol(String(d), {
      roots: (req?.roots ?? []).map(String),
      from: String(req?.from ?? ''),
      to: String(req?.to ?? ''),
      files: (req?.files ?? []).map((f) => ({ path: String(f.path), edits: (f.edits ?? []).map((e) => ({ line: Number(e.line), column: Number(e.column) })) }))
    })
  )
  ipcMain.handle(IPC.filesOpenInEditor, (_e, d: string, p: string, line?: number) => {
    const { abs } = files.resolveInside(String(d), String(p))
    const at = typeof line === 'number' ? `${abs}:${line}` : abs
    // the Files page belongs to no WorkDesk: VS Code's own choice of window
    return String(d) === GLOBAL_DESK ? runCode(['--goto', at]) : editor.openFile(String(d), abs, typeof line === 'number' ? line : undefined)
  })
  // changes, review and problems of the Branch folders in the File pane (see git-service.ts, review-service.ts, diagnostics-service.ts)
  const changes = new GitService(files)
  const reviews = new ReviewService(files, new FileBaseStore(join(app.getPath('userData'), 'review-bases.json')), new FilePresetStore(join(app.getPath('userData'), 'review-presets.json')))
  // `workdesk desk|branch|todo|review …` from a terminal of a WorkDesk (Claude skills use them)
  hookServer.setControl(
    createControl({
      root: service.root,
      desks: () => service.state().desks,
      todos: () => service.state().todos,
      activate: async (id) => {
        const planned = service.getState().desks.find((d) => d.id === id)?.presence === 'planned'
        const state = await service.activateDesk(id)
        if (planned) (await openItemTabs(id), checkoutReviewInBackground(id))
        attachNotionTickets(id)
        return state
      },
      combine: (t, o) => combineInto(t, o),
      startPlain: async (ids, name) => {
        const before = new Set(service.state().desks.map((d) => d.id))
        const st = await service.startPlainDesk(ids, name)
        return { id: st.desks.find((d) => !before.has(d.id))!.id }
      },
      park: async (id) => (await shutDown(id), service.parkDesk(id)),
      closable: () => closableDeskIds(service.state().desks, service.state().todos, prWatch.snapshot()),
      timeLog: () => timeTracker?.data() ?? {},
      claudeRows: () => claudeRows(),
      readPane: async (deskId, target, lines) => {
        const pane = await terminalPaneOf(deskId, target)
        return { ...pane, text: await createTmuxAdmin().capture(sessionName(deskId), pane.paneId, lines) }
      },
      sendToPane: async (deskId, target, text, enter) => {
        const pane = await terminalPaneOf(deskId, target)
        await createTmuxAdmin().sendText(sessionName(deskId), pane.paneId, text, enter)
        return pane
      },
      spawnClaude: async (deskId, prompt, name) => {
        const desk = service.state().desks.find((x) => x.id === deskId)
        if (!desk) throw new Error(`Unknown WorkDesk ${deskId}`)
        // a planned or parked WorkDesk is started first, as `desk open` does
        if (desk.presence === 'planned' || desk.presence === 'parked') await service.activateDesk(deskId)
        const cwd = desk.branches[0]?.path ?? deskDir(service.root, deskId)
        const made = await layouts.addWorkerTab(deskId, cwd, name ?? 'Claude')
        await terminals.startWindow(deskId, made.paneId, cwd, workerCommand(cwd, prompt))
        await orchestrator.record({ kind: 'spawn', deskId, deskName: desk.name, tabId: made.tabId, paneId: made.paneId, prompt })
        return made
      },
      clearIssues: (id) => clearing.preflight(id),
      clear: (id) => clearing.clear(id),
      addBranch: (d, p, b, base) => branches.addBranch(d, p, b, base),
      removeBranch: (d, p, b) => branches.removeBranchFromDesk(d, p, b),
      newTodo: (d, t) => service.createTodoInDesk(d, t),
      addPr: (d, item) => service.addDeskItem(d, item),
      resolveTodo: (id, r) => service.setTodoResolved(id, r),
      reviewState: (d, r) => reviews.state(d, r),
      addComment: (d, r, f, l, t) => reviews.addComment(d, r, f, l, t),
      addNote: (d, r, t) => reviews.addNote(d, r, t),
      presets: (d) => reviews.presets(d),
      savePreset: (d, p) => reviews.savePreset(d, p),
      removePreset: (d, id) => reviews.removePreset(d, id)
    })
  )
  const diagnostics = new DiagnosticsService(files)
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])
  ipcMain.handle(IPC.gitStatus, (_e, d: string, r: string) => changes.status(String(d), String(r)))
  ipcMain.handle(IPC.gitHead, (_e, d: string, r: string, p: string) => changes.head(String(d), String(r), String(p)))
  ipcMain.handle(IPC.gitStage, (_e, d: string, r: string, p: string[]) => changes.stage(String(d), String(r), strs(p)))
  ipcMain.handle(IPC.gitUnstage, (_e, d: string, r: string, p: string[]) => changes.unstage(String(d), String(r), strs(p)))
  ipcMain.handle(IPC.gitCommit, (_e, d: string, r: string, m: string) => changes.commit(String(d), String(r), String(m)))
  ipcMain.handle(IPC.diagnosticsCheck, (_e, d: string, r: string) => diagnostics.check(String(d), String(r)))
  ipcMain.handle(IPC.reviewState, (_e, d: string, r: string) => reviews.state(String(d), String(r)))
  ipcMain.handle(IPC.reviewPresets, (_e, d: string) => reviews.presets(String(d)))
  ipcMain.handle(IPC.reviewPresetRemove, (_e, d: string, id: string) => (reviews.removePreset(String(d), String(id)), reviews.presets(String(d))))
  ipcMain.handle(IPC.reviewBranches, (_e, d: string, r: string) => reviews.branches(String(d), String(r)))
  ipcMain.handle(IPC.reviewCommits, (_e, d: string, r: string) => reviews.commits(String(d), String(r)))
  ipcMain.handle(IPC.reviewSetBase, (_e, d: string, r: string, b: string) => reviews.setBase(String(d), String(r), String(b)))
  ipcMain.handle(IPC.reviewBaseFile, (_e, d: string, r: string, p: string) => reviews.baseFile(String(d), String(r), String(p)))
  ipcMain.handle(IPC.reviewAddComment, (_e, d: string, r: string, p: string, l: number, t: string) => reviews.addComment(String(d), String(r), String(p), Number(l), String(t)))
  ipcMain.handle(IPC.reviewUpdateComment, (_e, d: string, r: string, i: string, t: string) => reviews.updateComment(String(d), String(r), String(i), String(t)))
  ipcMain.handle(IPC.reviewRemoveComment, (_e, d: string, r: string, i: string) => reviews.removeComment(String(d), String(r), String(i)))
  ipcMain.handle(IPC.reviewAddNote, (_e, d: string, r: string, t: string) => reviews.addNote(String(d), String(r), String(t)))
  ipcMain.handle(IPC.reviewUpdateNote, (_e, d: string, r: string, i: string, t: string) => reviews.updateNote(String(d), String(r), String(i), String(t)))
  ipcMain.handle(IPC.reviewRemoveNote, (_e, d: string, r: string, i: string) => reviews.removeNote(String(d), String(r), String(i)))
  ipcMain.handle(IPC.reviewClearComments, (_e, d: string, r: string) => reviews.clearComments(String(d), String(r)))
  ipcMain.handle(IPC.findPage, (_e, url: string) =>
    layouts.findPage(service.state().desks.filter((d) => d.presence === 'active').map((d) => d.id), String(url))
  )
  ipcMain.handle(IPC.defaultBrowser, () => defaultBrowserState())
  ipcMain.handle(IPC.makeDefaultBrowser, () => {
    // only the packaged app: in development this would register Electron itself
    if (app.isPackaged) for (const scheme of ['http', 'https']) app.setAsDefaultProtocolClient(scheme)
    return defaultBrowserState()
  })
  ipcMain.handle(IPC.openExternal, async (_e, url: string) => {
    if (/^https:\/\//.test(url)) await shell.openExternal(url)
  })
  ipcMain.handle(IPC.checkTools, () => checkTools())
  ipcMain.handle(IPC.setupFacts, async (): Promise<SetupFacts> => {
    const [tools, projects, github, notionStatus, notionConfig, dirs] = await Promise.all([
      checkTools(),
      registry.listVisible(),
      resolveTransport(viewKeychain),
      notionAuth.status(),
      notion.config(),
      claude.list()
    ])
    return {
      tools,
      projects: projects.length,
      githubConnected: github.auth.kind !== 'none',
      notionConnected: notionStatus.connected,
      notionConfigured: !!notionConfig.databaseId,
      claudeHooksInstalled: dirs.some((d) => d.installed)
    }
  })
  ipcMain.handle(IPC.parkDesk, async (_e, id: string) => {
    // shells, dev servers and the editor window go away; Tabs, Panes and Claude sessions stay on disk
    await shutDown(id)
    return service.parkDesk(id)
  })
  ipcMain.handle(IPC.postponeDesk, (_e, id: string, until: unknown) => service.postponeDesk(String(id), typeof until === 'number' ? until : null))
  ipcMain.handle(IPC.parkAllPreflight, (_e, ids?: string[]) => parkAll.preflight(Array.isArray(ids) ? ids.map(String) : undefined))
  ipcMain.handle(IPC.parkAll, async (_e, quit: boolean, ids?: string[]) => {
    const state = await parkAll.parkAll(Array.isArray(ids) ? ids.map(String) : undefined)
    // nothing runs any more: quitting does not ask about terminals
    if (quit) setTimeout(() => app.quit(), 300)
    return state
  })
  ipcMain.handle(IPC.reactivateAll, (_e, ids?: string[]) => parkAll.reactivateAll(Array.isArray(ids) ? ids.map(String) : undefined))
  ipcMain.handle(IPC.renameDesk, (_e, id, name) => service.renameDesk(id, name))
  ipcMain.handle(IPC.setDeskGroupByBranch, (_e, id, on) => service.setDeskGroupByBranch(String(id), on === true))
  ipcMain.handle(IPC.setDeskStage, (_e, id, stage) => service.setDeskStage(id, stage))
  ipcMain.handle(IPC.clearPreflight, (_e, id) => clearing.preflight(id))
  ipcMain.handle(IPC.clearBranches, (_e, id) => clearing.branches(id))
  ipcMain.handle(IPC.clearDesk, (_e, id, del) => clearing.clear(id, del))
  ipcMain.handle(IPC.reactivateDesk, (_e, id: string) => service.reactivateDesk(id))
  ipcMain.handle(IPC.listProjects, () => projects.list())
  ipcMain.handle(IPC.addProjectClone, (_e, n, u) => projects.addClone(n, u))
  ipcMain.handle(IPC.addProjectExisting, (_e, n, p) => projects.addExisting(n, p))
  ipcMain.handle(IPC.renameProject, (_e, f, t) => projects.rename(f, t))
  ipcMain.handle(IPC.removeProject, (_e, n) => projects.remove(n))
  ipcMain.handle(IPC.moveProject, (_e, n, i) => projects.move(n, i))
  ipcMain.handle(IPC.setEnvSetup, (_e, n, c) => projects.setEnvSetup(n, c))
  ipcMain.handle(IPC.setCheckoutCommands, (_e, n, c) => projects.setCheckoutCommands(n, Array.isArray(c) ? c.filter((x): x is string => typeof x === 'string') : []))
  ipcMain.handle(IPC.setSharedEnv, (_e, n, on) => projects.setSharedEnv(n, on === true))
  ipcMain.handle(IPC.envSync, (_e, d, p, b) => projects.syncEnv(d, p, b))
  ipcMain.handle(IPC.envSyncDesk, (_e, d) => projects.syncDeskEnv(d))
  ipcMain.handle(IPC.envLinkDesk, (_e, d, f) => projects.linkDeskEnv(d, f === true))
  ipcMain.handle(IPC.envLink, (_e, d, p, b, f) => projects.linkEnv(d, p, b, f))
  ipcMain.handle(IPC.envSetup, (_e, d, p, b) => projects.runEnvSetup(d, p, b))
  // every change goes to all windows, so the star of a page and the lists agree
  const changed = async (list: Promise<Bookmark[]>): Promise<Bookmark[]> => {
    const l = await list
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(IPC.bookmarksChanged, l))
    return l
  }
  ipcMain.handle(IPC.browserSessionsGet, () => browserSessions.current)
  ipcMain.handle(IPC.browserSessionsSet, async (_e, c: unknown) => {
    const saved = await browserSessions.set(c)
    adBlocker?.setConfig(saved)
    // a new session needs the installed extensions too
    void extensions.load()
    return saved
  })
  ipcMain.handle(IPC.browserSessionsClear, async (_e, id?: string) => {
    const s = session.fromPartition(partitionFor(id && browserSessions.current.sessions.some((x) => x.id === id) ? id : undefined))
    await s.clearStorageData()
    await s.clearCache()
  })
  ipcMain.handle(IPC.pagePermissionsList, () => pagePermissions.list())
  ipcMain.handle(IPC.pagePermissionsAllow, (_e, origin: string, permission: PagePermission) => pagePermissions.allow(String(origin), permission))
  ipcMain.handle(IPC.pagePermissionsRevoke, (_e, origin: string, permission: PagePermission) => pagePermissions.revoke(String(origin), permission))
  // the page that is shown is the active tab of its session's extensions
  ipcMain.on(IPC.extensionsSelectTab, (_e, id: number) => {
    const wc = webContents.fromId(Number(id))
    if (wc && !wc.isDestroyed()) chromeExtensions.get(wc.session)?.selectTab(wc)
  })
  ipcMain.handle(IPC.extensionsList, () => extensions.list())
  ipcMain.handle(IPC.extensionsInstall, (_e, i: string) => extensions.install(String(i)))
  ipcMain.handle(IPC.extensionsRemove, (_e, id: string) => extensions.remove(String(id)))
  ipcMain.handle(IPC.extensionsUpdate, () => extensions.update())
  ipcMain.handle(IPC.bookmarksList, () => bookmarks.list())
  ipcMain.handle(IPC.bookmarksAdd, (_e, t: string, u: string, f?: string) => changed(bookmarks.add(String(t), String(u), typeof f === 'string' ? f : undefined)))
  ipcMain.handle(IPC.bookmarksIcon, (_e, u: string, f: string) => changed(bookmarks.icon(String(u), String(f))))
  ipcMain.handle(IPC.bookmarksRemove, (_e, id: string) => changed(bookmarks.remove(String(id))))
  const bookmarkImport = new BookmarkImport(app.getPath('appData'))
  ipcMain.handle(IPC.bookmarksImportSources, () => bookmarkImport.sources())
  ipcMain.handle(IPC.bookmarksImportRead, (_e, id: string) => bookmarkImport.read(String(id)))
  ipcMain.handle(IPC.bookmarksImport, async (_e, items: unknown) => {
    const picked = (Array.isArray(items) ? items : []).map((i) => ({ title: String(i?.title ?? ''), url: String(i?.url ?? ''), group: String(i?.group ?? '') }))
    const r = await bookmarks.importItems(picked)
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(IPC.bookmarksChanged, r.list))
    return { added: r.added, skipped: r.skipped }
  })
  ipcMain.handle(IPC.bookmarksRenameGroup, async (_e, from: string, to: string) => {
    const list = await changed(bookmarks.renameGroup(String(from), String(to)))
    BrowserWindow.getAllWindows().forEach(async (w) => w.webContents.send(IPC.bookmarkGroupSettingsChanged, await bookmarks.groupSettings()))
    return list
  })
  ipcMain.handle(IPC.bookmarksGroupSettings, () => bookmarks.groupSettings())
  ipcMain.handle(IPC.bookmarksGroupSettingsSet, async (_e, s: unknown) => {
    const saved = await bookmarks.setGroupSettings(s as never)
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(IPC.bookmarkGroupSettingsChanged, saved))
    return saved
  })
  ipcMain.handle(IPC.bookmarksSetUrl, (_e, id: string, u: string) => changed(bookmarks.setUrl(String(id), String(u))))
  ipcMain.handle(IPC.bookmarksGroup, (_e, id: string, g: string) => changed(bookmarks.group(String(id), String(g))))
  ipcMain.handle(IPC.bookmarksRename, (_e, id: string, t: string) => changed(bookmarks.rename(String(id), String(t))))
  ipcMain.handle(IPC.notionState, (_e, refresh: boolean) => (refresh ? notion.refresh() : notion.state()))
  ipcMain.handle(IPC.notionSaveClient, async (_e, id: string, secret: string) => (await notionAuth.saveClient(id, secret), notion.state()))
  ipcMain.handle(IPC.notionConnect, async () => (await notionAuth.connect(), notion.state()))
  ipcMain.handle(IPC.notionCancelConnect, () => notionAuth.cancelConnect())
  ipcMain.handle(IPC.notionDisconnect, async () => (await notionAuth.disconnect(), notion.state()))
  ipcMain.handle(IPC.notionSetConfig, async (_e, c) => (await notion.setConfig(c), notion.state()))
  ipcMain.handle(IPC.notionStatusTickets, (_e, status: string) => notion.refreshStatus(status))
  ipcMain.handle(IPC.notionClaim, (_e, id: string) => notion.claim(id))
  ipcMain.handle(IPC.notionTicket, (_e, id: string, refresh?: boolean) => notion.ticketDetails(id, refresh === true))
  ipcMain.handle(IPC.startFromItems, async (_e, req) => {
    const before = new Set(service.getState().desks.map((d) => d.id))
    const state = await branches.startFromItems(req)
    const made = state.desks.find((d) => !before.has(d.id))
    // a started WorkDesk without the pull request's branch opens the pull request itself; a planned one does so when it is started
    if (made && made.presence !== 'planned' && !made.branches.length) (await openItemTabs(made.id), checkoutReviewInBackground(made.id))
    if (made) attachNotionTickets(made.id)
    return state
  })
  ipcMain.handle(IPC.listBranches, (_e, refresh: boolean) => branches.listBranches(refresh))
  ipcMain.handle(IPC.createDeskFromBranches, (_e, sel, name, nb) => branches.createFromBranches(sel, name, nb))
  ipcMain.handle(IPC.removeBranchPreflight, (_e, d, p, b) => branches.removalPreflight(d, p, b))
  ipcMain.handle(IPC.removeBranchFromDesk, (_e, d, p, b) => branches.removeBranchFromDesk(d, p, b))
  ipcMain.handle(IPC.prTodoStates, () => prWatch.snapshot())
  // the reload of a WorkDesk: the pull request states, and at once what they mean for the WorkDesks that review them (their Stage), not at the next round
  ipcMain.handle(IPC.jobs, () => jobs.snapshot())
  ipcMain.handle(IPC.refreshPrTodos, () =>
    jobs.track('Reloading pull requests', async () => {
      const states = await prWatch.refresh()
      await sources.poll(true).catch((err) => console.error('polling reviews failed', err))
      return states
    })
  )
  ipcMain.handle(IPC.branchDetails, (_e, p, b) => branches.branchDetails(p, b))
  ipcMain.handle(IPC.branchPrs, (_e, p, b) => deskPrs.forBranch(p, b))
  ipcMain.handle(IPC.deleteBranch, (_e, p, b, o) => branches.deleteBranch(p, b, o))
  ipcMain.handle(IPC.deskPrs, (_e, d, refresh: boolean) => deskPrs.forDesk(d, refresh))
  ipcMain.handle(IPC.deskSync, (_e, d) => branches.deskSync(d))
  ipcMain.handle(IPC.deskFetch, (_e, d) => branches.fetchDesk(d))
  ipcMain.handle(IPC.deskPull, (_e, d, p, b) => branches.pullBranch(d, p, b))
  ipcMain.handle(IPC.addExistingBranches, (_e, d, s) => branches.addExistingBranches(d, s))
  ipcMain.handle(IPC.addBranch, (_e, d, p, b, base) => branches.addBranch(d, p, b, base))
  ipcMain.handle(IPC.restackPlan, (_e, d) => branches.restackPlan(d))
  ipcMain.handle(IPC.githubStatus, async () => (await resolveTransport(viewKeychain)).auth)
  ipcMain.handle(IPC.githubSetToken, async (_e, token: string) => {
    await viewKeychain.set(GITHUB_TOKEN_KEY, token.trim())
    githubSessions.clear()
    return (await resolveTransport(viewKeychain)).auth
  })
  ipcMain.handle(IPC.githubClearToken, async () => {
    await viewKeychain.delete(GITHUB_TOKEN_KEY)
    githubSessions.clear()
    return (await resolveTransport(viewKeychain)).auth
  })
  ipcMain.handle(IPC.providerStatus, () => providers.status())
  ipcMain.handle(IPC.providerSave, (_e, kind: ProviderKind, input: { baseUrl?: string; email?: string; token?: string }) => providers.save(kind, input))
  ipcMain.handle(IPC.providerClear, (_e, kind: ProviderKind) => providers.clear(kind))
  ipcMain.handle(IPC.providerResolve, (_e, url: string) => providers.resolve(String(url)))
  ipcMain.handle(IPC.providerForce, (_e, url: string, scope: 'repo' | 'host', kind: ProviderKind | undefined) => providers.force(String(url), scope, kind))
  ipcMain.handle(IPC.providerTest,(_e, kind: ProviderKind) => providers.test(kind))
  ipcMain.handle(IPC.prBranch,(_e, id: string, refresh?: boolean) => sources.prBranch(id, refresh === true))
  ipcMain.handle(IPC.remoteAge, (_e, prefix: string) => remote.oldest(typeof prefix === 'string' ? prefix : ''))
  ipcMain.handle(IPC.prState, (_e, id: string, refresh?: boolean) => sources.prState(id, refresh === true))
  ipcMain.handle(IPC.myPrs, (_e, refresh?: boolean) => sources.myPrs(refresh === true))
  ipcMain.handle(IPC.myPrsNeedingWork, (_e, refresh?: boolean) => sources.myPrsNeedingWork(refresh === true))
  ipcMain.handle(IPC.candidates, (_e, s, refresh?: boolean) => sources.candidates(s, refresh === true))
  ipcMain.handle(IPC.skipCandidate, (_e, s, c) => sources.skip(s, c))
  ipcMain.handle(IPC.checkoutReviewBranch, (_e, d) => sources.checkoutReview(d))
  ipcMain.handle(IPC.markUnread, (_e, d: string) => service.markUnread(d))
  ipcMain.handle(IPC.markSignalRead, (_e, d, s) => service.markSignalRead(d, s))
  ipcMain.handle(IPC.getJumpTarget, async (_e, d) => {
    const signal = service.oldestSignal(d)
    const tabId = signal?.paneId ? await layouts.tabOfPane(d, signal.paneId) : undefined
    return tabId && signal?.paneId ? { tabId, paneId: signal.paneId } : undefined
  })
  ipcMain.on(IPC.paneFocus, (_e, d, p, f) => focus.setFocused(d, p, f))
  ipcMain.handle(IPC.accountsState, () => accounts.state())
  ipcMain.handle(IPC.accountsAdd, (_e, name, dir) => accounts.add(String(name ?? ''), typeof dir === 'string' ? dir : undefined))
  ipcMain.handle(IPC.accountsRename, (_e, id, name) => accounts.rename(String(id), String(name ?? '')))
  ipcMain.handle(IPC.accountsSetDir, (_e, id, dir) => accounts.setDir(String(id), typeof dir === 'string' ? dir : undefined))
  ipcMain.handle(IPC.accountsSetDefault, (_e, id) => accounts.setDefault(String(id)))
  ipcMain.handle(IPC.accountsRemove, (_e, id) => accounts.remove(String(id)))
  ipcMain.handle(IPC.accountsSetEnabled, (_e, on) => accounts.setEnabled(on === true))
  ipcMain.handle(IPC.accountsSetInterval, (_e, m) => accounts.setInterval(Number(m)))
  ipcMain.handle(IPC.accountsRefresh, (_e, id) => (typeof id === 'string' ? accounts.refresh(id) : accounts.refreshAll()))
  ipcMain.handle(IPC.accountsLogin, (_e, id) => accounts.login(String(id)))
  ipcMain.handle(IPC.accountsCancelLogin, (_e, id) => accounts.cancelLogin(String(id)))
  ipcMain.handle(IPC.accountsLogout, (_e, id) => accounts.logout(String(id)))
  ipcMain.handle(IPC.setDeskClaudeAccount, (_e, d, a) => service.setDeskClaudeAccount(String(d), typeof a === 'string' ? a : null))
  const profilesState = (): Promise<ProfilesState> => profilesManager.state()
  ipcMain.handle(IPC.profilesState, profilesState)
  ipcMain.handle(IPC.profilesSetActive, async (_e, v) => (await profiles.setActive(String(v)), profilesState()))
  ipcMain.handle(IPC.profilesAdd, (_e, name, repoId) => profilesManager.add(String(name), typeof repoId === 'string' ? repoId : undefined))
  ipcMain.handle(IPC.profilesUpdate, (_e, id, changes) => profilesManager.update(String(id), changes ?? {}))
  ipcMain.handle(IPC.profilesRemove, (_e, id) => profilesManager.remove(String(id)))
  ipcMain.handle(IPC.profilesAddRepo, (_e, input) => profilesManager.addRepo({ mode: input?.mode === 'clone' ? 'clone' : 'point', path: input?.path, url: input?.url, label: input?.label }))
  ipcMain.handle(IPC.profilesForgetRepo, (_e, id) => profilesManager.forgetRepo(String(id)))
  ipcMain.handle(IPC.profilesSetProjectProfile, (_e, name, id) => profilesManager.setProjectProfile(String(name), typeof id === 'string' ? id : null))
  ipcMain.handle(IPC.profilesSetToken, async (_e, id, kind: CredentialKind, token) => {
    await setProfileToken(keychain, String(id), kind, String(token ?? ''))
    githubSessions.clear()
    return profilesState()
  })
  ipcMain.handle(IPC.profilesClearToken, async (_e, id, kind: CredentialKind) => {
    await clearProfileToken(keychain, String(id), kind)
    githubSessions.clear()
    return profilesState()
  })
  /** a terminal Pane of a WorkDesk by its id, or by the name of its Tab (its first terminal) */
  const terminalPaneOf = async (deskId: string, target: string): Promise<{ paneId: string; tab?: string }> => {
    const layout = await layouts.get(deskId)
    const want = target.trim().toLowerCase()
    for (const tab of layout.tabs) {
      if (tab.kind !== 'panes') continue
      const ids = layoutPaneIds(tab.layout, 'terminal')
      if (ids.includes(target)) return { paneId: target, tab: tab.name }
      if (tab.name.toLowerCase() === want && ids[0]) return { paneId: ids[0], tab: tab.name }
    }
    throw new Error(`No terminal Pane or Tab "${target}" in that WorkDesk (\`desk list\` shows the Panes of its Claude sessions)`)
  }
  const claudeRows = async () => {
    const desks = service.desksWithClaudeAccount()
    const live = desks.filter((d) => d.presence !== 'parked' && d.presence !== 'planned')
    const [panes, sessions, layoutList] = await Promise.all([
      createTmuxAdmin().panes(),
      Promise.all(live.map(async (d) => [d.id, await service.claudeSessions.list(d.id).catch(() => [])] as const)),
      Promise.all(live.map(async (d) => [d.id, await layouts.get(d.id).catch(() => undefined)] as const))
    ])
    return buildOverview({
      desks,
      panes,
      sessions: new Map(sessions),
      activity: service.claudeActivity,
      layouts: new Map(layoutList.filter((x): x is [string, NonNullable<(typeof x)[1]>] => x[1] !== undefined)),
      accounts: accounts.config()
    })
  }
  ipcMain.handle(IPC.claudeOverview, claudeRows)
  const skillsDir = app.isPackaged ? join(process.resourcesPath, 'skills') : join(app.getAppPath(), 'skills')
  ipcMain.handle(IPC.claudeSkills, (_e, p) => skillsStatus(skillsDir, String(p)))
  ipcMain.handle(IPC.claudeSkillsInstall, async (_e, p) => (await installSkills(skillsDir, String(p)), skillsStatus(skillsDir, String(p))))
  ipcMain.handle(IPC.claudeSkillsUninstall, async (_e, p) => (await uninstallSkills(skillsDir, String(p)), skillsStatus(skillsDir, String(p))))
  ipcMain.handle(IPC.claudeDirs, () => claude.list())
  ipcMain.handle(IPC.claudeDefaultDirs, () => defaultClaudeDirs())
  ipcMain.handle(IPC.claudeAddDir, async (_e, p) => (await claude.add(p), claude.list()))
  ipcMain.handle(IPC.claudeRemoveDir, async (_e, p) => (await claude.remove(p), claude.list()))
  ipcMain.handle(IPC.claudeInstall, async (_e, p) => (await claude.install(p), claude.list()))
  ipcMain.handle(IPC.claudeUninstall, async (_e, p) => (await claude.uninstall(p), claude.list()))
  ipcMain.handle(IPC.editorIsOpen, (_e, d) => editor.isOpen(d))
  ipcMain.handle(IPC.editorOpen, (_e, d) => editor.open(d))
  ipcMain.handle(IPC.editorFocusFolder, (_e, d, f) => editor.focusFolder(d, f))
  ipcMain.handle(IPC.editorClose, (_e, d) => editor.close(d))
  ipcMain.handle(IPC.terminalAttach, (_e, d, p, cwd, c, r, v) => terminals.attach(d, p, cwd, c, r, typeof v === 'string' && v ? v : undefined))
  ipcMain.on(IPC.terminalDetach, (_e, p) => terminals.detach(p))
  ipcMain.on(IPC.terminalInput, (_e, p, data) => terminals.write(p, data))
  ipcMain.on(IPC.terminalResize, (_e, p, c, r) => terminals.resize(p, c, r))
}

/** Global shortcut to capture a Todo for the WorkDesk you are in */
const CAPTURE_SHORTCUT = 'Alt+CommandOrControl+T'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'WorkDesk',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  // Command+arrows (with or without Shift) are told to the page from here as well: the main process hears of a key before the page does,
  // and the page may never get a Command+arrow that a text field or the system would use first
  win.webContents.on('before-input-event', (_event, input) => {
    // WORKDESK_DEBUG_KEYS=1: every key with Command held, as this process receives it (to find out where a shortcut gets lost)
    if (process.env['WORKDESK_DEBUG_KEYS'] && input.meta) console.log(`[keys] ${input.type} key=${input.key} code=${input.code} meta=${input.meta} shift=${input.shift} alt=${input.alt} ctrl=${input.control}`)
    // Command+D: Go to definition. Before the page, as the editor of a File pane (add next match) and a terminal would take the key before the menu
    if (input.type === 'keyDown' && isGoToDefinition(input)) {
      _event.preventDefault()
      win.webContents.send(IPC.menuAction, 'definition')
      return
    }
    if (input.type !== 'keyDown' || !input.meta || input.control || input.alt || !/^Arrow(Left|Right|Up|Down)$/.test(input.key)) return
    win.webContents.send(IPC.paneKey, { key: input.key, shiftKey: input.shift, fromWindow: true })
  })

  if (process.env['WORKDESK_DEBUG_KEYS']) {
    win.webContents.on('console-message', (event) => {
      const text = (event as unknown as { message?: string }).message ?? ''
      if (text.startsWith('[pane-nav]')) console.log(text)
    })
  }

  // the app's own window never shows a web page: links go to the system browser, navigation away is refused
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Command+D on a Mac, nothing else held (elsewhere Control+D is the end of input of a terminal: the menu's accelerator does it there) */
const isGoToDefinition = (input: Electron.Input): boolean => process.platform === 'darwin' && input.key.toLowerCase() === 'd' && input.meta && !input.control && !input.alt && !input.shift

/** Set when the app is ready: the page guards below need them. */
let browserSessions: BrowserSessionsService | undefined
let adBlocker: AdBlocker | undefined
let pagePermissions: PagePermissions | undefined
/** counts the time per WorkDesk (set when the navigation is registered) */
let timeTracker: TimeTracker | undefined
const hardened = new WeakSet<Electron.Session>()

/** Meetings need the camera, the microphone and the screen; those are asked per site. Everything else a page may ask for is refused. */
const certificates = new CertificateLog()
/** the Chrome extension API of each browser session, which also draws the buttons and popups of the extensions */
/** the windows made for pages that an extension opened */
const extensionWindows = new WeakSet<Electron.BaseWindow>()
/** browser pages (web contents id) that are in a running WorkDesk, with its name */
const pageDesks = new Map<number, string>()
const chromeExtensions = new Map<Electron.Session, ElectronChromeExtensions>()
function chromeExtensionsFor(sess: Electron.Session): ElectronChromeExtensions {
  let ext = chromeExtensions.get(sess)
  if (!ext) {
    ext = new ElectronChromeExtensions({
      session: sess,
      // an extension opening a page (a sign-in, its options): a window of its own in the same session, since WorkDesk's tabs are web views of its own pages
      createTab: async (details) => {
        const win = new BrowserWindow({ width: 1000, height: 800, title: 'WorkDesk', webPreferences: { session: sess, contextIsolation: true, nodeIntegration: false } })
        extensionWindows.add(win)
        if (details.url && /^(https?|chrome-extension):/i.test(details.url)) void win.loadURL(details.url)
        return [win.webContents, win]
      },
      // pages of the Panes have the main window as their window: closing that would end the app, so only close the windows made above
      removeTab: (_wc, win) => {
        if (extensionWindows.has(win)) win.close()
      }
    })
    chromeExtensions.set(sess, ext)
  }
  return ext
}
/** loads the installed extensions into a session that is new */
let extensionsRef: ExtensionsService | undefined
/** the pages visited in the browser (made when the app is ready: it needs the user data folder) */
/** rebuilds the application menu (its When Quitting radio follows the setting) */
let refreshMenu: (() => void) | undefined
let history: HistoryService

function hardenPageSession(sess: Electron.Session): void {
  if (hardened.has(sess)) return
  hardened.add(sess)
  // note what certificate each server showed, for the lock in the address bar; -3: the browser's own verdict stands
  sess.setCertificateVerifyProc((request, callback) => {
    try {
      certificates.record(request as never)
    } catch {
      // the lock then knows nothing; the page is not affected
    }
    callback(-3)
  })
  adBlocker?.attach(sess)
  const safe = new Set(['clipboard-sanitized-write', 'fullscreen'])
  sess.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (safe.has(permission)) return callback(true)
    const what = wanted(permission, (details as { mediaTypes?: string[] }).mediaTypes)
    if (what.length === 0 || permission === 'display-capture' || !pagePermissions) return callback(false)
    void pagePermissions.request((details as { requestingUrl?: string }).requestingUrl ?? wc.getURL(), what).then(callback, () => callback(false))
  })
  sess.setPermissionCheckHandler((_wc, permission, origin, details) => {
    if (safe.has(permission)) return true
    if (permission !== 'media' || !pagePermissions) return false
    // a page looks at the state before it asks: "yes, you may ask" on secure pages; the question itself is the gate
    return mayAsk(permission, origin)
  })
  // sharing the screen: the system picker where macOS has one, else the first screen
  sess.setDisplayMediaRequestHandler(
    (request, callback) => {
      void (async () => {
        const url = request.frame?.url ?? ''
        if (!pagePermissions || !(await pagePermissions.request(url, ['screen']))) return callback({})
        const [source] = await desktopCapturer.getSources({ types: ['screen'] })
        callback(source ? { video: source } : {})
      })().catch(() => callback({}))
    },
    { useSystemPicker: true }
  )
}

/** Browser Panes are plain, sandboxed web pages: no Node, no preload; each runs in the session of its domain. */
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    if (!isKnownPartition(browserSessions?.current ?? NO_SESSIONS, params.partition ?? '')) return event.preventDefault()
    const sess = session.fromPartition(params.partition!)
    hardenPageSession(sess)
    void extensionsRef?.ensure(sess)
    chromeExtensionsFor(sess)
  })
  // the page of a Browser Pane is only known as a webview once it is attached to its host
  contents.on('did-attach-webview', (_event, guest) => {
    // the page is a tab for the extensions of its session
    const host = BrowserWindow.fromWebContents(contents)
    if (host) chromeExtensionsFor(guest.session).addTab(guest, host)
    // a page in a browser pane gets the key events itself: Ctrl+Tab has to be passed on to switch Tabs
    guest.on('before-input-event', (event, input) => {
      // Command+arrows move between the Panes and Command+Shift+arrows split one: a page has the focus, so the app is told
      if (input.type === 'keyDown' && input.meta && !input.control && !input.alt && /^Arrow(Left|Right|Up|Down)$/.test(input.key)) {
        event.preventDefault()
        contents.send(IPC.paneKey, { key: input.key, shiftKey: input.shift })
        return
      }
      if (input.type === 'keyDown' && isGoToDefinition(input)) {
        event.preventDefault()
        contents.send(IPC.menuAction, 'definition')
        return
      }
      // Command+F: search in this page
      if (input.type === 'keyDown' && input.meta && !input.control && !input.alt && !input.shift && input.key.toLowerCase() === 'f') {
        event.preventDefault()
        contents.send(IPC.findInPage, guest.id)
        return
      }
      // Option+Tab: the Tabs in the order of use; letting go of Option ends the walk
      if (input.type === 'keyDown' && input.key === 'Tab' && input.alt && !input.control && !input.meta) {
        event.preventDefault()
        contents.send(IPC.cycleTab, input.shift ? -1 : 1, true)
        return
      }
      if (input.type === 'keyUp' && input.key === 'Alt') contents.send(IPC.cycleTab, 0, true)
      if (input.type !== 'keyDown' || input.key !== 'Tab' || !input.control || input.alt || input.meta) return
      event.preventDefault()
      contents.send(IPC.cycleTab, input.shift ? -1 : 1)
    })
    // the back and forward buttons of a mouse: the page gets them as buttons 3 and 4 but, on a Mac, does nothing with them
    guest.on('dom-ready', () => {
      void guest
        .executeJavaScript(
          `if (!window.__workdeskMouseNav) { window.__workdeskMouseNav = true;
             addEventListener('mouseup', (e) => { if (e.button === 3) { e.preventDefault(); history.back() } else if (e.button === 4) { e.preventDefault(); history.forward() } }, true) }`
        )
        .catch(() => undefined)
    })
    // right click on a page: navigation, links, copy, the Markdown link and attaching the page; the renderer says whether it can attach
    guest.on('context-menu', (_e, params) => {
      const deskName = pageDesks.get(guest.id)
      const entries = pageMenu({
        pageUrl: guest.getURL(),
        linkUrl: params.linkURL,
        selectionText: params.selectionText,
        isEditable: params.isEditable,
        canGoBack: guest.navigationHistory.canGoBack(),
        canGoForward: guest.navigationHistory.canGoForward(),
        deskName,
        canOpenTab: true
      })
      const run: Record<string, () => void> = {
        back: () => guest.navigationHistory.goBack(),
        forward: () => guest.navigationHistory.goForward(),
        reload: () => guest.reload(),
        'open-link': () => contents.send(IPC.openTab, guest.id, params.linkURL),
        'copy-link': () => clipboard.writeText(params.linkURL),
        'copy-selection': () => guest.copy(),
        cut: () => guest.cut(),
        paste: () => guest.paste(),
        'copy-markdown': () => clipboard.writeText(markdownLink(guest.getURL(), guest.getTitle())),
        'attach-desk': () => contents.send(IPC.pageMenuAction, guest.id, 'attach-desk'),
        'attach-todo': () => contents.send(IPC.pageMenuAction, guest.id, 'attach-todo'),
        inspect: () => guest.inspectElement(params.x, params.y)
      }
      Menu.buildFromTemplate(entries.map((e) => ('separator' in e ? { type: 'separator' as const } : { label: e.label, enabled: e.enabled !== false, click: () => run[e.id]() }))).popup({ window: host ?? undefined })
    })
    guest.once('destroyed', () => pageDesks.delete(guest.id))
    // a page of another session's domain cannot stay in this one: the Pane reopens it in the right session
    // a page that opened on a domain of several sessions stays in the one it was opened in, whatever it hops to (a sign-in through Google
    // needs the cookies it set before, so it cannot move to the session of google.com on the way); the address bar still opens other sessions
    let pinned = false
    const pin = (url: string): void => {
      if (!pinned) pinned = isPinnedSession(browserSessions?.current ?? NO_SESSIONS, url, (p) => guest.session === session.fromPartition(p))
    }
    const elsewhere = (url: string): boolean =>
      // a domain that several sessions name may stay in any of them
      !pinned && /^https?:/i.test(url) && !partitionsFor(browserSessions?.current ?? NO_SESSIONS, url).some((p) => guest.session === session.fromPartition(p))
    const guard = (details: { url: string; isMainFrame: boolean; preventDefault(): void }) => {
      if (!details.isMainFrame || !elsewhere(details.url)) return
      details.preventDefault()
      contents.send(IPC.switchSession, guest.id, details.url)
    }
    // the pages visited, for the suggestions of the address bar and the new tab picker
    guest.on('did-navigate', (_e, url) => (pin(url), history?.visit(url, guest.getTitle())))
    guest.on('did-navigate-in-page', (_e, url, isMainFrame) => isMainFrame && history?.visit(url, guest.getTitle()))
    guest.on('page-title-updated', (_e, title) => history?.titled(guest.getURL(), title))
    guest.on('will-navigate', guard)
    guest.on('will-redirect', guard)
    // a middle click (or Cmd-click) on a link opens a new Tab; other links that want a new window open in the same Pane
    guest.setWindowOpenHandler(({ url, disposition, features }) => {
      // `window.open(url, name, 'width=…')` is a pop-up that talks to the page that opened it (a Google or Apple sign-in, a payment): it
      // has to be a real window of the same session, with its opener; opened in this Pane it would wait for an opener it no longer has
      if (disposition === 'new-window' && isSignInPopup(url, features)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: { parent: BrowserWindow.fromWebContents(contents) ?? undefined, autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } }
        }
      }
      if (disposition === 'background-tab' || disposition === 'foreground-tab') contents.send(IPC.openTab, guest.id, url)
      else if (elsewhere(url)) contents.send(IPC.switchSession, guest.id, url)
      else void guest.loadURL(url)
      return { action: 'deny' }
    })
  })
})

// Links from other apps (WorkDesk as the default browser): kept until the window can take them, then shown in the app
const pendingUrls: string[] = []
function showUrl(url: string): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.webContents.isLoading()) {
    pendingUrls.push(url)
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send(IPC.openUrl, url)
}
app.on('open-url', (event, url) => {
  event.preventDefault()
  if (/^https?:\/\//i.test(url)) showUrl(url)
})

function defaultBrowserState(): { canBe: boolean; isDefault: boolean } {
  return { canBe: app.isPackaged, isDefault: app.isPackaged && app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https') }
}

app.whenReady().then(async () => {
  const pageGrants = new PagePermissions(new FileGrantStore(join(app.getPath('userData'), 'page-permissions.json')), async (origin, what) => {
    const win = BrowserWindow.getAllWindows()[0]
    const names = what.map((w) => PERMISSION_LABEL[w]).join(' and ')
    const box = {
      type: 'question' as const,
      message: `${new URL(origin).host} wants to use ${names}`,
      detail: 'Allow it for meetings and sites you trust. The answer is kept for this site; you can take it back in Settings → Browser sessions.',
      buttons: ['Allow', 'Not now'],
      defaultId: 1,
      cancelId: 1
    }
    const { response } = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box)
    if (response !== 0) return false
    // macOS asks its own question, once, and remembers it
    for (const w of what) {
      const kind = w === 'camera' ? 'camera' : w === 'microphone' ? 'microphone' : undefined
      if (kind && !(await systemPreferences.askForMediaAccess(kind))) {
        void dialog.showMessageBox({ type: 'info', message: `macOS does not let WorkDesk use ${PERMISSION_LABEL[w]}`, detail: 'Allow it in System Settings → Privacy & Security, then try again.' })
        return false
      }
    }
    return true
  })
  await pageGrants.load()
  pagePermissions = pageGrants
  // a packaged app gets its icon from the bundle; the dev build sets it by hand
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(join(app.getAppPath(), 'build', 'icon.png'))
  const root = process.env['WORKDESK_ROOT'] ?? join(homedir(), 'workdesk')
  const profiles = new ProfilesService(join(app.getPath('userData'), 'profiles.json'))
  await profiles.load()
  viewKeychain = viewSecrets(keychain, () => creationProfileId(profiles.config()))
  // the one set of credentials from before Profiles becomes Profile #1's (copied, the old items stay)
  if (!profiles.config().secretsMigrated) {
    try {
      await migrateLegacySecrets(keychain, DEFAULT_PROFILE_ID, LEGACY_SECRET_KEYS)
      await profiles.markSecretsMigrated()
    } catch (err) {
      console.error('moving the credentials into the Default Profile failed; it is tried again at the next start:', (err as Error).message)
    }
  }
  const service = new WorkDeskService(root, realGit, Date.now, profiles)
  await service.load()
  if (process.env['WORKDESK_SEED']) service.seedDemo()
  const sessionRules = new BrowserSessionsService(service.status.dir, () => service.status.autoCommit.notifyChange())
  await sessionRules.load()
  browserSessions = sessionRules
  adBlocker = new AdBlocker(join(app.getPath('userData'), 'block-lists'))
  adBlocker.setConfig(sessionRules.current)
  // sites that cannot be loaded: the page of a Pane that goes to one is stopped, and its Pane says so (it offers a pass for that page)
  const siteBlock = new SiteBlockService(service.status.dir, () => service.status.autoCommit.notifyChange())
  await siteBlock.load()
  adBlocker.guard = (details) => {
    const rule = siteBlock.check(details.url)
    if (!rule) return false
    const wc = details.webContentsId ? webContents.fromId(details.webContentsId) : undefined
    ;(wc?.hostWebContents ?? wc)?.send(IPC.siteBlocked, details.webContentsId, details.url, rule)
    return true
  }
  ipcMain.handle(IPC.siteBlockList, () => siteBlock.list())
  ipcMain.handle(IPC.siteBlockAdd, (_e, s) => siteBlock.add(String(s)))
  ipcMain.handle(IPC.siteBlockRemove, (_e, s) => siteBlock.remove(String(s)))
  ipcMain.handle(IPC.siteBlockCheck, (_e, u) => siteBlock.check(String(u)))
  ipcMain.handle(IPC.siteBlockPass, (_e, u) => siteBlock.pass(String(u)))
  hardenPageSession(session.fromPartition(partitionFor()))
  const broadcast = (channel: string, ...args: unknown[]) =>
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, ...args))
  // the orchestrator: one Claude of its own in tmux, shown on its own page (not a WorkDesk)
  const orchestrator = new Orchestrator(join(app.getPath('userData'), 'orchestrator.json'), join(app.getPath('userData'), 'orchestrator'))
  await orchestrator.load()
  const terminals = new TerminalManager(
    realTmux,
    (file, args, cols, rows, cwd) => {
      const pty = ptySpawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env: process.env as Record<string, string> })
      return {
        onData: (l) => void pty.onData(l),
        onExit: (l) => void pty.onExit(l),
        write: (d) => pty.write(d),
        resize: (c, r) => pty.resize(c, r),
        kill: () => pty.kill()
      }
    },
    (paneId, data) => broadcast(IPC.terminalData, paneId, data),
    (paneId) => broadcast(IPC.terminalExit, paneId),
    (deskId, paneId, exitCode) => {
      if (service.state().desks.some((d) => d.id === deskId)) {
        service.raiseSignal(deskId, 'command-finished', paneId, exitCode === undefined ? undefined : `exit ${exitCode}`)
      }
    },
    (deskId, paneId) => (deskId === ORCHESTRATOR_DESK ? Promise.resolve(orchestrator.command()) : service.claudeSessions.resumeCommand(deskId, paneId)),
    undefined,
    // a new terminal of a WorkDesk runs `claude` under the Account of the WorkDesk (its own choice, else the default one)
    // and gets WORKDESK_CLI, so skills and scripts can run `node "$WORKDESK_CLI" desk list`
    (deskId) => ({ ...accountEnv(resolveAccount(accounts.config(), deskId === ORCHESTRATOR_DESK ? orchestrator.accountId() : service.desksWithClaudeAccount().find((d) => d.id === deskId)?.claudeAccountId)), WORKDESK_CLI: cliPath })
  )
  service.onStateChanged = (state) => broadcast(IPC.stateChanged, state)
  ipcMain.handle(IPC.orchestratorState, () => ({ accountId: orchestrator.accountId() ?? null, deskId: ORCHESTRATOR_DESK, paneId: ORCHESTRATOR_PANE, cwd: orchestrator.folder }))
  ipcMain.handle(IPC.orchestratorSetAccount, (_e, id: unknown) => orchestrator.setAccount(typeof id === 'string' && id ? id : null))
  // a new window starts Claude again, under the chosen Account
  ipcMain.handle(IPC.orchestratorHistory, () => orchestrator.history())
  orchestrator.onHistory = (list) => broadcast(IPC.orchestratorHistoryChanged, list)
  ipcMain.handle(IPC.orchestratorRestart, () => terminals.close(ORCHESTRATOR_DESK, ORCHESTRATOR_PANE))
  /** the Profile a new Project is listed under (none for Profile #1) */
  const creationTag = (): string | undefined => {
    const id = creationProfileId(profiles.config())
    return id === DEFAULT_PROFILE_ID ? undefined : id
  }
  const focus = new FocusAcknowledger((deskId, paneId) => service.acknowledgePane(deskId, paneId))
  const cliPath = app.isPackaged ? join(process.resourcesPath, 'cli', 'workdesk.mjs') : join(app.getAppPath(), 'cli', 'workdesk.mjs')
  const claude = new ClaudeConfig(join(service.status.dir, 'claude-dirs.json'), cliPath)
  const hookServer = new HookServer(socketPath(), (e) => void service.handleHook(e))
  await hookServer.start().catch((err) => console.error('hook socket unavailable:', err))
  app.on('will-quit', () => void hookServer.stop())
  const editor = new EditorController(
    root,
    new MacEditorWindows(),
    (deskId) => service.state().desks.find((d) => d.id === deskId)?.branches ?? [],
    () => service.state().desks.map((d) => d.id)
  )
  // the login and who the user is rarely change: asked once in a while, not before every request (each `gh` call is a process)
  const github = async (profileId?: string) => {
    const pid = profileId ?? creationProfileId(profiles.config())
    const cached = githubSessions.get(pid)
    if (cached && Date.now() - cached.at < 10 * 60_000) return cached.value
    const { transport, graphql } = await resolveTransport(profileSecrets(keychain, pid))
    if (!transport) throw new Error('GitHub is not connected: log in with `gh auth login` or store a token in Settings → GitHub')
    const api = new GithubApi(transport, graphql)
    const value = { api, me: await api.me() }
    githubSessions.set(pid, { at: Date.now(), value })
    return value
  }
  const store = new SourceStore(service.status.dir, () => service.status.autoCommit.notifyChange(), () => creationProfileId(profiles.config()))
  const providers = new ProviderRegistry({ store, secrets: viewKeychain })
  const registry = new ProjectRegistry(join(service.status.dir, 'projects.json'), realRepoGit, root, () => creationTag())
  const notionAuth = new NotionAuth(viewKeychain, { openUrl: (url) => shell.openExternal(url) })
  // everything read from GitHub and Notion is kept here for a while; a replaced answer is announced to the views
  const remote = new RemoteCache({ onChange: (key) => broadcast(IPC.remoteChanged, key) })
  const notion = new NotionService({ auth: notionAuth, store, service, remote })
  // review Todos: the state of their Pull Requests, and a notification when one becomes ready to merge
  const prWatch = new PrWatch({
    service,
    batch: () => sources.watched(true),
    onChange: (states) => broadcast(IPC.prTodosChanged, states),
    // what is new on the pull requests of your own: a review, a request for changes, comments (a Signal of the WorkDesk, a notification)
    onRead: (read, targets) =>
      void trackOwnPrs(service, read, targets, (pr, news) => {
        if (!Notification.isSupported()) return
        const n = new Notification({ title: news.type === 'review-received' ? `Review: ${news.message}` : news.message, body: pr.title, silent: false })
        n.on('click', () => {
          const win = BrowserWindow.getAllWindows()[0]
          win?.show()
          win?.focus()
          if (pr.url) void shell.openExternal(pr.url)
        })
        n.show()
      }).catch((err) => console.error('tracking the pull requests of your own failed', err)),
    onReady: (pr, state) => {
      try {
        service.raiseDeskSignal(pr.deskId, 'ready-to-merge', 'Approved, checks passed: ready to merge')
      } catch {
        // the WorkDesk is gone
      }
      if (!Notification.isSupported()) return
      const n = new Notification({ title: 'Ready to merge', body: `${pr.title}\nApproved, checks passed.`, silent: false })
      n.on('click', () => {
        const win = BrowserWindow.getAllWindows()[0]
        win?.show()
        win?.focus()
        void shell.openExternal(state.url)
      })
      n.show()
    }
  })
  const sources = new SourcesService({
    remote,
    service,
    // with several Profiles the lists offer the pull requests of the Projects of the Profile in view, not of every repository the login can see
    scope: async () => {
      if (profiles.config().profiles.length < 2) return undefined
      const repos = new Set((await registry.listVisibleWithUrls()).flatMap((p) => (p.url ? [repoFromUrl(p.url)?.toLowerCase() ?? ''] : [])))
      return (prId) => {
        const { owner, repo } = parsePrId(prId)
        return repos.has(`${owner}/${repo}`.toLowerCase())
      }
    },
    sources: [
      githubSource(async () => (await github()).api),
      notion.asSource()
    ],
    store,
    registry,
    repoGit: realRepoGit,
    github,
    log: (msg, err) => console.error(msg, err)
  })
  // Todos resolved yesterday go to the archive when the day turns over while the app runs
  const sweep = setInterval(() => void service.archiveResolved().then((s) => service.onStateChanged(s)).catch(() => undefined), 3_600_000)
  app.on('will-quit', () => clearInterval(sweep))
  /** Bring the window up (a new one when it was closed on a Mac) and tell the page what to open. */
  const showMain = (action: 'capture-todo' | 'what-next' | `open-desk:${string}`): void => {
    let win = BrowserWindow.getAllWindows()[0]
    const fresh = !win
    if (fresh) {
      createWindow()
      win = BrowserWindow.getAllWindows()[0]
    }
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (fresh) win.webContents.once('did-finish-load', () => setTimeout(() => win.webContents.send(IPC.menuAction, action), 500))
    else win.webContents.send(IPC.menuAction, action)
  }
  // reminders of Todos: a Signal in their WorkDesk; a Todo in none gets a system notification (a click opens What next?)
  const shown = new Set<Notification>() // kept until closed, or a click may never arrive
  const remind = (): void =>
    void service.checkReminders().then((loose) => {
      if (!Notification.isSupported()) return
      for (const t of loose) {
        const n = new Notification({ title: 'Todo due', body: t.title })
        shown.add(n)
        n.on('click', () => showMain('what-next'))
        n.on('close', () => shown.delete(n))
        n.show()
      }
    }, (err) => console.error('reminders failed', err))
  const firstRemind = setTimeout(remind, 5_000)
  const reminderTimer = setInterval(remind, 30_000)
  app.on('will-quit', () => (clearTimeout(firstRemind), clearInterval(reminderTimer)))
  // capture a Todo from anywhere: brings the window up and asks for the title
  if (!globalShortcut.register(CAPTURE_SHORTCUT, () => showMain('capture-todo'))) console.error(`The shortcut ${CAPTURE_SHORTCUT} is taken by another app`)
  app.on('will-quit', () => globalShortcut.unregisterAll())
  const layouts = new LayoutService(root, terminals)
  ipcMain.handle(IPC.startTemplateDesk, async (_e, templateId: string, name: string) => {
    const template = service.template(String(templateId))
    const state = await service.startTemplateDesk(template.id, String(name ?? ''))
    await layouts.applyTemplate(state.desks[state.desks.length - 1].id, template)
    return state
  })
  ipcMain.handle(IPC.templatesList, () => service.listTemplates())
  ipcMain.handle(IPC.templateSave, async (_e, deskId: string, name: string, kindsOnly: boolean) => service.saveTemplate(String(deskId), String(name), await layouts.get(String(deskId)), !!kindsOnly))
  ipcMain.handle(IPC.templateEdit, (_e, id, patch: { name?: string; stage?: import('./domain/types').Stage; todos?: string[] }) => service.editTemplate(String(id), { name: patch.name, stage: patch.stage, todos: patch.todos }))
  ipcMain.handle(IPC.templateDelete, (_e, id) => service.deleteTemplate(String(id)))
  ipcMain.handle(IPC.templateDuplicate, (_e, id) => service.duplicateTemplate(String(id)))
  ipcMain.handle(IPC.templateMove, (_e, id, delta) => service.moveTemplate(String(id), delta === -1 ? -1 : 1))
  ipcMain.handle(IPC.scheduleTemplate, (_e, id, templateId) => service.setScheduleTemplate(String(id), String(templateId)))
  ipcMain.handle(IPC.schedulesList, () => service.listSchedules())
  ipcMain.handle(IPC.scheduleAdd, (_e, input: { templateId: string; name: string; repeat: 'daily' | 'weekdays' | 'weekly'; time: string }) =>
    service.addSchedule({ templateId: String(input.templateId), name: String(input.name), repeat: input.repeat, time: String(input.time) })
  )
  ipcMain.handle(IPC.schedulePause, (_e, id, paused) => service.setSchedulePaused(String(id), !!paused))
  ipcMain.handle(IPC.scheduleDelete, (_e, id) => service.deleteSchedule(String(id)))
  // repeating WorkDesks: a planned WorkDesk when it is time (nothing is started); a system notification, a click opens it
  const scheduleNotices = new Set<Notification>()
  const runSchedules = (): void =>
    void service.runSchedules().then(async (made) => {
      for (const desk of made) {
        const templateId = service.listSchedules().find((s) => s.id === desk.scheduleId)?.templateId
        if (templateId) await layouts.applyTemplate(desk.id, service.template(templateId)).catch(() => undefined)
        if (!Notification.isSupported()) continue
        const n = new Notification({ title: 'WorkDesk planned', body: desk.name })
        scheduleNotices.add(n)
        n.on('click', () => showMain(`open-desk:${desk.id}`))
        n.on('close', () => scheduleNotices.delete(n))
        n.show()
      }
    }, (err) => console.error('repeating WorkDesks failed', err))
  const firstSchedules = setTimeout(runSchedules, 8_000)
  const scheduleTimer = setInterval(runSchedules, 30_000)
  app.on('will-quit', () => (clearTimeout(firstSchedules), clearInterval(scheduleTimer)))
  const shutDown = async (id: string) => {
    const layout = await layouts.get(id)
    await editor.close(id).catch(() => undefined)
    await terminals.parkDesk(id, layout.tabs.flatMap((t) => (t.kind === 'panes' ? layoutPaneIds(t.layout) : [])))
  }
  // Claude Usage: a hidden Claude Code session on WorkDesk's tmux server, asked for /usage once a minute
  const screen = createScreen()
  const accounts: AccountsService = new AccountsService({
    screen,
    cwd: service.status.dir,
    binary: () => findClaudeBinary(),
    makeAuth: (configDir) => createClaudeAuth({ binary: () => findClaudeBinary(), configDir }),
    file: join(service.status.dir, 'claude-accounts.json'),
    legacyFile: join(service.status.dir, 'claude-usage.json'),
    newId: () => randomUUID().replace(/-/g, '').slice(0, 8),
    onChange: (state) => broadcast(IPC.accountsChanged, state),
    onNotice: (notice) => {
      if (!Notification.isSupported()) return
      const n = new Notification({ title: notice.title, body: notice.body })
      n.on('click', () => BrowserWindow.getAllWindows()[0]?.show())
      shownNotices.add(n)
      n.on('close', () => shownNotices.delete(n))
      n.show()
    }
  })
  const shownNotices = new Set<Notification>() // kept until closed, or a click may never arrive
  await accounts.load()
  // no reading while the machine is locked or asleep, or the window has been out of focus for half an hour; one when it is back
  powerMonitor.on('lock-screen', () => accounts.setLocked(true))
  powerMonitor.on('suspend', () => accounts.setLocked(true))
  powerMonitor.on('unlock-screen', () => accounts.setLocked(false))
  powerMonitor.on('resume', () => accounts.setLocked(false))
  app.on('browser-window-focus', () => accounts.setFocused(true))
  app.on('browser-window-blur', () => accounts.setFocused(false))
  void screen.killSession('_workdesk-usage') // the permanent reader of earlier versions
  const settings = new Settings(join(app.getPath('userData'), 'settings.json'))
  await settings.load()
  history = new HistoryService(join(app.getPath('userData'), 'history.json'))
  await history.load()
  history.enabled = () => settings.history
  // pages older than the kept days are forgotten at start and then every few hours
  void history.prune(settings.historyDays)
  const pruneTimer = setInterval(() => void history.prune(settings.historyDays), 6 * 3_600_000)
  app.on('will-quit', () => clearInterval(pruneTimer))
  app.on('will-quit', () => void history.flush().catch(() => undefined))
  if (!process.env['WORKDESK_NO_USAGE'] && settings.panels.claude) accounts.start()
  app.on('will-quit', () => {
    accounts.stop()
    // a hidden session must not outlive the app
    void accounts.killAll()
  })
  const parkAll = new ParkAll({
    service,
    root,
    panes: () => createTmuxAdmin().panes(),
    resumeCommand: (deskId, paneId) => service.claudeSessions.resumeCommand(deskId, paneId),
    shutDown
  })
  const clearing = new ClearService({ service, registry, git: realRepoGit, root, shutDown, github })
  // the buttons of the extensions are drawn in the app's own window, from its session
  ElectronChromeExtensions.handleCRXProtocol(session.defaultSession)
  const extensions = new ExtensionsService(
    () => [partitionFor(), ...sessionRules.current.sessions.map((s) => partitionFor(s.id))].map((p) => session.fromPartition(p)),
    (s) => void chromeExtensionsFor(s)
  )
  extensionsRef = extensions
  void extensions.load()
  const deskPrs = new DeskPrsService({ service, registry, github })
  const prsService = new PrsService({ service, store, registry, github })
  // another Profile in view: its login, repositories and Projects; what was read for the last one is forgotten
  registry.visible = (p) => inView(p, profiles.config().active, profiles.config())
  let seenView = creationProfileId(profiles.config())
  profiles.onChange = (cfg) => {
    const now = creationProfileId(cfg)
    if (now !== seenView) {
      seenView = now
      remote.invalidate('')
      prsService.reset()
    }
    broadcast(IPC.profilesChanged, cfg)
  }
  // One background round every five minutes, only while the app is in use (a visible window, the machine not locked):
  // Pull Requests of the WorkDesks' branches become their work items, then the state of the Pull Requests of started
  // WorkDesks is read, then their reviews are followed. It replaces four timers that asked for the same Pull Requests.
  const ROUND_MS = 5 * 60_000
  let lastRound = 0
  jobs.onChange((list) => broadcast(IPC.jobsChanged, list))
  const inUse = () => BrowserWindow.getAllWindows().some((w) => w.isVisible() && !w.isMinimized()) && powerMonitor.getSystemIdleState(600) !== 'locked'
  let running: Promise<void> | undefined
  const round = (force = false): Promise<void> | undefined => {
    if (running || (!force && (Date.now() - lastRound < ROUND_MS || !inUse()))) return running
    lastRound = Date.now()
    running = (async () => {
      try {
        await jobs.track('Pull requests of your branches', () => sources.assignOwnPrs()).catch((err) => console.error('assigning pull requests failed', err))
        await jobs.track('State of the pull requests (checks, reviews)', () => prWatch.refresh()).catch(() => undefined)
        await jobs.track('Review requests and comments', () => sources.poll()).catch((err) => console.error('polling reviews failed', err))
      } finally {
        running = undefined
      }
    })()
    return running
  }
  // the refresh button: the round at once (one that already runs is waited for, not started twice)
  ipcMain.handle(IPC.refreshAll, async () => void (await round(true)))
  setTimeout(() => void round(true), 20_000)
  const roundTimer = setInterval(() => void round(), 60_000)
  app.on('will-quit', () => clearInterval(roundTimer))
  // coming back after a pause: catch up if the last round is old
  app.on('browser-window-focus', () => void round())
  const branchesService = new BranchesService(service, registry, realRepoGit, async (deskId, worktree, commands) => {
    // the commands run in a terminal Tab of the WorkDesk, which comes to the front
    await layouts.addSetupTab(deskId, worktree.path, `Setup ${worktree.project}`, commands)
    broadcast(IPC.layoutChanged, deskId)
  }) 
  branchesService.sources = sources
  let filesService!: FilesService
  // the notes, knowledge and scratch files of the Profile in view live in its Status Repo
  const viewRepoDir = (): string => service.status.dirOfProfile(creationProfileId(profiles.config()))
  registerIpc({ orchestrator, settings, remote, browserSessions: sessionRules, pagePermissions: pageGrants, extensions, files: filesService = new FilesService((deskId) => (service.state().desks.find((d) => d.id === deskId)?.branches ?? []).map((b) => ({ label: `${b.project}/${b.branch}`, path: b.path })), (deskId) => join(deskDir(root, deskId), 'scratch'), (abs) => shell.trashItem(abs), (deskId) => join(deskDir(root, deskId), 'notes'), { roots: () => { const dir = viewRepoDir(); return [{ label: 'knowledge', path: join(dir, 'knowledge') }, ...(existsSync(join(dir, 'notes')) ? [{ label: 'todo notes', path: join(dir, 'notes') }] : [])] }, scratch: () => join(viewRepoDir(), 'scratch') }, () => service.status.autoCommit.notifyChange()), bookmarks: new BookmarksService(service.status.dir, () => service.status.autoCommit.notifyChange(), (src) => cacheFavicon(src)), service, layouts, terminals, editor, shutDown, clearing, parkAll, accounts, focus, claude, sources, prs: prsService, deskPrs, prWatch, notion, notionAuth, registry, projects: new ProjectsService(registry, service, root, realRepoGit), branches: branchesService, providers, profiles, profilesManager: new ProfilesManager({ profiles, service, registry, git: realGit, secrets: keychain, root }), hookServer })
  timeTracker = await registerNavigation(new WorkspaceNav({ desks: () => filterByView(service.state().desks, profiles.config().active, profiles.config()), files: filesService, layout: (id) => layouts.get(id), tmux: createTmuxAdmin() }), inUse, (deskId) => {
    // five minutes without input in a WorkDesk: the time stops counting; a small notice, no sound
    if (!Notification.isSupported()) return
    const name = service.state().desks.find((d) => d.id === deskId)?.name ?? deskId
    new Notification({ title: 'Time tracking paused', body: `No input for 5 minutes in “${name}”. It counts again when you type or move the mouse.`, silent: true }).show()
 }, (target) => deskOfEditorPath(service.state().desks, (id) => deskDir(root, id), target))
  app.on('will-quit', () => terminals.detachAll())
  app.on('before-quit', () => void service.status.autoCommit.flush())

  // ── Quitting: the terminals (and Claude in them) keep running in tmux unless you say otherwise
  const admin = createTmuxAdmin()
  let forcedStop = false
  const quitter = new QuitController({
    settings,
    running: async () => summarize(await admin.panes()),
    ask: async (running) => {
      const options: MessageBoxOptions = {
        type: 'question',
        message: 'Quit WorkDesk?',
        detail:
          `${describeRunning(running)}\n\n` +
          'They keep running in the background after you quit, so Claude can finish what it is doing. Open WorkDesk again to continue where you left off.\n\n' +
          'Stopping them ends every shell and everything running in it.',
        buttons: ['Quit, Keep Running', 'Quit and Stop Terminals', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        checkboxLabel: 'Remember my choice (change it in Settings → Behavior, or the WorkDesk menu)'
      }
      const win = BrowserWindow.getFocusedWindow()
      const r = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
      const action = (['keep', 'stop', 'cancel'] as const)[r.response] ?? 'cancel'
      return { action, remember: r.checkboxChecked && action !== 'cancel' }
    },
    stopAll: async () => {
      terminals.detachAll()
      await admin.killServer()
    }
  })
  let quitApproved = false
  let deciding = false
  app.on('before-quit', (e) => {
    if (quitApproved) return
    e.preventDefault()
    if (deciding) return
    deciding = true
    const stop = forcedStop
    forcedStop = false
    quitter
      .decide(stop ? 'stop' : undefined)
      // a problem with tmux must never keep you from quitting
      .catch((err) => (console.error('quit:', err), 'quit' as const))
      .then((r) => {
        deciding = false
        if (r === 'quit') {
          quitApproved = true
          app.quit()
        }
      })
  })

  const buildMenu = (): void => {
    const radio = (label: string, value: QuitBehavior) => ({
      label,
      type: 'radio' as const,
      checked: settings.quit === value,
      click: () => void settings.setQuit(value).then(buildMenu)
    })
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            {
              label: 'When Quitting',
              submenu: [radio('Ask What to Do With Running Terminals', 'ask'), radio('Keep Terminals Running', 'keep'), radio('Stop Terminals', 'stop')]
            },
            { type: 'separator' },
            { label: 'Park All WorkDesks…', click: () => BrowserWindow.getAllWindows()[0]?.webContents.send(IPC.menuAction, 'park-all') },
            { label: 'Reactivate All WorkDesks', click: () => BrowserWindow.getAllWindows()[0]?.webContents.send(IPC.menuAction, 'reactivate-all') },
            { type: 'separator' },
            { role: 'quit' },
            {
              label: 'Quit and Stop Terminals',
              accelerator: 'Alt+CmdOrCtrl+Q',
              click: () => {
                forcedStop = true
                app.quit()
              }
            }
          ]
        },
        { role: 'editMenu' },
        {
          label: 'View',
          submenu: [
            // the page of the browser Tab that is shown, not the whole app
            { label: 'Command Palette…', accelerator: 'CmdOrCtrl+P', click: () => BrowserWindow.getAllWindows()[0]?.webContents.send(IPC.menuAction, 'palette') },
            // the name on the clipboard, looked up as a class / interface / const … in the files of the WorkDesk
            // the key itself is taken in the windows' before-input-event (a page would swallow it); the menu only shows it
            { label: 'Go to Definition…', accelerator: 'CmdOrCtrl+D', registerAccelerator: process.platform !== 'darwin', click: () => BrowserWindow.getAllWindows()[0]?.webContents.send(IPC.menuAction, 'definition') },
            { type: 'separator' },
            { label: 'Reload Page', accelerator: 'CmdOrCtrl+R', click: () => BrowserWindow.getAllWindows()[0]?.webContents.send(IPC.menuAction, 'reload-page') },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' },
            // Chrome's developer tools of the page that is shown; the app's own are one Shift away
            { label: 'Developer Tools of the Page', accelerator: 'Alt+CmdOrCtrl+I', click: () => BrowserWindow.getAllWindows()[0]?.webContents.send(IPC.menuAction, 'page-devtools') },
            { label: 'Developer Tools of the App', accelerator: 'Shift+Alt+CmdOrCtrl+I', role: 'toggleDevTools' }
          ]
        },
        {
          label: 'Window',
          submenu: [
            // Command+W closes the Pane that has the focus (not the window, which has no other shortcut)
            { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => BrowserWindow.getAllWindows()[0]?.webContents.send(IPC.menuAction, 'new-tab') },
            { label: 'Reopen Closed Tab or Pane', accelerator: 'CmdOrCtrl+Shift+T', click: () => BrowserWindow.getAllWindows()[0]?.webContents.send(IPC.menuAction, 'reopen-closed') },
            { label: 'Close Pane', accelerator: 'CmdOrCtrl+W', click: () => BrowserWindow.getAllWindows()[0]?.webContents.send(IPC.menuAction, 'close-pane') },
            { type: 'separator' },
            { role: 'minimize' },
            { role: 'zoom' },
            { type: 'separator' },
            { role: 'front' }
          ]
        }
      ])
    )
  }
  refreshMenu = buildMenu
  buildMenu()

  createWindow()
  // links that came before the window was ready
  BrowserWindow.getAllWindows()[0]?.webContents.once('did-finish-load', () => setTimeout(() => pendingUrls.splice(0).forEach(showUrl), 500))
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
