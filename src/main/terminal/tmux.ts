import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** tmux operations: one session per WorkDesk, one window per Pane. */
export interface Tmux {
  hasSession(session: string): Promise<boolean>
  hasWindow(session: string, window: string): Promise<boolean>
  /** create the session (with its first window) or just a new window in it */
  ensureWindow(session: string, window: string, cwd: string, command?: string, env?: Record<string, string>): Promise<void>
  killWindow(session: string, window: string): Promise<void>
  killSession(session: string): Promise<void>
  /** the process ids of the shells in a session (of one window only, when given) */
  panePids(session: string, window?: string): Promise<number[]>
  /**
   * A session of its own that holds only `window` (linked, not copied), so several Panes of one WorkDesk can be
   * attached at once. When the window ends (a shell exits, `claude` quits), the view goes with it and so does the
   * terminal attached to it: a session group would move the view on to another window, and that Pane would show
   * (and type into) another Pane's shell. The attaching client sets `destroy-unattached` so the view goes away with it.
   */
  createView(session: string, view: string, window: string): Promise<void>
  /** command line (after `tmux`) that shows a view session in a terminal */
  attachArgs(view: string): string[]
}

/**
 * WorkDesk runs its own tmux server, apart from the user's: no clashes with their sessions or
 * config, and no trouble when their long-running server and the installed tmux differ in version.
 */
export const TMUX_SOCKET = process.env['WORKDESK_TMUX_SOCKET'] || 'workdesk'

/** tmux's pane title is the host name until something sets one: then the command and the folder say more */
export const TITLE_FORMAT = '#{?#{||:#{==:#{pane_title},#{host}},#{==:#{pane_title},#{host_short}}},#{pane_current_command} #{b:pane_current_path},#{pane_title}}'

export function createTmux(socket: string): Tmux {
  async function tmux(args: string[]): Promise<string> {
    const { stdout } = await run('tmux', ['-L', socket, ...args])
    return stdout.trim()
  }

  const ok = (args: string[]): Promise<boolean> =>
    tmux(args).then(
      () => true,
      () => false
    )

  /**
   * A window is as big as the smallest client that shows it (tmux's default). A client that is still attached but out of sight, a view
   * left over from before, or a pane that was small once keeps the window at that size, and the terminal shows its content in a corner.
   * With `latest` the window follows the client that was used last: the one you came back to.
   */
  const sizeFollowsLatest = async (target: string): Promise<void> => {
    await ok(['set-option', '-g', 'window-size', 'latest'])
    await ok(['set-option', '-t', target, 'window-size', 'latest'])
    await ok(['set-window-option', '-g', 'aggressive-resize', 'on'])
    // `resize-window` (also with -A) pins a window to the size it was given ("manual") for good: a window that was pinned follows its clients again
    const windows = await tmux(['list-windows', '-t', target, '-F', '#{window_id}']).catch(() => '')
    for (const id of windows.split('\n').filter(Boolean)) await ok(['set-option', '-w', '-u', '-t', id, 'window-size'])
  }

  const hasSession = (session: string) => ok(['has-session', '-t', `=${session}`])

  const hasWindow = async (session: string, window: string) => {
    if (!(await hasSession(session))) return false
    return (await tmux(['list-windows', '-t', `=${session}`, '-F', '#{window_name}'])).split('\n').includes(window)
  }

  // Several Panes of a WorkDesk are shown at once, e.g. after reactivating it. If each of them looks whether the
  // session exists and then creates it, the second `new-session` fails ("duplicate session") and that Pane stays
  // black. So windows of one session are made one after the other.
  const queues = new Map<string, Promise<unknown>>()
  const inTurn = <T>(session: string, job: () => Promise<T>): Promise<T> => {
    const run = (queues.get(session) ?? Promise.resolve()).then(job, job)
    queues.set(session, run.catch(() => undefined))
    return run
  }

  return {
    hasSession,
    hasWindow,
    ensureWindow: (session, window, cwd, command, env) =>
      inTurn(session, async () => {
        // `-e` sets the variable for the shell of this window only (tmux 3.2+)
        const vars = Object.entries(env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`])
        const extra = [...vars, ...(command ? [command] : [])]
        if (!(await hasSession(session))) {
          await tmux(['new-session', '-d', '-s', session, '-n', window, '-c', cwd, ...extra])
        } else if (!(await hasWindow(session, window))) {
          await tmux(['new-window', '-d', '-t', `=${session}:`, '-n', window, '-c', cwd, ...extra])
        }
        // the app owns scrolling and the status line
        await tmux(['set-option', '-t', `=${session}:`, 'status', 'off'])
        await sizeFollowsLatest(`=${session}:`)
      }),
    async killWindow(session, window) {
      await ok(['kill-window', '-t', `${session}:=${window}`])
    },
    async panePids(session, window) {
      try {
        const out = await tmux(['list-panes', '-s', '-t', `=${session}`, '-F', '#{window_name}\t#{pane_pid}'])
        return out
          .split('\n')
          .map((l) => l.split('\t'))
          .filter(([w, pid]) => (window === undefined || w === window) && /^\d+$/.test(pid ?? ''))
          .map(([, pid]) => Number(pid))
      } catch {
        return []
      }
    },
    async killSession(session) {
      await ok(['kill-session', '-t', `=${session}`])
    },
    async createView(session, view, window) {
      await ok(['kill-session', '-t', `=${view}`])
      // the session starts with a window of its own; the Pane's window is linked in, then that one is dropped again
      const starter = await tmux(['new-session', '-d', '-P', '-F', '#{window_id}', '-s', view, 'sleep 86400'])
      await tmux(['link-window', '-s', `${session}:=${window}`, '-t', `=${view}:`])
      await tmux(['kill-window', '-t', starter])
      // the view does not inherit the base session's options, so the status line is switched off here too
      await tmux(['set-option', '-t', `=${view}:`, 'status', 'off'])
      // the title the program in the Pane sets (a shell, claude), or, while it sets none, its command and folder, goes on to the terminal that shows it
      await tmux(['set-option', '-t', `=${view}:`, 'set-titles', 'on'])
      await tmux(['set-option', '-t', `=${view}:`, 'set-titles-string', TITLE_FORMAT])
      await sizeFollowsLatest(`=${view}:`)
    },
    attachArgs: (view) => ['-L', socket, 'attach-session', '-t', view, ';', 'set-option', 'destroy-unattached', 'on']
  }
}

export const realTmux: Tmux = createTmux(TMUX_SOCKET)
