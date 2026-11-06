import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { TMUX_SOCKET } from './tmux'

const run = promisify(execFile)

export interface PaneInfo {
  session: string
  /** the program in the foreground of the pane, e.g. zsh, claude, node */
  command: string
  /** tmux window name: the id of the Pane in WorkDesk */
  window: string
}

/** Looking at, and ending, everything WorkDesk has running on its tmux server. */
export interface TmuxAdmin {
  panes(): Promise<PaneInfo[]>
  /** end every session, shells and the programs in them included */
  killServer(): Promise<void>
  /** the folder a Pane's shell is in right now (follows every `cd`), or nothing when the window is gone */
  paneCwd(session: string, window: string): Promise<string | undefined>
  /** the folder of every pane on the server, `session\twindow\tpath` per line (see `parsePaneCwds`) */
  allPaneCwds(): Promise<string>
  /** the text a pane shows, with its scrollback (the last `lines` lines), joined where the terminal wrapped; empty when the window is gone */
  capture(session: string, window: string, lines?: number): Promise<string>
  /** type text into a pane's program as if by hand, then Enter (unless `enter` is false) */
  sendText(session: string, window: string, text: string, enter?: boolean): Promise<void>
}

export function createTmuxAdmin(socket: string = TMUX_SOCKET): TmuxAdmin {
  const tmux = async (args: string[]): Promise<string> => (await run('tmux', ['-L', socket, ...args])).stdout
  return {
    async panes() {
      try {
        const out = await tmux(['list-panes', '-a', '-F', '#{session_name}\t#{pane_current_command}\t#{window_name}'])
        return out.split('\n').filter(Boolean).map((l) => {
          const [session, command, window] = l.split('\t')
          return { session, command: command ?? '', window: window ?? '' }
        })
      } catch {
        // no server running: nothing is running
        return []
      }
    },
    async killServer() {
      await tmux(['kill-server']).catch(() => undefined)
    },
    async allPaneCwds() {
      try {
        return await tmux(['list-panes', '-a', '-F', '#{session_name}\t#{window_name}\t#{pane_current_path}'])
      } catch {
        return ''
      }
    },
    async capture(session, window, lines = 3000) {
      try {
        return await tmux(['capture-pane', '-p', '-J', '-S', `-${lines}`, '-t', `${session}:=${window}`])
      } catch {
        return ''
      }
    },
    async sendText(session, window, text, enter = true) {
      const target = `${session}:=${window}`
      // literally, so a word like "Enter" in the text is not a key; the paste markers keep a multi-line text from being run line by line
      if (text) await tmux(['send-keys', '-t', target, '-l', text])
      if (enter) await tmux(['send-keys', '-t', target, 'Enter'])
    },
    async paneCwd(session, window) {
      try {
        // every window of the session with its folder; the name must match exactly
        const out = await tmux(['list-windows', '-t', `=${session}`, '-F', '#{window_name}\t#{pane_current_path}'])
        const line = out.split('\n').find((l) => l.split('\t')[0] === window)
        return line?.split('\t')[1]?.trim() || undefined
      } catch {
        return undefined
      }
    }
  }
}

const SHELLS = new Set(['zsh', 'bash', 'fish', 'sh', 'dash', 'ksh', 'tcsh', 'login', '-zsh', '-bash'])

export interface RunningSummary {
  /** terminals of WorkDesks (not the hidden views or the usage reader) */
  terminals: number
  /** programs other than a shell prompt, e.g. claude or a dev server */
  programs: string[]
}

/** What would end if the tmux server were stopped. A pane may be listed several times through its views. */
export function summarize(panes: readonly PaneInfo[]): RunningSummary {
  const own = panes.filter((p) => p.session.startsWith('workdesk-') && !p.session.startsWith('workdesk-view-'))
  return {
    terminals: own.length,
    programs: [...new Set(own.map((p) => p.command).filter((c) => c && !SHELLS.has(c)))].sort()
  }
}

/** Programs other than a shell prompt in the given Panes, e.g. claude or a dev server. */
export function runningIn(panes: readonly PaneInfo[], paneIds: readonly string[]): string[] {
  const own = panes.filter((p) => p.session.startsWith('workdesk-') && !p.session.startsWith('workdesk-view-') && paneIds.includes(p.window))
  return [...new Set(own.map((p) => p.command).filter((c) => c && !SHELLS.has(c)))].sort()
}
