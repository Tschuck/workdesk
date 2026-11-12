import type { JobInfo } from '../main/jobs'
import type { OrchestratorEntry } from '../main/orchestrator'
import type { SetupFacts } from './setup'
import type { CredentialKind, ProfilesState } from '../main/profiles-ipc'
import type { ProfilesConfig } from '../main/domain/profiles'
import type { NewRepoInput, ProfileChanges } from '../main/profiles-manager'
import type { ProviderKind } from '../main/sources/provider'
import type { ProviderStatus, Resolution } from '../main/sources/providers/registry'
import type { HistoryEntry } from '../main/domain/history'
import type { FileContent, FileRoot, RenameRequest, RenameResult, SearchHit, SearchQuery, UsageResult } from '../main/files'
import type { GitEntry } from '../main/domain/git-status'
import type { ReviewComment, ReviewNote } from '../main/domain/local-review'
import type { HeadFile } from '../main/git-service'
import type { ReviewState } from '../main/review-service'
import type { ReviewPreset } from '../main/domain/review-presets'
import type { Diagnostics } from '../main/diagnostics-service'
import type { CertificateInfo } from '../main/certificates'
import type { GroupSettings } from '../main/domain/bookmark-groups'
import type { ImportSource } from '../main/bookmark-import'
import type { ImportItem, ImportNode } from '../main/domain/bookmark-import'
import type { BranchPrs, DeskPrs } from '../main/sources/desk-prs'
import type { PrsState } from '../main/sources/prs-service'
import type { PreflightIssue } from '../main/projects/worktrees'
import type { ClearBranch, ClearBranchPick } from '../main/clear-service'
import type { ToolCheck } from '../main/tools-shared'
import type { DeskRunning } from '../main/park-all'
import type { DeskTemplate } from '../main/domain/templates'
import type { Schedule } from '../main/domain/schedule'
import type { PrTodoState } from '../main/domain/prs'
import type { PrTodoStates } from '../main/sources/pr-watch'
import type { PaneCwds } from '../main/domain/follow-cd'
import type { TimeLog } from '../main/domain/time-tracking'
import type { DeskFiles, TextQuery, WorkspaceHit } from '../main/domain/search-all'
import type { StartItemsRequest, BranchDetails, BranchRef, BranchSync, DeleteOptions, NewBranch, ProjectBranches } from '../main/branches-service'
import type { PullResult } from '../main/projects/repo-git'
import type { RestackStep } from '../main/domain/stack'
import type { ProjectInfo } from '../main/projects/projects'
import type { EnvActionResult } from '../main/projects/projects-service'
import type { Grant } from '../main/domain/page-origin'
import type { BrowserSessionsConfig } from '../main/domain/browser-sessions'
import type { InstalledExtension } from '../main/domain/extensions'
import type { Bookmark } from '../main/domain/bookmarks'
import type { NotionConfig, NotionTicket } from '../main/sources/notion/board'
import type { NotionState } from '../main/sources/notion/service'
import type { Candidate } from '../main/sources/source'
import type { GithubAuth } from '../main/sources/github/transport'
import type { AccountsState } from '../main/claude/accounts'
import type { ClaudeRow } from '../main/domain/claude-overview'
import type { ClaudeDirStatus } from '../main/claude/config'
import type { SkillStatus } from '../main/claude/skills'
import type { DeskLayout, PinnedTab, SplitDirection } from '../main/domain/layout'
import type { PerfLine, PerfSnapshot } from '../main/performance'
import type { SidebarPanels } from '../main/quit'
import type { CodeThemes, EditorFont } from '../main/vscode-themes'
import type { DeskEvent, RecentEvent } from '../main/domain/events'
import type { ArchivedTodo, DeskItem, Stage, Todo, TodoList, WorkDesk } from '../main/domain/types'

export interface AppState {
  todos: Todo[]
  desks: WorkDesk[]
}

