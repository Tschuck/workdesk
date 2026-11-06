import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** The few git operations the Status Repo needs; faked in tests. */
export interface Git {
  isRepo(dir: string): Promise<boolean>
  init(dir: string): Promise<void>
  hasChanges(dir: string): Promise<boolean>
  commitAll(dir: string, message: string): Promise<void>
  hasRemote(dir: string): Promise<boolean>
  /** Rebase onto the remote branch; 'conflict' leaves the repo for the user to resolve. */
  pullRebase(dir: string): Promise<'ok' | 'conflict'>
  push(dir: string): Promise<void>
  /** URL of `origin`, if there is one */
  remoteUrl(dir: string): Promise<string | undefined>
  /** Point `origin` at the URL, or remove it with `undefined`. */
  setRemote(dir: string, url: string | undefined): Promise<void>
  /** Throws with git's message when the URL cannot be reached (no access, no such repository). */
  checkRemote(url: string): Promise<void>
  /** Clone a remote into a new folder (for a Status Repo that exists elsewhere already). */
  clone(url: string, dir: string): Promise<void>
}

/**
 * Nobody sees a password prompt of a background sync (and in development it lands in the terminal the app was
 * started from): ssh and git fail at once instead of asking, so a remote needs key (or stored) credentials.
 */
export const NO_PROMPT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes -o ConnectTimeout=15'
}

async function git(dir: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', args, { cwd: dir, env: { ...process.env, ...NO_PROMPT_ENV } })
    return stdout.trim()
  } catch (err) {
    throw explain(err)
  }
}

/** git's own message, not the whole command line */
const gitMessage = (err: unknown): string => {
  const e = err as { stderr?: string; message?: string }
  return (e.stderr || e.message || 'git failed').trim().replace(/^fatal: /m, '')
}

/** git's message, plus what to do when the remote wanted a password */
export function explain(err: unknown): Error {
  const text = gitMessage(err)
  const hint = /Permission denied|could not read (Username|Password)|Authentication failed/i.test(text)
    ? '\nThe remote asked for a password, which WorkDesk cannot type. Use an SSH key that works without one (ssh-copy-id to the server, or a key in the agent / ~/.ssh/config) and check with: ssh -o BatchMode=yes <user>@<host> true'
    : ''
  return Object.assign(new Error(text + hint), { code: (err as { code?: unknown }).code })
}

export const realGit: Git = {
  async isRepo(dir) {
    return existsSync(join(dir, '.git'))
  },
  async init(dir) {
    await git(dir, ['init'])
  },
  async hasChanges(dir) {
    return (await git(dir, ['status', '--porcelain'])) !== ''
  },
  async commitAll(dir, message) {
    await git(dir, ['add', '-A'])
    await git(dir, ['commit', '-m', message])
  },
  async hasRemote(dir) {
    return (await git(dir, ['remote'])) !== ''
  },
  async pullRebase(dir) {
    try {
      // a fresh remote has no branch yet: nothing to take over, the push creates it
      const branch = await git(dir, ['symbolic-ref', '--short', 'HEAD'])
      if ((await git(dir, ['ls-remote', '--heads', 'origin', branch])) === '') return 'ok'
      await git(dir, ['pull', '--rebase', 'origin', branch])
      return 'ok'
    } catch (err) {
      const rebasing = existsSync(join(dir, '.git', 'rebase-merge')) || existsSync(join(dir, '.git', 'rebase-apply'))
      if (rebasing) return 'conflict'
      throw err
    }
  },
  async push(dir) {
    await git(dir, ['push', '-u', 'origin', 'HEAD'])
  },
  async remoteUrl(dir) {
    try {
      return (await git(dir, ['remote', 'get-url', 'origin'])) || undefined
    } catch {
      return undefined
    }
  },
  async setRemote(dir, url) {
    const has = (await git(dir, ['remote'])).split('\n').includes('origin')
    if (!url) {
      if (has) await git(dir, ['remote', 'remove', 'origin'])
    } else await git(dir, has ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url])
  },
  async clone(url, dir) {
    try {
      await run('git', ['clone', '--', url, dir], { timeout: 120_000, env: { ...process.env, ...NO_PROMPT_ENV } })
    } catch (err) {
      throw explain(err)
    }
  },
  async checkRemote(url) {
    try {
      // never wait for a password prompt that nobody sees
      await run('git', ['ls-remote', '--exit-code', url, 'HEAD'], { timeout: 30_000, env: { ...process.env, ...NO_PROMPT_ENV } })
    } catch (err) {
      // exit 2 only means "reachable, but empty": a new repository, which is fine
      if ((err as { code?: number }).code === 2) return
      throw explain(err)
    }
  }
}
