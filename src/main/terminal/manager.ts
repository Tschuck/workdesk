import { realProcesses, type Processes } from './processes'
import { Osc133Scanner } from './osc133'
import type { Tmux } from './tmux'

export interface Pty {
  onData(listener: (data: string) => void): void
  onExit(listener: () => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export type PtyFactory = (file: string, args: string[], cols: number, rows: number, cwd: string) => Pty

export const sessionName = (deskId: string): string => `workdesk-${deskId}`
const viewName = (deskId: string, paneId: string): string => `workdesk-view-${deskId}-${paneId}`

/**
 * Connects Terminal Panes to tmux: the shell lives in a tmux window of the WorkDesk's session
 * (so it survives the app), the pty only shows it.
 */
export class TerminalManager {
  private readonly ptys = new Map<string, Pty>()
  /** text to type into a Pane's shell once, when its window is first created (setup commands) */
  private readonly pendingInput = new Map<string, string>()

  constructor(
    private readonly tmux: Tmux,
    private readonly spawn: PtyFactory,
    private readonly emit: (paneId: string, data: string) => void,
    private readonly onExit: (paneId: string) => void = () => undefined,
    private readonly onCommandFinished: (deskId: string, paneId: string, exitCode?: number) => void = () => undefined,
    /** command to start in a window that has to be created, e.g. `claude --resume` */
    private readonly startCommand: (deskId: string, paneId: string) => Promise<string | undefined> = async () => undefined,
    /** how commands are really ended, beyond the hangup tmux sends */
    private readonly procs: Processes = realProcesses,
    /** environment for a window that has to be created (e.g. CLAUDE_CONFIG_DIR of the WorkDesk's Claude Account) */
    private readonly startEnv: (deskId: string) => Record<string, string> = () => ({})
  ) {}

  /**
   * Show a Pane's tmux window in a new pty. Re-attaching replaces the previous pty, never the shell.
   * With a `viewId` of its own it is one more look at a window that runs (the orchestrator shows a WorkDesk's Claude): a tmux client
   * apart from the Pane's, which is not disturbed, and that never creates the window or reports what its commands did.
   */
  async attach(deskId: string, paneId: string, cwd: string, cols: number, rows: number, viewId: string = paneId): Promise<void> {
    this.detach(viewId)
    const looking = viewId !== paneId
    const session = sessionName(deskId)
    const view = viewName(deskId, viewId)
    const fresh = !(await this.tmux.hasWindow(session, paneId))
    if (looking && fresh) throw new Error('This terminal is not running')
    const command = fresh ? await this.startCommand(deskId, paneId) : undefined
    if (!looking) await this.tmux.ensureWindow(session, paneId, cwd, command, fresh ? this.startEnv(deskId) : undefined)
    await this.tmux.createView(session, view, paneId)
    const pty = this.spawn('tmux', this.tmux.attachArgs(view), cols, rows, cwd)
    this.ptys.set(viewId, pty)
    // typed like by hand, so it shows in the terminal; the tty holds it until the shell is ready
    const input = this.pendingInput.get(paneId)
    this.pendingInput.delete(paneId)
    if (fresh && input) pty.write(input)
    const scanner = new Osc133Scanner()
    pty.onData((data) => {
      this.emit(viewId, data)
      if (!looking) for (const done of scanner.push(data)) this.onCommandFinished(deskId, paneId, done.exitCode)
    })
    pty.onExit(() => {
      if (this.ptys.get(viewId) === pty) {
        this.ptys.delete(viewId)
        this.onExit(viewId)
      }
    })
  }

  /** Start a Pane's window with a command without showing it (a worker started for you; it runs in tmux until the Pane is opened). */
  async startWindow(deskId: string, paneId: string, cwd: string, command: string): Promise<void> {
    await this.tmux.ensureWindow(sessionName(deskId), paneId, cwd, command, this.startEnv(deskId))
  }

  /** Type this into the Pane's shell when its window is created (once). */
  queueInput(paneId: string, text: string): void {
    this.pendingInput.set(paneId, text)
  }

  write(paneId: string, data: string): void {
    this.ptys.get(paneId)?.write(data)
  }

  resize(paneId: string, cols: number, rows: number): void {
    this.ptys.get(paneId)?.resize(cols, rows)
  }

  /** Stop showing a Pane; its shell keeps running in tmux. */
  detach(paneId: string): void {
    const pty = this.ptys.get(paneId)
    if (!pty) return
    this.ptys.delete(paneId)
    pty.kill()
  }

  /** End a Pane for good: its shell goes away. */
  async close(deskId: string, paneId: string): Promise<void> {
    this.detach(paneId)
    // what runs below the shell is looked up first: once the shell is gone, a program that ignored the hangup is an orphan
    const running = await this.procs.tree(await this.tmux.panePids(sessionName(deskId), paneId))
    await this.tmux.killWindow(sessionName(deskId), paneId)
    await this.procs.end(running)
  }

  /** Park a WorkDesk: stop showing its Panes and end its tmux session, shells and dev servers included. */
  async parkDesk(deskId: string, paneIds: readonly string[]): Promise<void> {
    // tmux only hangs the shells up; a command that ignores that (nohup, a server that traps SIGHUP) would keep running.
    // So the processes below the shells are looked up first, and ended after the session is gone.
    const running = await this.procs.tree(await this.tmux.panePids(sessionName(deskId)))
    for (const paneId of paneIds) {
      this.detach(paneId)
      await this.tmux.killSession(viewName(deskId, paneId))
    }
    await this.tmux.killSession(sessionName(deskId))
    await this.procs.end(running)
  }

  isAttached(paneId: string): boolean {
    return this.ptys.has(paneId)
  }

  detachAll(): void {
    for (const id of [...this.ptys.keys()]) this.detach(id)
  }
}