export interface WorkDeskApi {
  getState(): Promise<AppState>
  addTodo(input: { title: string; topics: string[]; list: TodoList }): Promise<AppState>
  setTodoResolved(id: string, resolved: boolean): Promise<AppState>
  deleteTodo(id: string): Promise<AppState>
  /** put the resolved Todos away (those not in a WorkDesk); `all` also the ones resolved today */
  archiveResolvedTodos(all?: boolean): Promise<AppState>
  archivedTodos(): Promise<ArchivedTodo[]>
  restoreTodo(id: string): Promise<AppState>
  editTodo(id: string, patch: { title?: string; topics?: string[] }): Promise<AppState>
  placeTodo(id: string, refId: string, after: boolean): Promise<AppState>
  /** Todos of an open WorkDesk */
  deskAddTodo(deskId: string, todoId: string): Promise<AppState>
  deskRemoveTodo(todoId: string): Promise<AppState>
  /** a Pull request or ticket into an open WorkDesk */
  deskAddItem(deskId: string, item: DeskItem): Promise<AppState>
  /** a Pull request or ticket out of its WorkDesk */
  deskRemoveItem(deskId: string, kind: 'pr' | 'ticket', id: string): Promise<AppState>
  /** attach a web page (reference) to a WorkDesk or a Todo; kept with it in the Status Repo */
  addPageRef(target: { kind: 'desk' | 'todo'; id: string }, page: { url: string; title?: string; favicon?: string }): Promise<AppState>
  removePageRef(target: { kind: 'desk' | 'todo'; id: string }, refId: string): Promise<AppState>
  /** a Todo into another WorkDesk, or out of its WorkDesk with `null` */
  deskAssignTodo(todoId: string, deskId: string | null): Promise<AppState>
  deskNewTodo(deskId: string, title: string): Promise<AppState>
  /** a Todo captured for a WorkDesk, or for Today when there is none */
  captureTodo(deskId: string | null, title: string): Promise<AppState>
  /** reorder the checklist of a WorkDesk */
  placeDeskTodo(deskId: string, todoId: string, refId: string, after: boolean): Promise<AppState>
  stepDeskTodo(deskId: string, todoId: string, delta: -1 | 1): Promise<AppState>
  /** due time (epoch ms) of a Todo, or `null` for none; a reminder raises a Signal then */
  setTodoDue(id: string, dueAt: number | null): Promise<AppState>
  /** remind again at that time */
  snoozeTodo(id: string, until: number): Promise<AppState>
  /** notes of a Todo; `desk-<id>` is the scratch note of a WorkDesk */
  /** repeat a Todo (it needs a due time), or `null` to stop */
  setTodoRepeat(id: string, repeat: 'daily' | 'weekdays' | 'weekly' | null): Promise<AppState>
  /** a Plain WorkDesk from a template (Todos, Stage and Panes preset) */
  startTemplateDesk(templateId: string, name: string): Promise<AppState>
  /** repeating WorkDesks (schedules, kept in the Status Repo) */
  schedulesList(): Promise<Schedule[]>
  scheduleAdd(input: { templateId: string; name: string; repeat: 'daily' | 'weekdays' | 'weekly'; time: string }): Promise<Schedule[]>
  schedulePause(id: string, paused: boolean): Promise<Schedule[]>
  scheduleDelete(id: string): Promise<Schedule[]>
  /** WorkDesk templates: the built-in ones, then the user's own (kept in the Status Repo) */
  templatesList(): Promise<DeskTemplate[]>
  templateSave(deskId: string, name: string, kindsOnly: boolean): Promise<DeskTemplate[]>
  templateEdit(id: string, patch: { name?: string; stage?: Stage; todos?: string[] }): Promise<DeskTemplate[]>
  templateDelete(id: string): Promise<DeskTemplate[]>
  templateDuplicate(id: string): Promise<DeskTemplate[]>
  templateMove(id: string, delta: -1 | 1): Promise<DeskTemplate[]>
  scheduleTemplate(id: string, templateId: string): Promise<Schedule[]>
  readNotes(todoId: string): Promise<string>
  saveNotes(todoId: string, text: string): Promise<void>
  startPlainDesk(todoIds: string[], name: string): Promise<AppState>
  activateDesk(id: string): Promise<AppState>
  /** make one WorkDesk of several: each of `otherIds` goes into `targetId` (folders, pull requests, Todos, pages, note, time) and is cleared */
  combineDesks(targetId: string, otherIds: string[]): Promise<AppState>
  moveDesk(id: string, targetId: string): Promise<AppState>
  getLayout(deskId: string): Promise<DeskLayout>
  splitPane(deskId: string, tabId: string, paneId: string, direction: SplitDirection, kind?: 'terminal' | 'browser' | 'file', before?: boolean, url?: string): Promise<DeskLayout>
  setBrowserLocation(deskId: string, tabId: string, paneId: string, url: string, title?: string, favicon?: string): Promise<DeskLayout>
  closePane(deskId: string, tabId: string, paneId: string): Promise<DeskLayout>
  /** `url` is the address of a browser Tab, or the path of a file for a file Tab */
  /** `cwd`: where a new terminal starts (a branch folder of the WorkDesk) */
  addTab(deskId: string, kind?: 'terminal' | 'browser' | 'file', url?: string, cwd?: string): Promise<DeskLayout>
  /** the Review Tab of a WorkDesk (made when there is none); `activate` false leaves the Tab on screen as it is */
  openReviewTab(deskId: string, activate?: boolean): Promise<DeskLayout>
  setFileLocation(deskId: string, tabId: string, paneId: string, path: string | undefined, line?: number): Promise<DeskLayout>
  /** the shares of the children of a split, dragged by the user; `at`: the child indices on the way to it from the Tab's root */
  setSplitSizes(deskId: string, tabId: string, at: number[], sizes: number[]): Promise<DeskLayout>
  /** one browser Tab per page, e.g. all pull requests of a WorkDesk */
  addBrowserTabs(deskId: string, urls: string[]): Promise<DeskLayout>
  renameTab(deskId: string, tabId: string, name: string): Promise<DeskLayout>
  moveTab(deskId: string, tabId: string, targetId: string, after: boolean, keepGroup?: boolean): Promise<DeskLayout>
  /** to another Tab, or to a new one when `toTabId` is missing */
  movePane(deskId: string, tabId: string, paneId: string, toTabId?: string): Promise<DeskLayout>
  /** a Pane dropped beside / above another Pane (of the same Tab or another one) */
  movePaneBeside(deskId: string, fromTabId: string, paneId: string, toTabId: string, targetPaneId: string, direction: SplitDirection, before: boolean): Promise<DeskLayout>
  /** a Tab dropped on a group: its last Tab (an empty name: out of its group) */
  moveTabToGroup(deskId: string, tabId: string, group: string): Promise<DeskLayout>
  /** a whole group before / after another one */
  moveGroup(deskId: string, group: string, target: string, after: boolean): Promise<DeskLayout>
  /** puts a Tab in a group of the list of tabs (an empty name: out of its group) */
  /** list a Tab under a branch by hand (the folder of the branch), or give it back to the automatic place (empty) */
  setTabBranch(deskId: string, tabId: string, path: string): Promise<DeskLayout>
  setTabGroup(deskId: string, tabId: string, group: string): Promise<DeskLayout>
  /** brings back the Tab or Pane that was closed last in the WorkDesk (⌘⇧T) */
  reopenClosed(deskId: string): Promise<DeskLayout>
  /** pin a Tab or unpin it: pinned Tabs come first, show their icon only and are listed under their WorkDesk in the left panel */
  togglePinTab(deskId: string, tabId: string): Promise<DeskLayout>
  /** the pinned Tabs of every WorkDesk that has a saved layout */
  pinnedTabs(): Promise<Record<string, PinnedTab[]>>
  onPinnedTabs(listener: (pins: Record<string, PinnedTab[]>) => void): () => void
  /** a copy of a Tab with pages (its pages stay on their addresses), right after it */
  duplicateTab(deskId: string, tabId: string): Promise<DeskLayout>
  /** a Tab dropped on a Pane of another Tab: its content goes beside / above that Pane and the Tab is gone */
  mergeTab(deskId: string, fromTabId: string, toTabId: string, paneId: string, direction: SplitDirection, before: boolean): Promise<DeskLayout>
  setActiveTab(deskId: string, tabId: string): Promise<DeskLayout>
  /** unload the pages of a Tab to free memory (`on`), or load them again; terminals are not touched */
  hibernateTab(deskId: string, tabId: string, on: boolean, auto?: boolean): Promise<DeskLayout>
  /** memory (MB) of the process of each page, by the id of its web contents; for the tooltip of a Tab */
  pageMemory(): Promise<Record<number, number>>
  closeTab(deskId: string, tabId: string): Promise<DeskLayout>
  /** programs (other than a shell prompt) running in the Tab's terminals, or in one Pane of it */
  tabRunning(deskId: string, tabId: string, paneId?: string): Promise<string[]>
  /** the folder a terminal is in right now, and its git branch if it is in a repository */
  terminalInfo(deskId: string, paneId: string): Promise<{ cwd: string; display: string; branch?: string } | undefined>
  /** `mode`: 'none' = cached only, 'missing' = fetch what was never fetched, 'all' = refresh everything */
  prsList(mode: 'none' | 'missing' | 'all'): Promise<PrsState>
  prsAddRepo(repo: string): Promise<PrsState>
  prsRemoveRepo(repo: string): Promise<PrsState>
  prsSkip(id: string, on: boolean): Promise<PrsState>
  openExternal(url: string): Promise<void>
  /** put text on the system clipboard (a selection in a terminal) */
  writeClipboard(text: string): Promise<void>
  /** the colour themes of the extensions installed in VS Code, and the one it uses */
  codeThemes(): Promise<CodeThemes>
  /** the font of the editor in your VS Code (family, size, spacing), as far as it is set */
  codeFont(): Promise<EditorFont>
  /** the theme file of one of them (JSON of VS Code's theme format) */
  codeTheme(id: string): Promise<Record<string, unknown>>
  /** the text on the system clipboard (what Go to definition starts from) */
  readClipboard(): Promise<string>
  /** the git remote the Status Repo is pushed to, if any */
  statusRemote(repoId?: string): Promise<string | null>
  /** check, set and push to the remote; an empty text removes it. Rejects with git's message. */
  setStatusRemote(url: string, repoId?: string): Promise<string | null>
  checkTools(): Promise<ToolCheck[]>
  setupFacts(): Promise<SetupFacts>
  /** what the app, each WorkDesk's terminals, VS Code and tmux use right now */
  performance(): Promise<PerfSnapshot>
  /** only the totals; cheap enough for the left panel */
  performanceTotal(): Promise<PerfLine>
  /** what happens to the terminals when the app quits */
  quitGet(): Promise<'ask' | 'keep' | 'stop'>
  quitSet(value: 'ask' | 'keep' | 'stop'): Promise<'ask' | 'keep' | 'stop'>
  panelsGet(): Promise<SidebarPanels>
  panelsSet(patch: Partial<SidebarPanels>): Promise<SidebarPanels>
  /** the newest events of all WorkDesks together, each with its WorkDesk, newest first */
  recentEvents(limit?: number): Promise<RecentEvent[]>
  /** the newest entries of a WorkDesk's event log, newest first */
  deskEvents(deskId: string, limit?: number): Promise<DeskEvent[]>
  parkDesk(deskId: string): Promise<AppState>
  /** list the WorkDesk apart until then (ms since the epoch); `null` brings it back now */
  postponeDesk(deskId: string, until: number | null): Promise<AppState>
  /** live state of the Pull Requests behind review Todos, by `owner/repo#number` */
  prTodoStates(): Promise<PrTodoStates>
  refreshPrTodos(): Promise<PrTodoStates>
  /** the background round at once: pull requests of the branches, their states, review requests */
  refreshAll(): Promise<void>
  /** what is loading right now, and a listener for changes */
  jobs(): Promise<JobInfo[]>
  /** the orchestrator's Claude: where it runs (a tmux window shown like a terminal Pane) and under which Claude Account (none: the default) */
  orchestratorState(): Promise<{ accountId: string | null; deskId: string; paneId: string; cwd: string }>
  orchestratorSetAccount(id: string | null): Promise<void>
  /** ends its Claude; the next time the page is shown it starts again */
  orchestratorRestart(): Promise<void>
  /** what it started, newest first, and a listener for new entries */
  orchestratorHistory(): Promise<OrchestratorEntry[]>
  onOrchestratorHistory(listener: (entries: OrchestratorEntry[]) => void): () => void
  onJobs(listener: (jobs: JobInfo[]) => void): () => void
  onPrTodoStates(listener: (states: PrTodoStates) => void): () => void
  /** the Tabs of a WorkDesk were changed by the app itself (e.g. a setup terminal was added) */
  onLayoutChanged(listener: (deskId: string) => void): () => void
  /** what runs in each WorkDesk, and what parking would not bring back */
  parkAllPreflight(ids?: string[]): Promise<DeskRunning[]>
  /** park every WorkDesk, e.g. before restarting the machine; `quit` closes WorkDesk afterwards */
  /** every running WorkDesk, or only those of `ids` */
  parkAll(quit: boolean, ids?: string[]): Promise<AppState>
  /** everything parked comes back; `opened` is the WorkDesk that was open before */
  reactivateAll(ids?: string[]): Promise<{ state: AppState; opened?: string }>
  /** a menu item that needs the UI (the dialog) */
  /** a link opened from another app (WorkDesk being the default browser) */
  onOpenUrl(listener: (url: string) => void): () => void
  /** the WorkDesk whose Tab shows the page, if one does (only WorkDesks that are active are looked at) */
  findPage(url: string): Promise<{ deskId: string; tabId: string } | undefined>
  /** the certificate the server of this page showed (what the browser checked), once the page was loaded */
  certificateInfo(url: string): Promise<CertificateInfo | undefined>
  /** the folders whose files can be opened: the Branches of the WorkDesk and its scratch folder */
  filesRoots(deskId: string): Promise<FileRoot[]>
  /** the files of a root (relative paths): tracked and untracked, not ignored */
  filesList(deskId: string, rootPath: string): Promise<string[]>
  /** the folders of a scratch / notes / knowledge root with no file in them (the tree shows them, git does not list them) */
  filesEmptyFolders(deskId: string, rootPath: string): Promise<string[]>
  /** a new folder in scratch, notes or knowledge (parents are made); returns its path */
  /** a folder with everything in it to the Trash: scratch, notes, knowledge (not a root, not a Branch folder) */
  filesRemoveFolder(deskId: string, path: string): Promise<void>
  filesMakeFolder(deskId: string, dir: string, name: string): Promise<string>
  /** a file into a folder of a root, made when missing (`knowledge` + `payments`); returns its new path */
  filesMoveInto(deskId: string, path: string, rootPath: string, folder: string): Promise<string>
  filesRead(deskId: string, path: string): Promise<FileContent>
  /** the bytes of a file that is not text, for a PDF */
  filesReadBinary(deskId: string, path: string): Promise<Uint8Array>
  filesWrite(deskId: string, path: string, content: string): Promise<void>
  /** a new empty scratch file; returns its path */
  filesNewScratch(deskId: string): Promise<string>
  /** removes a scratch file that is still empty; true when it was removed */
  filesDropEmptyScratch(deskId: string, path: string): Promise<boolean>
  /** a copy next to the file (`name copy.ext`); returns its path */
  filesDuplicate(deskId: string, path: string): Promise<string>
  /** another name in the same folder; returns the new path */
  filesRename(deskId: string, path: string, name: string): Promise<string>
  /** a file into another folder of the WorkDesk (a Branch, the notes, scratch); returns its new path */
  filesMove(deskId: string, path: string, destDir: string): Promise<string>
  /** moves the file to the Trash */
  filesRemove(deskId: string, path: string): Promise<void>
  /** a new empty file (`sub/dir/name.ext` is made as needed) in a folder; returns its path */
  filesCreate(deskId: string, dir: string, name: string): Promise<string>
  filesSearch(deskId: string, rootPath: string, query: SearchQuery): Promise<SearchHit[]>
  /** every whole-word match of a name in the files of a root (text based, no language server) */
  filesUsages(deskId: string, rootPath: string, word: string, glob: string): Promise<UsageResult>
  /** writes a new name at the given places of the files (only inside the given roots); reports per file */
  filesRenameSymbol(deskId: string, request: RenameRequest): Promise<RenameResult>
  /** show the file (at a line) in the WorkDesk's VS Code window */
  filesOpenInEditor(deskId: string, path: string, line?: number): Promise<void>
  /** status of a Branch folder (a root from `filesRoots`): changed files, staged and unstaged */
  gitStatus(deskId: string, rootPath: string): Promise<GitEntry[]>
  /** a file as HEAD has it, for the diff view */
  gitHead(deskId: string, rootPath: string, path: string): Promise<HeadFile>
  gitStage(deskId: string, rootPath: string, paths: string[]): Promise<void>
  gitUnstage(deskId: string, rootPath: string, paths: string[]): Promise<void>
  /** a commit with the user's configuration (signing included); rejects with the message of the tool; returns its first line */
  gitCommit(deskId: string, rootPath: string, message: string): Promise<string>
  /** TypeScript problems of a Branch folder (its own tsc), on request */
  diagnosticsCheck(deskId: string, rootPath: string): Promise<Diagnostics>
  /** review mode: changed files since the merge base with the base branch, and the comments */
  reviewState(deskId: string, rootPath: string): Promise<ReviewState>
  reviewBranches(deskId: string, rootPath: string): Promise<string[]>
  /** the newest commits of the folder's Branch, to pick one as the base of the review */
  reviewCommits(deskId: string, rootPath: string): Promise<{ sha: string; title: string }[]>
  /** the Review presets of a WorkDesk: which of the changed files a review shows */
  reviewPresets(deskId: string): Promise<ReviewPreset[]>
  reviewPresetRemove(deskId: string, id: string): Promise<ReviewPreset[]>
  reviewSetBase(deskId: string, rootPath: string, base: string): Promise<void>
  /** a file as it was at the merge base */
  reviewBaseFile(deskId: string, rootPath: string, path: string): Promise<HeadFile>
  reviewAddComment(deskId: string, rootPath: string, path: string, line: number, text: string): Promise<ReviewComment>
  reviewUpdateComment(deskId: string, rootPath: string, id: string, text: string): Promise<void>
  reviewRemoveComment(deskId: string, rootPath: string, id: string): Promise<void>
  reviewClearComments(deskId: string, rootPath: string): Promise<void>
  /** a comment on the review as a whole, not on a line */
  reviewAddNote(deskId: string, rootPath: string, text: string): Promise<ReviewNote>
  reviewUpdateNote(deskId: string, rootPath: string, id: string, text: string): Promise<void>
  reviewRemoveNote(deskId: string, rootPath: string, id: string): Promise<void>
  /** the path of `.review/comments.md` of the folder */
  /** the visited pages that fit what was typed (title or address), best first */
  historySearch(query: string, limit?: number): Promise<HistoryEntry[]>
  /** the overview of the visited pages, newest first */
  historyList(query?: string, limit?: number): Promise<HistoryEntry[]>
  /** forget the pages last visited on one day (its local midnight) */
  historyForgetDay(dayStart: number): Promise<HistoryState>
  /** forget pages older than this many days, now and every day; 0 keeps everything */
  historyKeepDays(days: number): Promise<HistoryState>
  historyForget(url: string): Promise<HistoryState>
  historyState(): Promise<HistoryState>
  historySet(enabled: boolean): Promise<HistoryState>
  historyClear(): Promise<HistoryState>
  /** can WorkDesk be the default browser (only the packaged app), and is it */
  defaultBrowser(): Promise<{ canBe: boolean; isDefault: boolean }>
  makeDefaultBrowser(): Promise<{ canBe: boolean; isDefault: boolean }>
  onMenuAction(listener: (action: 'park-all' | 'reactivate-all' | 'reload-page' | 'close-pane' | 'new-tab' | 'page-devtools' | 'palette' | 'reopen-closed' | 'definition' | 'capture-todo' | 'what-next' | `open-desk:${string}`) => void): () => void
  renameDesk(deskId: string, name: string): Promise<AppState>
  setDeskStage(deskId: string, stage: Stage | 'auto'): Promise<AppState>
  /** group the list of tabs of the WorkDesk by branch, or not */
  setDeskGroupByBranch(deskId: string, on: boolean): Promise<AppState>
  clearPreflight(deskId: string): Promise<PreflightIssue[]>
  /** every Branch of the WorkDesk with where it exists, to tick the ones to delete with it */
  clearBranches(deskId: string): Promise<ClearBranch[]>
  /** `deleteBranches`: what to delete of the Branches (the local copy, the one on the remote) once their folders are gone */
  clearDesk(deskId: string, deleteBranches?: ClearBranchPick[]): Promise<AppState>
  reactivateDesk(deskId: string): Promise<AppState>
  listProjects(): Promise<ProjectInfo[]>
  addProjectClone(name: string, url: string): Promise<ProjectInfo[]>
  addProjectExisting(name: string, path: string): Promise<ProjectInfo[]>
  renameProject(from: string, to: string): Promise<ProjectInfo[]>
  removeProject(name: string): Promise<ProjectInfo[]>
  moveProject(name: string, toIndex: number): Promise<ProjectInfo[]>
  setEnvSetup(name: string, commands: string[]): Promise<ProjectInfo[]>
  /** commands run in a terminal of the WorkDesk whenever a Branch of the Project is checked out */
  setCheckoutCommands(name: string, commands: string[]): Promise<ProjectInfo[]>
  /** link the stored `.env` files into every new Branch of the Project (the default) or not */
  setSharedEnv(name: string, on: boolean): Promise<ProjectInfo[]>
  envSync(deskId: string, project: string, branch: string): Promise<EnvActionResult>
  envLink(deskId: string, project: string, branch: string, force?: boolean): Promise<EnvActionResult>
  envSetup(deskId: string, project: string, branch: string): Promise<EnvActionResult>
  /** the `.env` files of this WorkDesk become the stored base for other Branches */
  envSyncDesk(deskId: string): Promise<EnvActionResult>
  /** link the stored `.env` files into every Branch of this WorkDesk */
  envLinkDesk(deskId: string, force?: boolean): Promise<EnvActionResult>
  /** `refresh` queries the board again; otherwise the last result is returned */
  notionState(refresh: boolean): Promise<NotionState>
  notionSaveClient(clientId: string, clientSecret: string): Promise<NotionState>
  /** opens the browser for consent and resolves once connected */
  notionConnect(): Promise<NotionState>
  notionCancelConnect(): Promise<void>
  notionDisconnect(): Promise<NotionState>
  notionSetConfig(config: NotionConfig): Promise<NotionState>
  notionStatusTickets(status: string): Promise<NotionState>
  notionClaim(pageId: string): Promise<NotionState>
  /** a ticket as it is now, with the text of its page */
  notionTicket(pageId: string, refresh?: boolean): Promise<{ ticket: NotionTicket; lines: string[] }>
  /** a WorkDesk from several work items: Todos, Pull Requests, tickets, branches */
  startFromItems(request: StartItemsRequest): Promise<AppState>
  /** `refresh` fetches every Project's remote first */
  listBranches(refresh: boolean): Promise<ProjectBranches[]>
  createDeskFromBranches(selection: BranchRef[], name: string, newBranches?: NewBranch[]): Promise<AppState>
  /** what would be lost if the branch's folder were removed from its WorkDesk */
  removeBranchPreflight(deskId: string, project: string, branch: string): Promise<PreflightIssue[]>
  removeBranchFromDesk(deskId: string, project: string, branch: string): Promise<AppState>
  branchDetails(project: string, branch: string): Promise<BranchDetails>
  branchPrs(project: string, branch: string): Promise<BranchPrs>
  /** returns the refreshed branch lists */
  deleteBranch(project: string, branch: string, opts: DeleteOptions): Promise<ProjectBranches[]>
  /** Pull Requests of a WorkDesk's branches; `refresh` skips the one-minute cache */
  deskPrs(deskId: string, refresh: boolean): Promise<DeskPrs>
  /** how far each branch of a WorkDesk is behind or ahead of its remote branch */
  deskSync(deskId: string): Promise<BranchSync[]>
  /** fetch the remotes first, then the same */
  deskFetch(deskId: string): Promise<BranchSync[]>
  deskPull(deskId: string, project: string, branch: string): Promise<PullResult>
  /** existing branches, of any Project, into an open WorkDesk */
  addExistingBranches(deskId: string, selection: BranchRef[]): Promise<AppState>
  addBranch(deskId: string, project: string, branch: string, base?: string): Promise<AppState>
  restackPlan(deskId: string): Promise<RestackStep[]>
  githubStatus(): Promise<GithubAuth>
  githubSetToken(token: string): Promise<GithubAuth>
  githubClearToken(): Promise<GithubAuth>
  /** GitLab and Jira connections (tokens live in the Keychain and never come back) */
  providerStatus(): Promise<ProviderStatus[]>
  providerSave(kind: ProviderKind, input: { baseUrl?: string; email?: string; token?: string }): Promise<ProviderStatus[]>
  providerClear(kind: ProviderKind): Promise<ProviderStatus[]>
  providerTest(kind: ProviderKind): Promise<{ ok: boolean; message: string }>
  /** which provider serves a git remote, and why */
  providerResolve(remoteUrl: string): Promise<Resolution | undefined>
  /** force the provider of a repository or host; `undefined` takes the setting away */
  providerForce(remoteUrl: string, scope: 'repo' | 'host', kind: ProviderKind | undefined): Promise<Resolution | undefined>
  /** `refresh` skips the kept answer (five minutes) and asks the source again */
  candidates(sourceId: string, refresh?: boolean): Promise<Candidate[]>
  /** the user's own open Pull Requests with changes requested, failing checks or conflicts */
  myPrsNeedingWork(refresh?: boolean): Promise<Candidate[]>
  /** every open pull request of the user's, with where it stands as the hint */
  myPrs(refresh?: boolean): Promise<Candidate[]>
  /** where one Pull Request (`owner/repo#12`) stands now */
  prState(id: string, refresh?: boolean): Promise<PrTodoState>
  /** the registered Project a Pull Request belongs to and its head branch */
  prBranch(id: string, refresh?: boolean): Promise<{ project?: string; branch?: string }>
  /** when the oldest kept remote answer whose key starts with `prefix` was read, for "updated 3 min ago" */
  remoteAge(prefix: string): Promise<number | undefined>
  /** a kept remote answer was replaced or dropped: the key */
  onRemoteChanged(listener: (key: string) => void): () => void
  skipCandidate(sourceId: string, candidateId: string): Promise<void>
  /** check the branch out of a Review WorkDesk that was started without one */
  checkoutReviewBranch(deskId: string): Promise<AppState>
  markSignalRead(deskId: string, signalId: string): Promise<AppState>
  /** show the WorkDesk as unread, as a reminder; opening it clears that */
  markUnread(deskId: string): Promise<AppState>
  /** Tab holding the Pane of the oldest open Signal, if it has one */
  getJumpTarget(deskId: string): Promise<{ tabId: string; paneId: string } | undefined>
  paneFocus(deskId: string, paneId: string, focused: boolean): void
  onStateChanged(listener: (state: AppState) => void): () => void
  /** the Claude Accounts with their login and usage */
  accountsState(): Promise<AccountsState>
  onAccountsChanged(listener: (state: AccountsState) => void): () => void
  /** Profiles: the list, the Status Repos and which credentials each has */
  profilesState(): Promise<ProfilesState>
  onProfilesChanged(listener: (config: ProfilesConfig) => void): () => void
  /** which Profile is in view (an id, or 'all') */
  profilesSetActive(view: string): Promise<ProfilesState>
  /** store a token (GitHub, GitLab, Jira) for a Profile; it goes to the keychain and is never read back */
  profilesSetToken(id: string, kind: CredentialKind, token: string): Promise<ProfilesState>
  profilesClearToken(id: string, kind: CredentialKind): Promise<ProfilesState>
  profilesAdd(name: string, repoId?: string): Promise<ProfilesState>
  profilesUpdate(id: string, changes: ProfileChanges): Promise<ProfilesState>
  /** Todos, WorkDesks and Projects of the Profile go to the Default Profile; its credentials are removed */
  profilesRemove(id: string): Promise<ProfilesState>
  /** register a Status Repo: point to a folder (made if new) or clone a remote */
  profilesAddRepo(input: NewRepoInput): Promise<ProfilesState>
  profilesForgetRepo(id: string): Promise<ProfilesState>
  /** list a Project under a Profile (null: the Default one) */
  profilesSetProjectProfile(name: string, profileId: string | null): Promise<ProfilesState>
  accountsAdd(name: string, configDir?: string): Promise<AccountsState>
  accountsRename(id: string, name: string): Promise<AccountsState>
  /** an empty folder = the default login */
  accountsSetDir(id: string, configDir: string): Promise<AccountsState>
  accountsSetDefault(id: string): Promise<AccountsState>
  accountsRemove(id: string): Promise<AccountsState>
  accountsSetEnabled(enabled: boolean): Promise<AccountsState>
  accountsSetInterval(minutes: number): Promise<AccountsState>
  /** read the usage now: of one Account, or of all */
  accountsRefresh(id?: string): Promise<void>
  /** only on the user's request: Claude Code opens the browser */
  accountsLogin(id: string): Promise<void>
  accountsCancelLogin(id: string): Promise<void>
  accountsLogout(id: string): Promise<void>
  /** the Account a WorkDesk's terminals run `claude` under; null = the default Account */
  setDeskClaudeAccount(deskId: string, accountId: string | null): Promise<AppState>
  /** every running Claude session of the WorkDesks in use */
  claudeOverview(): Promise<ClaudeRow[]>
  claudeDirs(): Promise<ClaudeDirStatus[]>
  claudeAddDir(path: string): Promise<ClaudeDirStatus[]>
  claudeRemoveDir(path: string): Promise<ClaudeDirStatus[]>
  claudeInstall(path: string): Promise<ClaudeDirStatus[]>
  claudeUninstall(path: string): Promise<ClaudeDirStatus[]>
  /** the bundled skills for Claude Code in WorkDesks, and whether a config directory has them */
  claudeSkills(path: string): Promise<SkillStatus[]>
  claudeSkillsInstall(path: string): Promise<SkillStatus[]>
  claudeSkillsUninstall(path: string): Promise<SkillStatus[]>
  claudeDefaultDirs(): Promise<string[]>
  /** is the WorkDesk's VS Code window open (nothing is started) */
  editorIsOpen(deskId: string): Promise<boolean>
  /** bring the WorkDesk's VS Code window to the front, opening it when needed; it is never moved or resized */
  editorOpen(deskId: string): Promise<void>
  editorFocusFolder(deskId: string, folderPath: string): Promise<void>
  editorClose(deskId: string): Promise<void>
  /** `viewId`: one more look at a running Pane, apart from its own (input, resize, data and detach then go by the view id) */
  terminalAttach(deskId: string, paneId: string, cwd: string, cols: number, rows: number, viewId?: string): Promise<void>
  terminalDetach(paneId: string): void
  terminalInput(paneId: string, data: string): void
  terminalResize(paneId: string, cols: number, rows: number): void
  /** Ctrl+Tab pressed inside a browser pane, which does not pass key events on to the app */
  browserSessionsGet(): Promise<BrowserSessionsConfig>
  browserSessionsSet(config: BrowserSessionsConfig): Promise<BrowserSessionsConfig>
  /** forget cookies, logins and storage of a session (no id: the shared one) */
  browserSessionsClear(id?: string): Promise<void>
  /** a page wants to go to a domain of another session: the web contents id and the address */
  onSwitchSession(listener: (webContentsId: number, url: string) => void): () => void
  /** sites that cannot be loaded (Settings → Browser → Blocked sites); a pass opens one page of one for a while */
  siteBlockList(): Promise<string[]>
  siteBlockAdd(site: string): Promise<string[]>
  siteBlockRemove(site: string): Promise<string[]>
  /** the rule that stops this address right now, or none (also none while it has a pass) */
  siteBlockCheck(url: string): Promise<string | undefined>
  siteBlockPass(url: string): Promise<void>
  /** a page of a Pane was stopped by a rule */
  onSiteBlocked(listener: (webContentsId: number, url: string, rule: string) => void): () => void
  pagePermissionsList(): Promise<Grant[]>
  /** allow a site without being asked, from its site settings */
  pagePermissionsAllow(origin: string, permission: Grant['permission']): Promise<Grant[]>
  pagePermissionsRevoke(origin: string, permission: Grant['permission']): Promise<Grant[]>
  /** the page that is shown is the active tab for the extensions (their buttons and `chrome.tabs`) */
  extensionsSelectTab(webContentsId: number): void
  extensionsList(): Promise<InstalledExtension[]>
  /** from a Chrome Web Store address or id */
  extensionsInstall(input: string): Promise<InstalledExtension[]>
  extensionsRemove(id: string): Promise<InstalledExtension[]>
  extensionsUpdate(): Promise<InstalledExtension[]>
  bookmarksList(): Promise<Bookmark[]>
  bookmarksAdd(title: string, url: string, favicon?: string): Promise<Bookmark[]>
  bookmarksIcon(url: string, favicon: string): Promise<Bookmark[]>
  bookmarksRemove(id: string): Promise<Bookmark[]>
  bookmarksRename(id: string, title: string): Promise<Bookmark[]>
  /** the browsers whose bookmarks can be taken over (Vivaldi and Firefox profiles found on this Mac) */
  bookmarksImportSources(): Promise<ImportSource[]>
  /** the folders and pages of one of them */
  bookmarksImportRead(id: string): Promise<ImportNode[]>
  /** make favorites of the picked pages; the ones that exist are skipped */
  bookmarksImport(items: ImportItem[]): Promise<{ added: number; skipped: number }>
  /** how the groups of the favorites are ordered and which are closed */
  bookmarksGroupSettings(): Promise<GroupSettings>
  bookmarksGroupSettingsSet(settings: GroupSettings): Promise<GroupSettings>
  onBookmarkGroupSettings(listener: (settings: GroupSettings) => void): () => void
  /** give a group another name (the same name as another group merges them) */
  bookmarksRenameGroup(from: string, to: string): Promise<Bookmark[]>
  bookmarksGroup(id: string, group: string): Promise<Bookmark[]>
  /** point a favorite at another address; rejects an address that is not http(s) or already a favorite */
  bookmarksSetUrl(id: string, url: string): Promise<Bookmark[]>
  onBookmarksChanged(listener: (list: Bookmark[]) => void): () => void
  /** Ctrl+Tab (next / previous Tab); with `recent`, Opt+Tab (in the order of use), and delta 0 when Option is released */
  onCycleTab(listener: (delta: 1 | -1 | 0, recent?: boolean) => void): () => void
  /** Command+F in a browser page: the id of the page's web contents */
  onFindInPage(listener: (webContentsId: number) => void): () => void
  /** a key a browser page took that the Panes need: Command+arrows, Command+Shift+arrows */
  onPaneKey(listener: (key: { key: string; shiftKey: boolean; fromWindow?: boolean }) => void): () => void
  /** a link of a page was opened with the middle mouse button (or Cmd-click): the web contents id of the page and the link */
  /** a Pane tells whether pages can be attached from it (it is in a running WorkDesk), so its right-click menu offers it; `deskName` is shown */
  setPageAttachable(webContentsId: number, deskName: string | null): Promise<void>
  /** an entry of a page's right-click menu that the Pane has to carry out */
  onPageMenuAction(listener: (webContentsId: number, action: 'attach-desk' | 'attach-todo') => void): () => void
  onOpenTab(listener: (webContentsId: number, url: string) => void): () => void
  onTerminalData(listener: (paneId: string, data: string) => void): () => void
  onTerminalExit(listener: (paneId: string) => void): () => void
  /** the files of every started WorkDesk, for opening a file of any of them */
  navFiles(): Promise<DeskFiles[]>
  /** text in the files of every started WorkDesk (grep) */
  navGrep(query: SearchQuery): Promise<WorkspaceHit[]>
  /** lines in the output (and scrollback) of the terminals of every started WorkDesk */
  navTerminals(query: TextQuery): Promise<WorkspaceHit[]>
  /** the folder every terminal is in right now (tmux `pane_current_path`), per WorkDesk and Pane */
  terminalCwds(): Promise<PaneCwds>
  onTerminalCwds(listener: (cwds: PaneCwds) => void): () => void
  /** tells which WorkDesk is on screen (none: another page), for the time tracking */
  timeShown(deskId: string | undefined): void
  /** seconds per WorkDesk per day, the last 90 days */
  timeLog(): Promise<TimeLog>
}

