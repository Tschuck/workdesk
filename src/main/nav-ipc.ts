import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/api'
import type { SearchQuery } from './files'
import { TimeTracker } from './time-tracker'
import { frontEditorTarget } from './editor-presence'
import { WorkspaceNav } from './workspace-nav'

const POLL_MS = 3000

/**
 * The workspace-wide navigation: search over every WorkDesk, the folders terminals are in (polled from tmux and
 * pushed to the window when one changes) and the passive time tracking.
 */
export async function registerNavigation(nav: WorkspaceNav, inUse: () => boolean, onIdle?: (deskId: string) => void, deskOfEditor?: (target: string) => string | undefined): Promise<TimeTracker> {
  ipcMain.handle(IPC.navFiles, () => nav.files())
  ipcMain.handle(IPC.navGrep, (_e, q: SearchQuery) => nav.grep({ text: String(q?.text ?? ''), regex: !!q?.regex, caseSensitive: !!q?.caseSensitive, glob: String(q?.glob ?? '') }))
  ipcMain.handle(IPC.navTerminals, (_e, q: { text?: string; regex?: boolean; caseSensitive?: boolean }) => nav.terminals({ text: String(q?.text ?? ''), regex: !!q?.regex, caseSensitive: !!q?.caseSensitive }))
  ipcMain.handle(IPC.terminalCwds, async () => (await nav.pollCwds()).cwds)

  // terminals follow `cd`: one tmux call every few seconds while the app is in use, told to the window only on a change
  let polling = false
  const poll = setInterval(() => {
    if (polling || !inUse()) return
    polling = true
    nav
      .pollCwds()
      .then(({ cwds, changed }) => changed && BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(IPC.terminalCwdsChanged, cwds)))
      .catch(() => undefined)
      .finally(() => void (polling = false))
  }, POLL_MS)
  app.on('will-quit', () => clearInterval(poll))

  const tracker = new TimeTracker(join(app.getPath('userData'), 'time-tracking.json'), {
    now: () => Date.now(),
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    locked: () => powerMonitor.getSystemIdleState(600) === 'locked'
  }, onIdle)
  await tracker.load()
  tracker.start()
  // time in VS Code counts for the WorkDesk whose window is in front there
  if (deskOfEditor) {
    const editorPoll = setInterval(() => {
      void frontEditorTarget().then((t) => tracker.setEditorDesk(t ? deskOfEditor(t) : undefined), () => tracker.setEditorDesk(undefined))
    }, 5000)
    app.on('will-quit', () => clearInterval(editorPoll))
  }
  ipcMain.on(IPC.timeShown, (_e, id: unknown) => tracker.setShown(typeof id === 'string' ? id : undefined))
  ipcMain.handle(IPC.timeLog, () => tracker.data())
  app.on('will-quit', () => {
    tracker.stop()
    void tracker.flush()
  })
  return tracker
}
