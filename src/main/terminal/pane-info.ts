import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import type { TmuxAdmin } from './tmux-admin'
import { sessionName } from './manager'

const run = promisify(execFile)

/** Where a terminal is: its folder (with the home folder written as ~) and, in a git folder, the branch. */
export interface PaneInfo {
  cwd: string
  /** the folder as written in a prompt: ~/projects/x */
  display: string
  branch?: string
}

/** `/Users/me/x` as `~/x`; anything outside the home folder stays as it is. */
export function tildePath(path: string, home: string = homedir()): string {
  if (path === home) return '~'
  return path.startsWith(home + '/') ? '~' + path.slice(home.length) : path
}

/** The branch checked out in a folder, or the short commit when HEAD is detached; nothing outside a git folder. */
export async function gitBranch(cwd: string): Promise<string | undefined> {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  try {
    const { stdout } = await run('git', ['-C', cwd, 'symbolic-ref', '--short', '-q', 'HEAD'], { env, timeout: 3000 })
    if (stdout.trim()) return stdout.trim()
  } catch {
    // detached HEAD (exit 1) or not a git folder: fall through
  }
  try {
    const { stdout } = await run('git', ['-C', cwd, 'rev-parse', '--short', 'HEAD'], { env, timeout: 3000 })
    return stdout.trim() ? `(${stdout.trim()})` : undefined
  } catch {
    return undefined
  }
}

export async function paneInfo(admin: TmuxAdmin, deskId: string, paneId: string): Promise<PaneInfo | undefined> {
  const cwd = await admin.paneCwd(sessionName(deskId), paneId)
  if (!cwd) return undefined
  return { cwd, display: tildePath(cwd), branch: await gitBranch(cwd) }
}
