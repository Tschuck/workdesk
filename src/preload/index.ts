import { contextBridge, ipcRenderer } from 'electron'
import { injectBrowserAction } from 'electron-chrome-extensions/browser-action'
import { IPC, type WorkDeskApi } from '../shared/api'

const api: WorkDeskApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  addTodo: (input) => ipcRenderer.invoke(IPC.addTodo, input),
  setTodoResolved: (id, resolved) => ipcRenderer.invoke(IPC.setTodoResolved, id, resolved),
  deleteTodo: (id) => ipcRenderer.invoke(IPC.deleteTodo, id),
  archiveResolvedTodos: (all) => ipcRenderer.invoke(IPC.archiveResolvedTodos, all),
  archivedTodos: () => ipcRenderer.invoke(IPC.archivedTodos),
  restoreTodo: (id) => ipcRenderer.invoke(IPC.restoreTodo, id),
  editTodo: (id, patch) => ipcRenderer.invoke(IPC.editTodo, id, patch),
  placeTodo: (id, ref, after) => ipcRenderer.invoke(IPC.placeTodo, id, ref, after),
  deskAddTodo: (d, t) => ipcRenderer.invoke(IPC.deskAddTodo, d, t),
  deskRemoveTodo: (t) => ipcRenderer.invoke(IPC.deskRemoveTodo, t),
  deskAssignTodo: (t, d) => ipcRenderer.invoke(IPC.deskAssignTodo, t, d),
  deskNewTodo: (d, title) => ipcRenderer.invoke(IPC.deskNewTodo, d, title),
  captureTodo: (d, title) => ipcRenderer.invoke(IPC.captureTodo, d, title),
  placeDeskTodo: (d, t, ref, after) => ipcRenderer.invoke(IPC.placeDeskTodo, d, t, ref, after),
  stepDeskTodo: (d, t, delta) => ipcRenderer.invoke(IPC.stepDeskTodo, d, t, delta),
  setTodoDue: (id, at) => ipcRenderer.invoke(IPC.setTodoDue, id, at),
  snoozeTodo: (id, until) => ipcRenderer.invoke(IPC.snoozeTodo, id, until),
  setTodoRepeat: (id, r) => ipcRenderer.invoke(IPC.setTodoRepeat, id, r),
  startTemplateDesk: (t, name) => ipcRenderer.invoke(IPC.startTemplateDesk, t, name),
  schedulesList: () => ipcRenderer.invoke(IPC.schedulesList),
  scheduleAdd: (i) => ipcRenderer.invoke(IPC.scheduleAdd, i),
  schedulePause: (id, p) => ipcRenderer.invoke(IPC.schedulePause, id, p),
  scheduleDelete: (id) => ipcRenderer.invoke(IPC.scheduleDelete, id),
  templatesList: () => ipcRenderer.invoke(IPC.templatesList),
  templateSave: (d, n, k) => ipcRenderer.invoke(IPC.templateSave, d, n, k),
  templateEdit: (id, p) => ipcRenderer.invoke(IPC.templateEdit, id, p),
  templateDelete: (id) => ipcRenderer.invoke(IPC.templateDelete, id),
  templateDuplicate: (id) => ipcRenderer.invoke(IPC.templateDuplicate, id),
  templateMove: (id, d) => ipcRenderer.invoke(IPC.templateMove, id, d),
  scheduleTemplate: (id, t) => ipcRenderer.invoke(IPC.scheduleTemplate, id, t),
  readNotes: (id) => ipcRenderer.invoke(IPC.readNotes, id),
  saveNotes: (id, text) => ipcRenderer.invoke(IPC.saveNotes, id, text),
  startPlainDesk: (ids, name) => ipcRenderer.invoke(IPC.startPlainDesk, ids, name),
  combineDesks: (t, o) => ipcRenderer.invoke(IPC.combineDesks, t, o),
  activateDesk: (id) => ipcRenderer.invoke(IPC.activateDesk, id),
  moveDesk: (id, targetId) => ipcRenderer.invoke(IPC.moveDesk, id, targetId),
  getLayout: (d) => ipcRenderer.invoke(IPC.getLayout, d),
  splitPane: (d, t, p, dir, kind, before, url) => ipcRenderer.invoke(IPC.splitPane, d, t, p, dir, kind, before, url),
  setBrowserLocation: (d, t, p, url, title, favicon) => ipcRenderer.invoke(IPC.setBrowserLocation, d, t, p, url, title, favicon),
  closePane: (d, t, p) => ipcRenderer.invoke(IPC.closePane, d, t, p),
  setFileLocation: (d, t, p, path, line) => ipcRenderer.invoke(IPC.setFileLocation, d, t, p, path, line),
  setSplitSizes: (d, t, at, sizes) => ipcRenderer.invoke(IPC.setSplitSizes, d, t, at, sizes),
  addTab: (d, kind, url, cwd) => ipcRenderer.invoke(IPC.addTab, d, kind, url, cwd),
  addBrowserTabs: (d, urls) => ipcRenderer.invoke(IPC.addBrowserTabs, d, urls),
  renameTab: (d, t, n) => ipcRenderer.invoke(IPC.renameTab, d, t, n),
  moveTabToGroup: (d, t, g) => ipcRenderer.invoke(IPC.moveTabToGroup, d, t, g),
  moveGroup: (d, g, t, after) => ipcRenderer.invoke(IPC.moveGroup, d, g, t, after),
  setTabBranch: (d, t, p) => ipcRenderer.invoke(IPC.setTabBranch, d, t, p),
  setTabGroup: (d, t, g) => ipcRenderer.invoke(IPC.setTabGroup, d, t, g),
  reopenClosed: (d) => ipcRenderer.invoke(IPC.reopenClosed, d),
  togglePinTab: (d, t) => ipcRenderer.invoke(IPC.togglePinTab, d, t),
  pinnedTabs: () => ipcRenderer.invoke(IPC.pinnedTabs),
  onPinnedTabs: (l) => {
    const h = (_e: unknown, pins: Parameters<typeof l>[0]) => l(pins)
    ipcRenderer.on(IPC.pinnedTabsChanged, h)
    return () => ipcRenderer.off(IPC.pinnedTabsChanged, h)
  },
  duplicateTab: (d, t) => ipcRenderer.invoke(IPC.duplicateTab, d, t),
  movePaneBeside: (d, from, p, to, target, dir, before) => ipcRenderer.invoke(IPC.movePaneBeside, d, from, p, to, target, dir, before),
  mergeTab: (d, from, to, p, dir, before) => ipcRenderer.invoke(IPC.mergeTab, d, from, to, p, dir, before),
  movePane: (d, t, p, to) => ipcRenderer.invoke(IPC.movePane, d, t, p, to),
  moveTab: (d, t, target, after, keepGroup) => ipcRenderer.invoke(IPC.moveTab, d, t, target, after, keepGroup),
  pageMemory: () => ipcRenderer.invoke(IPC.pageMemory),
  hibernateTab: (d, t, on, auto) => ipcRenderer.invoke(IPC.hibernateTab, d, t, on, auto),
  setActiveTab: (d, t) => ipcRenderer.invoke(IPC.setActiveTab, d, t),
  closeTab: (d, t) => ipcRenderer.invoke(IPC.closeTab, d, t),
  tabRunning: (d, t, p) => ipcRenderer.invoke(IPC.tabRunning, d, t, p),
  setupFacts: () => ipcRenderer.invoke(IPC.setupFacts),
  recentEvents: (limit) => ipcRenderer.invoke(IPC.recentEvents, limit),
  deskEvents: (d, limit) => ipcRenderer.invoke(IPC.deskEvents, d, limit),
  prsList: (m) => ipcRenderer.invoke(IPC.prsList, m),
  prsAddRepo: (r) => ipcRenderer.invoke(IPC.prsAddRepo, r),
  prsRemoveRepo: (r) => ipcRenderer.invoke(IPC.prsRemoveRepo, r),
  prsSkip: (id, on) => ipcRenderer.invoke(IPC.prsSkip, id, on),
  performance: () => ipcRenderer.invoke(IPC.performance),
  performanceTotal: () => ipcRenderer.invoke(IPC.performanceTotal),
  quitGet: () => ipcRenderer.invoke(IPC.quitGet),
  quitSet: (v) => ipcRenderer.invoke(IPC.quitSet, v),
  panelsGet: () => ipcRenderer.invoke(IPC.panelsGet),
  panelsSet: (patch) => ipcRenderer.invoke(IPC.panelsSet, patch),
  writeClipboard: (text) => ipcRenderer.invoke(IPC.writeClipboard, text),
  codeThemes: () => ipcRenderer.invoke(IPC.codeThemes),
  codeFont: () => ipcRenderer.invoke(IPC.codeFont),
  codeTheme: (id) => ipcRenderer.invoke(IPC.codeTheme, id),
  readClipboard: () => ipcRenderer.invoke(IPC.readClipboard),
  statusRemote: (repoId) => ipcRenderer.invoke(IPC.statusRemote, repoId),
  setStatusRemote: (url, repoId) => ipcRenderer.invoke(IPC.setStatusRemote, url, repoId),
  openExternal: (u) => ipcRenderer.invoke(IPC.openExternal, u),
  checkTools: () => ipcRenderer.invoke(IPC.checkTools),
  parkDesk: (d) => ipcRenderer.invoke(IPC.parkDesk, d),
  postponeDesk: (d, until) => ipcRenderer.invoke(IPC.postponeDesk, d, until),
  prTodoStates: () => ipcRenderer.invoke(IPC.prTodoStates),
  refreshPrTodos: () => ipcRenderer.invoke(IPC.refreshPrTodos),
  refreshAll: () => ipcRenderer.invoke(IPC.refreshAll),
  jobs: () => ipcRenderer.invoke(IPC.jobs),
  orchestratorState: () => ipcRenderer.invoke(IPC.orchestratorState),
  orchestratorSetAccount: (id) => ipcRenderer.invoke(IPC.orchestratorSetAccount, id),
  orchestratorRestart: () => ipcRenderer.invoke(IPC.orchestratorRestart),
  orchestratorHistory: () => ipcRenderer.invoke(IPC.orchestratorHistory),
  onOrchestratorHistory: (l) => {
    const h = (_e: unknown, s: Parameters<typeof l>[0]) => l(s)
    ipcRenderer.on(IPC.orchestratorHistoryChanged, h)
    return () => ipcRenderer.off(IPC.orchestratorHistoryChanged, h)
  },
  onJobs: (l) => {
    const h = (_e: unknown, s: Parameters<typeof l>[0]) => l(s)
    ipcRenderer.on(IPC.jobsChanged, h)
    return () => ipcRenderer.off(IPC.jobsChanged, h)
  },
  onPrTodoStates: (l) => {
    const h = (_e: unknown, s: Parameters<typeof l>[0]) => l(s)
    ipcRenderer.on(IPC.prTodosChanged, h)
    return () => ipcRenderer.off(IPC.prTodosChanged, h)
  },
  parkAllPreflight: (ids) => ipcRenderer.invoke(IPC.parkAllPreflight, ids),
  parkAll: (quit, ids) => ipcRenderer.invoke(IPC.parkAll, quit, ids),
  reactivateAll: (ids) => ipcRenderer.invoke(IPC.reactivateAll, ids),
  onOpenUrl: (l) => {
    const h = (_e: unknown, url: string) => l(url)
    ipcRenderer.on(IPC.openUrl, h)
    return () => ipcRenderer.off(IPC.openUrl, h)
  },
  historySearch: (q, limit) => ipcRenderer.invoke(IPC.historySearch, q, limit),
  historyList: (q, limit) => ipcRenderer.invoke(IPC.historyList, q, limit),
  historyForgetDay: (d) => ipcRenderer.invoke(IPC.historyForgetDay, d),
  historyKeepDays: (n) => ipcRenderer.invoke(IPC.historyKeepDays, n),
  historyForget: (url) => ipcRenderer.invoke(IPC.historyForget, url),
  historyState: () => ipcRenderer.invoke(IPC.historyState),
  historySet: (on) => ipcRenderer.invoke(IPC.historySet, on),
  historyClear: () => ipcRenderer.invoke(IPC.historyClear),
  certificateInfo: (url) => ipcRenderer.invoke(IPC.certificateInfo, url),
  filesRoots: (d) => ipcRenderer.invoke(IPC.filesRoots, d),
  filesList: (d, r) => ipcRenderer.invoke(IPC.filesList, d, r),
  filesEmptyFolders: (d, r) => ipcRenderer.invoke(IPC.filesEmptyFolders, d, r),
  filesRemoveFolder: (d, p) => ipcRenderer.invoke(IPC.filesRemoveFolder, d, p),
  filesMakeFolder: (d, dir, n) => ipcRenderer.invoke(IPC.filesMakeFolder, d, dir, n),
  filesMoveInto: (d, p, r, f) => ipcRenderer.invoke(IPC.filesMoveInto, d, p, r, f),
  filesRead: (d, p) => ipcRenderer.invoke(IPC.filesRead, d, p),
  filesReadBinary: (d, p) => ipcRenderer.invoke(IPC.filesReadBinary, d, p),
  filesWrite: (d, p, c) => ipcRenderer.invoke(IPC.filesWrite, d, p, c),
  filesNewScratch: (d) => ipcRenderer.invoke(IPC.filesNewScratch, d),
  filesDropEmptyScratch: (d, p) => ipcRenderer.invoke(IPC.filesDropEmptyScratch, d, p),
  filesDuplicate: (d, p) => ipcRenderer.invoke(IPC.filesDuplicate, d, p),
  filesRename: (d, p, n) => ipcRenderer.invoke(IPC.filesRename, d, p, n),
  filesMove: (d, p, dir) => ipcRenderer.invoke(IPC.filesMove, d, p, dir),
  filesRemove: (d, p) => ipcRenderer.invoke(IPC.filesRemove, d, p),
  filesCreate: (d, dir, n) => ipcRenderer.invoke(IPC.filesCreate, d, dir, n),
  filesSearch: (d, r, q) => ipcRenderer.invoke(IPC.filesSearch, d, r, q),
  filesUsages: (d, r, w, g) => ipcRenderer.invoke(IPC.filesUsages, d, r, w, g),
  filesRenameSymbol: (d, req) => ipcRenderer.invoke(IPC.filesRenameSymbol, d, req),
  filesOpenInEditor: (d, p, l) => ipcRenderer.invoke(IPC.filesOpenInEditor, d, p, l),
  gitStatus: (d, r) => ipcRenderer.invoke(IPC.gitStatus, d, r),
  gitHead: (d, r, p) => ipcRenderer.invoke(IPC.gitHead, d, r, p),
  gitStage: (d, r, p) => ipcRenderer.invoke(IPC.gitStage, d, r, p),
  gitUnstage: (d, r, p) => ipcRenderer.invoke(IPC.gitUnstage, d, r, p),
  gitCommit: (d, r, m) => ipcRenderer.invoke(IPC.gitCommit, d, r, m),
  diagnosticsCheck: (d, r) => ipcRenderer.invoke(IPC.diagnosticsCheck, d, r),
  reviewState: (d, r) => ipcRenderer.invoke(IPC.reviewState, d, r),
  reviewBranches: (d, r) => ipcRenderer.invoke(IPC.reviewBranches, d, r),
  reviewCommits: (d, r) => ipcRenderer.invoke(IPC.reviewCommits, d, r),
  reviewPresets: (d) => ipcRenderer.invoke(IPC.reviewPresets, d),
  reviewPresetRemove: (d, id) => ipcRenderer.invoke(IPC.reviewPresetRemove, d, id),
  reviewSetBase: (d, r, b) => ipcRenderer.invoke(IPC.reviewSetBase, d, r, b),
  reviewBaseFile: (d, r, p) => ipcRenderer.invoke(IPC.reviewBaseFile, d, r, p),
  reviewAddComment: (d, r, p, l, t) => ipcRenderer.invoke(IPC.reviewAddComment, d, r, p, l, t),
  reviewUpdateComment: (d, r, i, t) => ipcRenderer.invoke(IPC.reviewUpdateComment, d, r, i, t),
  reviewRemoveComment: (d, r, i) => ipcRenderer.invoke(IPC.reviewRemoveComment, d, r, i),
  reviewClearComments: (d, r) => ipcRenderer.invoke(IPC.reviewClearComments, d, r),
  reviewAddNote: (d, r, t) => ipcRenderer.invoke(IPC.reviewAddNote, d, r, t),
  reviewUpdateNote: (d, r, i, t) => ipcRenderer.invoke(IPC.reviewUpdateNote, d, r, i, t),
  reviewRemoveNote: (d, r, i) => ipcRenderer.invoke(IPC.reviewRemoveNote, d, r, i),
  findPage: (url) => ipcRenderer.invoke(IPC.findPage, url),
  defaultBrowser: () => ipcRenderer.invoke(IPC.defaultBrowser),
  makeDefaultBrowser: () => ipcRenderer.invoke(IPC.makeDefaultBrowser),
  onMenuAction: (l) => {
    const h = (_e: unknown, a: 'park-all' | 'reactivate-all' | 'capture-todo' | 'what-next' | `open-desk:${string}`) => l(a)
    ipcRenderer.on(IPC.menuAction, h)
    return () => ipcRenderer.off(IPC.menuAction, h)
  },
  renameDesk: (d, n) => ipcRenderer.invoke(IPC.renameDesk, d, n),
  setDeskStage: (d, s) => ipcRenderer.invoke(IPC.setDeskStage, d, s),
  setDeskGroupByBranch: (d, on) => ipcRenderer.invoke(IPC.setDeskGroupByBranch, d, on),
  clearPreflight: (d) => ipcRenderer.invoke(IPC.clearPreflight, d),
  clearBranches: (d) => ipcRenderer.invoke(IPC.clearBranches, d),
  clearDesk: (d, del) => ipcRenderer.invoke(IPC.clearDesk, d, del),
  reactivateDesk: (d) => ipcRenderer.invoke(IPC.reactivateDesk, d),
  listProjects: () => ipcRenderer.invoke(IPC.listProjects),
  addProjectClone: (n, u) => ipcRenderer.invoke(IPC.addProjectClone, n, u),
  addProjectExisting: (n, p) => ipcRenderer.invoke(IPC.addProjectExisting, n, p),
  renameProject: (f, t) => ipcRenderer.invoke(IPC.renameProject, f, t),
  removeProject: (n) => ipcRenderer.invoke(IPC.removeProject, n),
  moveProject: (n, i) => ipcRenderer.invoke(IPC.moveProject, n, i),
  setEnvSetup: (n, c) => ipcRenderer.invoke(IPC.setEnvSetup, n, c),
  setCheckoutCommands: (n, c) => ipcRenderer.invoke(IPC.setCheckoutCommands, n, c),
  setSharedEnv: (n, on) => ipcRenderer.invoke(IPC.setSharedEnv, n, on),
  onLayoutChanged: (l) => {
    const h = (_e: unknown, d: string) => l(d)
    ipcRenderer.on(IPC.layoutChanged, h)
    return () => ipcRenderer.off(IPC.layoutChanged, h)
  },
  envSync: (d, p, b) => ipcRenderer.invoke(IPC.envSync, d, p, b),
  envLink: (d, p, b, f) => ipcRenderer.invoke(IPC.envLink, d, p, b, f),
  envSyncDesk: (d) => ipcRenderer.invoke(IPC.envSyncDesk, d),
  envLinkDesk: (d, f) => ipcRenderer.invoke(IPC.envLinkDesk, d, f),
  envSetup: (d, p, b) => ipcRenderer.invoke(IPC.envSetup, d, p, b),
  notionState: (r) => ipcRenderer.invoke(IPC.notionState, r),
  notionSaveClient: (i, s) => ipcRenderer.invoke(IPC.notionSaveClient, i, s),
  notionConnect: () => ipcRenderer.invoke(IPC.notionConnect),
  notionCancelConnect: () => ipcRenderer.invoke(IPC.notionCancelConnect),
  notionDisconnect: () => ipcRenderer.invoke(IPC.notionDisconnect),
  notionSetConfig: (c) => ipcRenderer.invoke(IPC.notionSetConfig, c),
  notionStatusTickets: (s) => ipcRenderer.invoke(IPC.notionStatusTickets, s),
  notionClaim: (id) => ipcRenderer.invoke(IPC.notionClaim, id),
  deskAddItem: (d, item) => ipcRenderer.invoke(IPC.deskAddItem, d, item),
  deskRemoveItem: (d, k, id) => ipcRenderer.invoke(IPC.deskRemoveItem, d, k, id),
  addPageRef: (t, page) => ipcRenderer.invoke(IPC.addPageRef, t, page),
  removePageRef: (t, id) => ipcRenderer.invoke(IPC.removePageRef, t, id),
  notionTicket: (id, refresh) => ipcRenderer.invoke(IPC.notionTicket, id, refresh),
  terminalInfo: (d, p) => ipcRenderer.invoke(IPC.terminalInfo, d, p),
  startFromItems: (req) => ipcRenderer.invoke(IPC.startFromItems, req),
  listBranches: (r) => ipcRenderer.invoke(IPC.listBranches, r),
  createDeskFromBranches: (s, n, nb) => ipcRenderer.invoke(IPC.createDeskFromBranches, s, n, nb),
  removeBranchPreflight: (d, p, b) => ipcRenderer.invoke(IPC.removeBranchPreflight, d, p, b),
  removeBranchFromDesk: (d, p, b) => ipcRenderer.invoke(IPC.removeBranchFromDesk, d, p, b),
  branchDetails: (p, b) => ipcRenderer.invoke(IPC.branchDetails, p, b),
  branchPrs: (p, b) => ipcRenderer.invoke(IPC.branchPrs, p, b),
  deleteBranch: (p, b, o) => ipcRenderer.invoke(IPC.deleteBranch, p, b, o),
  deskPrs: (d, r) => ipcRenderer.invoke(IPC.deskPrs, d, r),
  deskSync: (d) => ipcRenderer.invoke(IPC.deskSync, d),
  deskFetch: (d) => ipcRenderer.invoke(IPC.deskFetch, d),
  deskPull: (d, p, b) => ipcRenderer.invoke(IPC.deskPull, d, p, b),
  addExistingBranches: (d, s) => ipcRenderer.invoke(IPC.addExistingBranches, d, s),
  addBranch: (d, p, b, base) => ipcRenderer.invoke(IPC.addBranch, d, p, b, base),
  restackPlan: (d) => ipcRenderer.invoke(IPC.restackPlan, d),
  githubStatus: () => ipcRenderer.invoke(IPC.githubStatus),
  githubSetToken: (t) => ipcRenderer.invoke(IPC.githubSetToken, t),
  githubClearToken: () => ipcRenderer.invoke(IPC.githubClearToken),
  providerStatus: () => ipcRenderer.invoke(IPC.providerStatus),
  providerSave: (k, i) => ipcRenderer.invoke(IPC.providerSave, k, i),
  providerClear: (k) => ipcRenderer.invoke(IPC.providerClear, k),
  providerTest: (k) => ipcRenderer.invoke(IPC.providerTest, k),
  providerResolve: (u) => ipcRenderer.invoke(IPC.providerResolve, u),
  providerForce: (u, s, k) => ipcRenderer.invoke(IPC.providerForce, u, s, k),
  candidates: (s, refresh) => ipcRenderer.invoke(IPC.candidates, s, refresh),
  prBranch: (id, refresh) => ipcRenderer.invoke(IPC.prBranch, id, refresh),
  remoteAge: (prefix) => ipcRenderer.invoke(IPC.remoteAge, prefix),
  onRemoteChanged: (listener) => {
    const handler = (_e: unknown, key: string) => listener(key)
    ipcRenderer.on(IPC.remoteChanged, handler)
    return () => ipcRenderer.removeListener(IPC.remoteChanged, handler)
  },
  prState: (id, refresh) => ipcRenderer.invoke(IPC.prState, id, refresh),
  myPrs: (refresh) => ipcRenderer.invoke(IPC.myPrs, refresh),
  myPrsNeedingWork: (refresh) => ipcRenderer.invoke(IPC.myPrsNeedingWork, refresh),
  skipCandidate: (s, c) => ipcRenderer.invoke(IPC.skipCandidate, s, c),
  checkoutReviewBranch: (d) => ipcRenderer.invoke(IPC.checkoutReviewBranch, d),
  markUnread: (d) => ipcRenderer.invoke(IPC.markUnread, d),
  markSignalRead: (d, s) => ipcRenderer.invoke(IPC.markSignalRead, d, s),
  getJumpTarget: (d) => ipcRenderer.invoke(IPC.getJumpTarget, d),
  paneFocus: (d, p, f) => ipcRenderer.send(IPC.paneFocus, d, p, f),
  onStateChanged: (l) => {
    const h = (_e: unknown, s: Parameters<typeof l>[0]) => l(s)
    ipcRenderer.on(IPC.stateChanged, h)
    return () => ipcRenderer.off(IPC.stateChanged, h)
  },
  accountsState: () => ipcRenderer.invoke(IPC.accountsState),
  accountsAdd: (n, d) => ipcRenderer.invoke(IPC.accountsAdd, n, d),
  accountsRename: (id, n) => ipcRenderer.invoke(IPC.accountsRename, id, n),
  accountsSetDir: (id, d) => ipcRenderer.invoke(IPC.accountsSetDir, id, d),
  accountsSetDefault: (id) => ipcRenderer.invoke(IPC.accountsSetDefault, id),
  accountsRemove: (id) => ipcRenderer.invoke(IPC.accountsRemove, id),
  accountsSetEnabled: (on) => ipcRenderer.invoke(IPC.accountsSetEnabled, on),
  accountsSetInterval: (m) => ipcRenderer.invoke(IPC.accountsSetInterval, m),
  accountsRefresh: (id) => ipcRenderer.invoke(IPC.accountsRefresh, id),
  accountsLogin: (id) => ipcRenderer.invoke(IPC.accountsLogin, id),
  accountsCancelLogin: (id) => ipcRenderer.invoke(IPC.accountsCancelLogin, id),
  accountsLogout: (id) => ipcRenderer.invoke(IPC.accountsLogout, id),
  setDeskClaudeAccount: (d, a) => ipcRenderer.invoke(IPC.setDeskClaudeAccount, d, a),
  claudeOverview: () => ipcRenderer.invoke(IPC.claudeOverview),
  profilesState: () => ipcRenderer.invoke(IPC.profilesState),
  profilesSetActive: (v) => ipcRenderer.invoke(IPC.profilesSetActive, v),
  profilesSetToken: (id, k, t) => ipcRenderer.invoke(IPC.profilesSetToken, id, k, t),
  profilesClearToken: (id, k) => ipcRenderer.invoke(IPC.profilesClearToken, id, k),
  profilesAdd: (name, repoId) => ipcRenderer.invoke(IPC.profilesAdd, name, repoId),
  profilesUpdate: (id, c) => ipcRenderer.invoke(IPC.profilesUpdate, id, c),
  profilesRemove: (id) => ipcRenderer.invoke(IPC.profilesRemove, id),
  profilesAddRepo: (input) => ipcRenderer.invoke(IPC.profilesAddRepo, input),
  profilesForgetRepo: (id) => ipcRenderer.invoke(IPC.profilesForgetRepo, id),
  profilesSetProjectProfile: (n, id) => ipcRenderer.invoke(IPC.profilesSetProjectProfile, n, id),
  onProfilesChanged: (l) => {
    const h = (_e: unknown, c: Parameters<typeof l>[0]) => l(c)
    ipcRenderer.on(IPC.profilesChanged, h)
    return () => ipcRenderer.off(IPC.profilesChanged, h)
  },
  onAccountsChanged: (l) => {
    const h = (_e: unknown, s: Parameters<typeof l>[0]) => l(s)
    ipcRenderer.on(IPC.accountsChanged, h)
    return () => ipcRenderer.off(IPC.accountsChanged, h)
  },
  openReviewTab: (d, a) => ipcRenderer.invoke(IPC.openReviewTab, d, a),
  claudeSkills: (p) => ipcRenderer.invoke(IPC.claudeSkills, p),
  claudeSkillsInstall: (p) => ipcRenderer.invoke(IPC.claudeSkillsInstall, p),
  claudeSkillsUninstall: (p) => ipcRenderer.invoke(IPC.claudeSkillsUninstall, p),
  claudeDirs: () => ipcRenderer.invoke(IPC.claudeDirs),
  claudeAddDir: (p) => ipcRenderer.invoke(IPC.claudeAddDir, p),
  claudeRemoveDir: (p) => ipcRenderer.invoke(IPC.claudeRemoveDir, p),
  claudeInstall: (p) => ipcRenderer.invoke(IPC.claudeInstall, p),
  claudeUninstall: (p) => ipcRenderer.invoke(IPC.claudeUninstall, p),
  claudeDefaultDirs: () => ipcRenderer.invoke(IPC.claudeDefaultDirs),
  editorIsOpen: (d) => ipcRenderer.invoke(IPC.editorIsOpen, d),
  editorOpen: (d) => ipcRenderer.invoke(IPC.editorOpen, d),
  editorFocusFolder: (d, f) => ipcRenderer.invoke(IPC.editorFocusFolder, d, f),
  editorClose: (d) => ipcRenderer.invoke(IPC.editorClose, d),
  terminalAttach: (d, p, cwd, c, r) => ipcRenderer.invoke(IPC.terminalAttach, d, p, cwd, c, r),
  terminalDetach: (p) => ipcRenderer.send(IPC.terminalDetach, p),
  terminalInput: (p, data) => ipcRenderer.send(IPC.terminalInput, p, data),
  terminalResize: (p, c, r) => ipcRenderer.send(IPC.terminalResize, p, c, r),
  onCycleTab: (l) => {
    const h = (_e: unknown, d: 1 | -1 | 0, recent?: boolean) => l(d, recent)
    ipcRenderer.on(IPC.cycleTab, h)
    return () => ipcRenderer.off(IPC.cycleTab, h)
  },
  onFindInPage: (l) => {
    const h = (_e: unknown, id: number) => l(id)
    ipcRenderer.on(IPC.findInPage, h)
    return () => ipcRenderer.off(IPC.findInPage, h)
  },
  onPaneKey: (l) => {
    const h = (_e: unknown, k: { key: string; shiftKey: boolean; fromWindow?: boolean }) => l(k)
    ipcRenderer.on(IPC.paneKey, h)
    return () => ipcRenderer.off(IPC.paneKey, h)
  },
  browserSessionsGet: () => ipcRenderer.invoke(IPC.browserSessionsGet),
  browserSessionsSet: (c) => ipcRenderer.invoke(IPC.browserSessionsSet, c),
  browserSessionsClear: (id) => ipcRenderer.invoke(IPC.browserSessionsClear, id),
  siteBlockList: () => ipcRenderer.invoke(IPC.siteBlockList),
  siteBlockAdd: (s) => ipcRenderer.invoke(IPC.siteBlockAdd, s),
  siteBlockRemove: (s) => ipcRenderer.invoke(IPC.siteBlockRemove, s),
  siteBlockCheck: (u) => ipcRenderer.invoke(IPC.siteBlockCheck, u),
  siteBlockPass: (u) => ipcRenderer.invoke(IPC.siteBlockPass, u),
  onSiteBlocked: (l) => {
    const h = (_e: unknown, id: number, url: string, rule: string) => l(id, url, rule)
    ipcRenderer.on(IPC.siteBlocked, h)
    return () => ipcRenderer.off(IPC.siteBlocked, h)
  },
  onSwitchSession: (l) => {
    const h = (_e: unknown, id: number, url: string) => l(id, url)
    ipcRenderer.on(IPC.switchSession, h)
    return () => ipcRenderer.off(IPC.switchSession, h)
  },
  pagePermissionsList: () => ipcRenderer.invoke(IPC.pagePermissionsList),
  pagePermissionsAllow: (o, p) => ipcRenderer.invoke(IPC.pagePermissionsAllow, o, p),
  pagePermissionsRevoke: (o, p) => ipcRenderer.invoke(IPC.pagePermissionsRevoke, o, p),
  extensionsSelectTab: (id) => ipcRenderer.send(IPC.extensionsSelectTab, id),
  extensionsList: () => ipcRenderer.invoke(IPC.extensionsList),
  extensionsInstall: (i) => ipcRenderer.invoke(IPC.extensionsInstall, i),
  extensionsRemove: (id) => ipcRenderer.invoke(IPC.extensionsRemove, id),
  extensionsUpdate: () => ipcRenderer.invoke(IPC.extensionsUpdate),
  bookmarksList: () => ipcRenderer.invoke(IPC.bookmarksList),
  bookmarksAdd: (t, u, f) => ipcRenderer.invoke(IPC.bookmarksAdd, t, u, f),
  bookmarksIcon: (u, f) => ipcRenderer.invoke(IPC.bookmarksIcon, u, f),
  bookmarksRemove: (id) => ipcRenderer.invoke(IPC.bookmarksRemove, id),
  bookmarksSetUrl: (id, u) => ipcRenderer.invoke(IPC.bookmarksSetUrl, id, u),
  bookmarksImportSources: () => ipcRenderer.invoke(IPC.bookmarksImportSources),
  bookmarksImportRead: (id) => ipcRenderer.invoke(IPC.bookmarksImportRead, id),
  bookmarksImport: (items) => ipcRenderer.invoke(IPC.bookmarksImport, items),
  bookmarksGroupSettings: () => ipcRenderer.invoke(IPC.bookmarksGroupSettings),
  bookmarksGroupSettingsSet: (s) => ipcRenderer.invoke(IPC.bookmarksGroupSettingsSet, s),
  onBookmarkGroupSettings: (l) => {
    const h = (_e: unknown, s: Parameters<typeof l>[0]) => l(s)
    ipcRenderer.on(IPC.bookmarkGroupSettingsChanged, h)
    return () => ipcRenderer.off(IPC.bookmarkGroupSettingsChanged, h)
  },
  bookmarksRenameGroup: (from, to) => ipcRenderer.invoke(IPC.bookmarksRenameGroup, from, to),
  bookmarksGroup: (id, g) => ipcRenderer.invoke(IPC.bookmarksGroup, id, g),
  bookmarksRename: (id, t) => ipcRenderer.invoke(IPC.bookmarksRename, id, t),
  onBookmarksChanged: (l) => {
    const h = (_e: unknown, list: Parameters<typeof l>[0]) => l(list)
    ipcRenderer.on(IPC.bookmarksChanged, h)
    return () => ipcRenderer.off(IPC.bookmarksChanged, h)
  },
  setPageAttachable: (id, name) => ipcRenderer.invoke(IPC.pageAttachable, id, name),
  onPageMenuAction: (l) => {
    const h = (_e: unknown, id: number, action: 'attach-desk' | 'attach-todo') => l(id, action)
    ipcRenderer.on(IPC.pageMenuAction, h)
    return () => ipcRenderer.off(IPC.pageMenuAction, h)
  },
  onOpenTab: (l) => {
    const h = (_e: unknown, id: number, url: string) => l(id, url)
    ipcRenderer.on(IPC.openTab, h)
    return () => ipcRenderer.off(IPC.openTab, h)
  },
  navFiles: () => ipcRenderer.invoke(IPC.navFiles),
  navGrep: (q) => ipcRenderer.invoke(IPC.navGrep, q),
  navTerminals: (q) => ipcRenderer.invoke(IPC.navTerminals, q),
  terminalCwds: () => ipcRenderer.invoke(IPC.terminalCwds),
  onTerminalCwds: (l) => {
    const h = (_e: unknown, c: Parameters<typeof l>[0]) => l(c)
    ipcRenderer.on(IPC.terminalCwdsChanged, h)
    return () => ipcRenderer.off(IPC.terminalCwdsChanged, h)
  },
  timeShown: (d) => ipcRenderer.send(IPC.timeShown, d),
  timeLog: () => ipcRenderer.invoke(IPC.timeLog),
  onTerminalData: (l) => {
    const h = (_e: unknown, p: string, d: string) => l(p, d)
    ipcRenderer.on(IPC.terminalData, h)
    return () => ipcRenderer.off(IPC.terminalData, h)
  },
  onTerminalExit: (l) => {
    const h = (_e: unknown, p: string) => l(p)
    ipcRenderer.on(IPC.terminalExit, h)
    return () => ipcRenderer.off(IPC.terminalExit, h)
  }
}

// the <browser-action-list> element of the address bar: the buttons of the installed extensions
injectBrowserAction()
contextBridge.exposeInMainWorld('workdesk', api)
