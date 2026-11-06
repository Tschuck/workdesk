import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Screen } from '../claude/usage'
import { TMUX_SOCKET } from './tmux'

const run = promisify(execFile)

/** Driving a hidden session on WorkDesk's own tmux server (`-u`: the prompt character `❯` must survive without a UTF-8 locale). */
export function createScreen(socket: string = TMUX_SOCKET): Screen {
  const tmux = async (args: string[]): Promise<string> => (await run('tmux', ['-u', '-L', socket, ...args])).stdout
  return {
    hasSession: (s) => tmux(['has-session', '-t', `=${s}`]).then(() => true, () => false),
    async newSession(s, cwd, command, cols, rows) {
      await tmux(['new-session', '-d', '-s', s, '-x', String(cols), '-y', String(rows), '-c', cwd, command])
    },
    async sendKeys(s, keys, literal = false) {
      await tmux(['send-keys', '-t', `=${s}:`, ...(literal ? ['-l'] : []), ...keys])
    },
    capture: (s) => tmux(['capture-pane', '-p', '-t', `=${s}:`]),
    async killSession(s) {
      await tmux(['kill-session', '-t', `=${s}`]).catch(() => undefined)
    }
  }
}