/** One persistent session for every Browser Pane, so logins survive restarts and are shared across WorkDesks. */
export { ROOT_PARTITION as BROWSER_PARTITION } from '../main/domain/browser-sessions'

export interface HistoryState {
  enabled: boolean
  count: number
  /** pages older than this many days are forgotten; 0 keeps them */
  keepDays: number
}

export const IPC = {
  getState: 'state:get',
  addTodo: 'todos:add',
  setTodoResolved: 'todos:resolve',
  deleteTodo: 'todos:delete',
  archiveResolvedTodos: 'todos:archive-resolved',
  archivedTodos: 'todos:archived',
  restoreTodo: 'todos:restore',
  editTodo: 'todos:edit',
  placeTodo: 'todos:place',
  deskAddTodo: 'desks:add-todo',
  deskRemoveTodo: 'desks:remove-todo',
  deskRemoveItem: 'desks:remove-item',
  deskAddItem: 'desks:add-item',
  addPageRef: 'refs:add',
  removePageRef: 'refs:remove',
  deskAssignTodo: 'desks:assign-todo',
  deskNewTodo: 'desks:new-todo',
  captureTodo: 'todos:capture',
  placeDeskTodo: 'desks:place-todo',
  stepDeskTodo: 'desks:step-todo',
  setTodoDue: 'todos:set-due',
  snoozeTodo: 'todos:snooze',
  setTodoRepeat: 'todos:set-repeat',
  startTemplateDesk: 'desks:start-template',
  schedulesList: 'schedules:list',
  scheduleAdd: 'schedules:add',
  schedulePause: 'schedules:pause',
  scheduleDelete: 'schedules:delete',
  templatesList: 'templates:list',
  templateSave: 'templates:save',
  templateEdit: 'templates:edit',
  templateDelete: 'templates:delete',
  templateDuplicate: 'templates:duplicate',
  templateMove: 'templates:move',
  scheduleTemplate: 'schedules:template',
  readNotes: 'todos:read-notes',
  saveNotes: 'todos:save-notes',
  startPlainDesk: 'desks:start-plain',
  activateDesk: 'desks:activate',
  combineDesks: 'desks:combine',
  moveDesk: 'desks:move',
  getLayout: 'layout:get',
  splitPane: 'layout:split',
  closePane: 'layout:close-pane',
  setBrowserLocation: 'layout:set-browser-location',
  setFileLocation: 'layout:set-file-location',
  setSplitSizes: 'layout:set-split-sizes',
  addTab: 'layout:add-tab',
  openReviewTab: 'layout:open-review-tab',
  addBrowserTabs: 'layout:add-browser-tabs',
  renameTab: 'layout:rename-tab',
  moveTab: 'layout:move-tab',
  movePane: 'layout:move-pane',
  mergeTab: 'layout:merge-tab',
  movePaneBeside: 'layout:move-pane-beside',
  duplicateTab: 'layout:duplicate-tab',
  togglePinTab: 'layout:toggle-pin',
  reopenClosed: 'layout:reopen-closed',
  setTabGroup: 'layout:set-tab-group',
  setTabBranch: 'layout:set-tab-branch',
  moveTabToGroup: 'layout:move-tab-to-group',
  moveGroup: 'layout:move-group',
  pinnedTabs: 'layout:pinned-tabs',
  pinnedTabsChanged: 'layout:pinned-tabs-changed',
  navFiles: 'nav:files',
  navGrep: 'nav:grep',
  navTerminals: 'nav:terminals',
  terminalCwds: 'nav:terminal-cwds',
  terminalCwdsChanged: 'nav:terminal-cwds-changed',
  timeShown: 'time:shown',
  timeLog: 'time:log',
  setActiveTab: 'layout:set-active-tab',
  hibernateTab: 'layout:hibernate-tab',
  pageMemory: 'pages:memory',
  closeTab: 'layout:close-tab',
  tabRunning: 'layout:tab-running',
  terminalInfo: 'terminal:info',
  prsList: 'prs:list',
  prsAddRepo: 'prs:add-repo',
  prsRemoveRepo: 'prs:remove-repo',
  prsSkip: 'prs:skip',
  openExternal: 'app:open-external',
  writeClipboard: 'app:clipboard',
  readClipboard: 'app:clipboard-read',
  codeThemes: 'app:code-themes',
  codeFont: 'app:code-font',
  codeTheme: 'app:code-theme',
  statusRemote: 'status:remote',
  setStatusRemote: 'status:set-remote',
  checkTools: 'tools:check',
  setupFacts: 'setup:facts',
  performance: 'app:performance',
  performanceTotal: 'app:performance-total',
  quitGet: 'app:quit-get',
  quitSet: 'app:quit-set',
  panelsGet: 'app:panels-get',
  panelsSet: 'app:panels-set',
  deskEvents: 'desks:events',
  recentEvents: 'desks:recent-events',
  parkDesk: 'desks:park',
  postponeDesk: 'desks:postpone',
  prTodoStates: 'prtodos:get',
  refreshPrTodos: 'prtodos:refresh',
  refreshAll: 'app:refresh-all',
  jobs: 'app:jobs',
  orchestratorState: 'orchestrator:state',
  orchestratorSetAccount: 'orchestrator:set-account',
  orchestratorRestart: 'orchestrator:restart',
  orchestratorHistory: 'orchestrator:history',
  orchestratorHistoryChanged: 'orchestrator:history-changed',
  jobsChanged: 'app:jobs-changed',
  prTodosChanged: 'prtodos:changed',
  parkAllPreflight: 'desks:park-all-preflight',
  parkAll: 'desks:park-all',
  reactivateAll: 'desks:reactivate-all',
  menuAction: 'menu:action',
  openUrl: 'app:open-url',
  findPage: 'layout:find-page',
  filesRoots: 'files:roots',
  filesList: 'files:list',
  filesEmptyFolders: 'files:empty-folders',
  filesMakeFolder: 'files:make-folder',
  filesRemoveFolder: 'files:remove-folder',
  filesMoveInto: 'files:move-into',
  filesRead: 'files:read',
  filesReadBinary: 'files:read-binary',
  filesWrite: 'files:write',
  filesNewScratch: 'files:new-scratch',
  filesDropEmptyScratch: 'files:drop-empty-scratch',
  filesSearch: 'files:search',
  filesUsages: 'files:usages',
  filesRenameSymbol: 'files:rename-symbol',
  filesDuplicate: 'files:duplicate',
  filesRename: 'files:rename',
  filesRemove: 'files:remove',
  filesMove: 'files:move',
  filesCreate: 'files:create',
  filesOpenInEditor: 'files:open-in-editor',
  gitStatus: 'git:status',
  gitHead: 'git:head',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitCommit: 'git:commit',
  diagnosticsCheck: 'diagnostics:check',
  reviewState: 'review:state',
  reviewBranches: 'review:branches',
  reviewCommits: 'review:commits',
  reviewPresets: 'review:presets',
  reviewPresetRemove: 'review:preset-remove',
  reviewSetBase: 'review:set-base',
  reviewBaseFile: 'review:base-file',
  reviewAddComment: 'review:add-comment',
  reviewUpdateComment: 'review:update-comment',
  reviewRemoveComment: 'review:remove-comment',
  reviewClearComments: 'review:clear-comments',
  reviewAddNote: 'review:add-note',
  reviewUpdateNote: 'review:update-note',
  reviewRemoveNote: 'review:remove-note',
  certificateInfo: 'page:certificate',
  historySearch: 'history:search',
  historyList: 'history:list',
  historyForget: 'history:forget',
  historyForgetDay: 'history:forget-day',
  historyKeepDays: 'history:keep-days',
  historyState: 'history:state',
  historySet: 'history:set',
  historyClear: 'history:clear',
  defaultBrowser: 'app:default-browser',
  makeDefaultBrowser: 'app:make-default-browser',
  renameDesk: 'desks:rename',
  setDeskStage: 'desks:set-stage',
  setDeskGroupByBranch: 'desks:group-by-branch',
  clearPreflight: 'desks:clear-preflight',
  clearBranches: 'desks:clear-branches',
  clearDesk: 'desks:clear',
  reactivateDesk: 'desks:reactivate',
  listProjects: 'projects:list',
  addProjectClone: 'projects:add-clone',
  addProjectExisting: 'projects:add-existing',
  renameProject: 'projects:rename',
  removeProject: 'projects:remove',
  moveProject: 'projects:move',
  setEnvSetup: 'projects:set-env-setup',
  setCheckoutCommands: 'projects:set-checkout-commands',
  setSharedEnv: 'projects:set-shared-env',
  layoutChanged: 'layout:changed',
  envSync: 'env:sync',
  envLink: 'env:link',
  envSetup: 'env:setup',
  envSyncDesk: 'env:sync-desk',
  envLinkDesk: 'env:link-desk',
  notionState: 'notion:state',
  notionSaveClient: 'notion:save-client',
  notionConnect: 'notion:connect',
  notionCancelConnect: 'notion:cancel-connect',
  notionDisconnect: 'notion:disconnect',
  notionSetConfig: 'notion:set-config',
  notionStatusTickets: 'notion:status-tickets',
  notionClaim: 'notion:claim',
  notionTicket: 'notion:ticket',
  startFromItems: 'desks:start-from-items',
  listBranches: 'branches:list',
  createDeskFromBranches: 'branches:create-desk',
  removeBranchPreflight: 'branches:remove-preflight',
  removeBranchFromDesk: 'branches:remove-from-desk',
  branchDetails: 'branches:details',
  branchPrs: 'branches:branch-prs',
  deleteBranch: 'branches:delete',
  deskPrs: 'branches:prs',
  deskSync: 'branches:sync',
  deskFetch: 'branches:fetch',
  deskPull: 'branches:pull',
  addExistingBranches: 'branches:add-existing',
  addBranch: 'branches:add',
  restackPlan: 'branches:restack-plan',
  githubStatus: 'github:status',
  githubSetToken: 'github:set-token',
  githubClearToken: 'github:clear-token',
  providerStatus: 'provider:status',
  providerSave: 'provider:save',
  providerClear: 'provider:clear',
  providerTest: 'provider:test',
  providerResolve: 'provider:resolve',
  providerForce: 'provider:force',
  candidates: 'sources:candidates',
  myPrsNeedingWork: 'sources:mine',
  myPrs: 'sources:my-prs',
  prState: 'sources:pr-state',
  prBranch: 'sources:pr-branch',
  remoteAge: 'remote:age',
  remoteChanged: 'remote:changed',
  skipCandidate: 'sources:skip',
  checkoutReviewBranch: 'desks:checkout-review',
  markSignalRead: 'signals:mark-read',
  markUnread: 'signals:mark-unread',
  getJumpTarget: 'signals:jump-target',
  paneFocus: 'signals:pane-focus',
  stateChanged: 'state:changed',
  accountsState: 'accounts:state',
  accountsChanged: 'accounts:changed',
  profilesState: 'profiles:state',
  profilesChanged: 'profiles:changed',
  profilesSetActive: 'profiles:set-active',
  profilesSetToken: 'profiles:set-token',
  profilesClearToken: 'profiles:clear-token',
  profilesAdd: 'profiles:add',
  profilesUpdate: 'profiles:update',
  profilesRemove: 'profiles:remove',
  profilesAddRepo: 'profiles:add-repo',
  profilesForgetRepo: 'profiles:forget-repo',
  profilesSetProjectProfile: 'profiles:set-project-profile',
  accountsAdd: 'accounts:add',
  accountsRename: 'accounts:rename',
  accountsSetDir: 'accounts:set-dir',
  accountsSetDefault: 'accounts:set-default',
  accountsRemove: 'accounts:remove',
  accountsSetEnabled: 'accounts:set-enabled',
  accountsSetInterval: 'accounts:set-interval',
  accountsRefresh: 'accounts:refresh',
  accountsLogin: 'accounts:login',
  accountsCancelLogin: 'accounts:cancel-login',
  accountsLogout: 'accounts:logout',
  setDeskClaudeAccount: 'desk:set-claude-account',
  claudeOverview: 'claude:overview',
  claudeDirs: 'claude:dirs',
  claudeSkills: 'claude:skills',
  claudeSkillsInstall: 'claude:skills-install',
  claudeSkillsUninstall: 'claude:skills-uninstall',
  claudeAddDir: 'claude:add-dir',
  claudeRemoveDir: 'claude:remove-dir',
  claudeInstall: 'claude:install',
  claudeUninstall: 'claude:uninstall',
  claudeDefaultDirs: 'claude:default-dirs',
  editorIsOpen: 'editor:is-open',
  editorOpen: 'editor:open',
  editorFocusFolder: 'editor:focus-folder',
  editorClose: 'editor:close',
  terminalAttach: 'terminal:attach',
  terminalDetach: 'terminal:detach',
  terminalInput: 'terminal:input',
  terminalResize: 'terminal:resize',
  cycleTab: 'tabs:cycle',
  findInPage: 'panes:find',
  paneKey: 'panes:key',
  openTab: 'tabs:open-link',
  pageAttachable: 'page:attachable',
  pageMenuAction: 'page:menu-action',
  browserSessionsGet: 'browser-sessions:get',
  browserSessionsSet: 'browser-sessions:set',
  browserSessionsClear: 'browser-sessions:clear',
  switchSession: 'browser-sessions:switch',
  siteBlockList: 'site-block:list',
  siteBlockAdd: 'site-block:add',
  siteBlockRemove: 'site-block:remove',
  siteBlockCheck: 'site-block:check',
  siteBlockPass: 'site-block:pass',
  siteBlocked: 'site-block:blocked',
  pagePermissionsList: 'page-permissions:list',
  pagePermissionsAllow: 'page-permissions:allow',
  pagePermissionsRevoke: 'page-permissions:revoke',
  extensionsList: 'extensions:list',
  extensionsSelectTab: 'extensions:select-tab',
  extensionsInstall: 'extensions:install',
  extensionsRemove: 'extensions:remove',
  extensionsUpdate: 'extensions:update',
  bookmarksList: 'bookmarks:list',
  bookmarksAdd: 'bookmarks:add',
  bookmarksIcon: 'bookmarks:icon',
  bookmarksRemove: 'bookmarks:remove',
  bookmarksRename: 'bookmarks:rename',
  bookmarksGroup: 'bookmarks:group',
  bookmarksRenameGroup: 'bookmarks:rename-group',
  bookmarksGroupSettings: 'bookmarks:group-settings',
  bookmarksGroupSettingsSet: 'bookmarks:group-settings-set',
  bookmarkGroupSettingsChanged: 'bookmarks:group-settings-changed',
  bookmarksImportSources: 'bookmarks:import-sources',
  bookmarksImportRead: 'bookmarks:import-read',
  bookmarksImport: 'bookmarks:import',
  bookmarksSetUrl: 'bookmarks:set-url',
  bookmarksChanged: 'bookmarks:changed',
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit'
} as const
