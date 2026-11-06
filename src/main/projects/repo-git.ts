import { execFile } from 'node:child_process'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface WorktreeStatus {
  uncommitted: string[]
  untracked: string[]
}

export interface PushState {
  /** a remote tracking branch is configured */
  hasUpstream: boolean
  /** commits not yet on the remote branch */
  ahead: number
}

export interface CommitInfo {
  sha: string
  subject: string
  author: string
  /** epoch ms */
  date: number
}

/** How a checked-out branch relates to its remote branch. */
export interface SyncState {
  /** e.g. origin/feature; none when the branch has no remote counterpart */
  upstream?: string
  /** commits on the remote that the branch does not have yet */
  behind: number
  /** commits that are not pushed yet */
  ahead: number
  /** uncommitted changes in the folder */
  dirty: boolean
}

export type PullResult =
  | { result: 'updated' | 'up-to-date' }
  | { result: 'diverged' | 'blocked' | 'no-upstream'; message: string }

/** A branch of a Project: local, on the remote, or both. */
export interface BranchInfo {
  name: string
  local: boolean
  remote: boolean
  /** epoch ms of the last commit */
  date: number
  author: string
  subject: string
  /** folder of a worktree that has it checked out; it cannot be checked out a second time */
  checkedOutAt?: string
}

/** git operations for Projects and Branch worktrees; swappable in tests. */
export interface RepoGit {
  cloneBare(url: string, dest: string): Promise<void>
  fetch(gitDir: string): Promise<void>
  /** where a new Branch starts when it does not exist yet */
  defaultBase(gitDir: string): Promise<string>
  /** make a Pull Request's head available as `origin/pr-<n>` (needed for forks) */
  fetchPullRef(gitDir: string, number: number): Promise<void>
  branchExists(gitDir: string, branch: string): Promise<'local' | 'remote' | 'none'>
  addWorktree(gitDir: string, path: string, branch: string, base?: string): Promise<void>
  removeWorktree(gitDir: string, path: string): Promise<void>
  /** a worktree to another place, with everything in it (uncommitted work, ignored files) */
  moveWorktree(gitDir: string, from: string, to: string): Promise<void>
  /** hide paths from `git status` of one worktree without touching tracked files */
  excludeLocally(worktree: string, patterns: string[]): Promise<void>
  status(worktree: string): Promise<WorktreeStatus>
  pushState(worktree: string): Promise<PushState>
  currentBranch(worktree: string): Promise<string>
  syncState(worktree: string): Promise<SyncState>
  /** the branch `origin/HEAD` points at, e.g. main */
  defaultBranch(gitDir: string): Promise<string | undefined>
  /** the newest commits of a branch (local if there is one, else origin/) */
  branchCommits(gitDir: string, branch: string, limit: number): Promise<CommitInfo[]>
  /** commits of `branch` that `base` lacks, and the other way round */
  aheadBehind(gitDir: string, base: string, branch: string): Promise<{ ahead: number; behind: number }>
  /** why a local branch should not be deleted without force (its commits would be lost), or undefined */
  localDeleteBlocker(gitDir: string, branch: string, alsoDeletingRemote: boolean): Promise<string | undefined>
  deleteLocalBranch(gitDir: string, branch: string): Promise<void>
  /** `git push origin --delete` */
  deleteRemoteBranch(gitDir: string, branch: string): Promise<void>
  /** fast-forward the branch to its remote branch; never merges or rewrites */
  pullFastForward(worktree: string): Promise<PullResult>
  /** every local and `origin/` branch with its last commit */
  listBranches(gitDir: string): Promise<BranchInfo[]>
  /** where the repository was cloned from, e.g. git@github.com:org/repo.git */
  remoteUrl(gitDir: string): Promise<string | undefined>
  /** is `ancestor` part of `descendant`'s history */
  isAncestor(gitDir: string, ancestor: string, descendant: string): Promise<boolean>
}

/**
 * A command that needs the files of a Branch folder. The folder is named as the work tree on purpose: in a bare clone
 * that has `extensions.worktreeConfig` switched on (some tools do that), git takes `core.bare = true` for every linked
 * folder and refuses with "this operation must be run in a work tree".
 */
const inTree = (worktree: string, args: string[]): Promise<string> => git(worktree, ['--work-tree=.', ...args])

/**
 * A bare clone that has `extensions.worktreeConfig` switched on gives every new linked folder `core.bare = true`: git, the terminal and
 * VS Code then refuse there ("this operation must be run in a work tree"). The folder gets its own `core.bare = false`.
 */
async function unbare(gitDir: string, worktree: string): Promise<void> {
  if ((await git(gitDir, ['config', '--type=bool', '--default', 'false', 'extensions.worktreeconfig'])) !== 'true') return
  await git(worktree, ['config', '--worktree', 'core.bare', 'false'])
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd })
  return stdout.trim()
}

/**
 * Commands that talk to the remote run one at a time, and a refused login is tried again: GitHub (or the SSH agent) turns down some of
 * several logins opened at once with "Permission denied (publickey)", which made a fetch fail at random while the key was fine.
 */
let remoteQueue: Promise<unknown> = Promise.resolve()
const REFUSED = /Permission denied \(publickey\)|Connection closed|kex_exchange_identification|Connection reset/i

export function remoteGit(cwd: string, args: string[], tries = 3, wait = 700): Promise<string> {
  const attempt = async (): Promise<string> => {
    for (let n = 1; ; n++) {
      try {
        return await git(cwd, args)
      } catch (err) {
        const said = (err as { stderr?: string }).stderr ?? (err as Error).message
        if (n >= tries || !REFUSED.test(said)) throw err
        await new Promise((r) => setTimeout(r, wait * n))
      }
    }
  }
  const next = remoteQueue.then(attempt, attempt)
  remoteQueue = next.catch(() => undefined)
  return next
}

const ok = (cwd: string, args: string[]): Promise<boolean> =>
  git(cwd, args).then(
    () => true,
    () => false
  )

export const realRepoGit: RepoGit = {
  async cloneBare(url, dest) {
    await mkdir(dirname(dest), { recursive: true })
    await git(dirname(dest), ['clone', '--bare', url, dest])
    // bare clones do not track remote branches by default
    await git(dest, ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'])
    await git(dest, ['fetch', 'origin'])
    // `clone --bare` copies remote heads as local branches that never update; branches
    // are created from origin/* with tracking instead
    const heads = await git(dest, ['for-each-ref', '--format=%(refname)', 'refs/heads'])
    for (const ref of heads.split('\n').filter(Boolean)) await git(dest, ['update-ref', '-d', ref])
  },
  async fetch(gitDir) {
    await remoteGit(gitDir, ['fetch', '--prune', 'origin'])
  },
  async fetchPullRef(gitDir, number) {
    await remoteGit(gitDir, ['fetch', 'origin', `+pull/${number}/head:refs/remotes/origin/pr-${number}`])
  },
  async defaultBase(gitDir) {
    if (await ok(gitDir, ['rev-parse', '--verify', 'refs/remotes/origin/HEAD'])) return 'origin/HEAD'
    return 'HEAD'
  },
  async branchExists(gitDir, branch) {
    if (await ok(gitDir, ['rev-parse', '--verify', `refs/heads/${branch}`])) return 'local'
    if (await ok(gitDir, ['rev-parse', '--verify', `refs/remotes/origin/${branch}`])) return 'remote'
    return 'none'
  },
  async addWorktree(gitDir, path, branch, base) {
    const exists = await this.branchExists(gitDir, branch)
    if (exists === 'local') await git(gitDir, ['worktree', 'add', path, branch])
    else if (exists === 'remote') await git(gitDir, ['worktree', 'add', '--track', '-b', branch, path, `origin/${branch}`])
    else {
      const from = base ?? (await this.defaultBase(gitDir))
      // a repository without a commit has nothing to branch from: the Branch starts empty (git 2.42+)
      if (!(await ok(gitDir, ['rev-parse', '--verify', `${from}^{commit}`]))) await git(gitDir, ['worktree', 'add', '--orphan', '-b', branch, path])
      else await git(gitDir, ['worktree', 'add', '--no-track', '-b', branch, path, from])
    }
    await unbare(gitDir, path)
  },
  async moveWorktree(gitDir, from, to) {
    await git(gitDir, ['worktree', 'move', from, to])
  },
  async removeWorktree(gitDir, path) {
    try {
      await git(gitDir, ['worktree', 'remove', '--force', path])
    } catch (err) {
      // a folder that is no longer a work tree (or is gone) leaves a stale entry: forget it, the folder is removed by the caller
      if (await ok(path, ['rev-parse', '--is-inside-work-tree'])) throw err
      await git(gitDir, ['worktree', 'prune'])
    }
  },
  async excludeLocally(worktree, patterns) {
    const file = resolve(worktree, await git(worktree, ['rev-parse', '--git-path', 'info/exclude']))
    await mkdir(dirname(file), { recursive: true })
    const current = await readFile(file, 'utf8').catch(() => '')
    const missing = patterns.filter((p) => !current.split('\n').includes(p))
    if (missing.length) await appendFile(file, (current.endsWith('\n') || !current ? '' : '\n') + missing.join('\n') + '\n')
  },
  async status(worktree) {
    const out = await inTree(worktree, ['status', '--porcelain'])
    const result: WorktreeStatus = { uncommitted: [], untracked: [] }
    for (const line of out.split('\n').filter(Boolean)) {
      if (line.startsWith('??')) result.untracked.push(line.slice(3))
      else result.uncommitted.push(line.slice(3))
    }
    return result
  },
  async pushState(worktree) {
    if (!(await ok(worktree, ['rev-parse', '--abbrev-ref', '@{u}']))) {
      return { hasUpstream: false, ahead: 0 }
    }
    return { hasUpstream: true, ahead: Number(await git(worktree, ['rev-list', '--count', '@{u}..HEAD'])) }
  },
  async isAncestor(gitDir, ancestor, descendant) {
    return ok(gitDir, ['merge-base', '--is-ancestor', `refs/heads/${ancestor}`, `refs/heads/${descendant}`])
  },
  async listBranches(gitDir) {
    const refs = await git(gitDir, ['for-each-ref', '--format=%(refname)%09%(committerdate:unix)%09%(authorname)%09%(subject)', 'refs/heads', 'refs/remotes/origin'])
    const byName = new Map<string, BranchInfo>()
    for (const line of refs.split('\n').filter(Boolean)) {
      const [ref, unix, author, ...rest] = line.split('\t')
      const local = ref.startsWith('refs/heads/')
      const name = ref.replace(/^refs\/(heads|remotes\/origin)\//, '')
      if (name === 'HEAD') continue
      const info = byName.get(name) ?? { name, local: false, remote: false, date: 0, author, subject: rest.join('\t') }
      if (local) info.local = true
      else info.remote = true
      // the newer of local and remote tells what the branch is about
      if (Number(unix) * 1000 >= info.date) Object.assign(info, { date: Number(unix) * 1000, author, subject: rest.join('\t') })
      byName.set(name, info)
    }
    const trees = await git(gitDir, ['worktree', 'list', '--porcelain']).catch(() => '')
    for (const block of trees.split('\n\n')) {
      const path = /^worktree (.+)$/m.exec(block)?.[1]
      const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1]
      const info = branch ? byName.get(branch) : undefined
      if (path && info) info.checkedOutAt = path
    }
    return [...byName.values()].sort((a, b) => b.date - a.date)
  },
  async defaultBranch(gitDir) {
    try {
      return (await git(gitDir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).replace(/^origin\//, '')
    } catch {
      for (const name of ['main', 'master']) {
        if (await ok(gitDir, ['rev-parse', '--verify', `refs/remotes/origin/${name}`])) return name
        if (await ok(gitDir, ['rev-parse', '--verify', `refs/heads/${name}`])) return name
      }
      return undefined
    }
  },
  async branchCommits(gitDir, branch, limit) {
    const ref = (await ok(gitDir, ['rev-parse', '--verify', `refs/heads/${branch}`])) ? `refs/heads/${branch}` : `refs/remotes/origin/${branch}`
    const out = await git(gitDir, ['log', `-n${limit}`, '--format=%H%x09%ct%x09%an%x09%s', ref])
    return out.split('\n').filter(Boolean).map((l) => {
      const [sha, unix, author, ...subject] = l.split('\t')
      return { sha, date: Number(unix) * 1000, author, subject: subject.join('\t') }
    })
  },
  async aheadBehind(gitDir, base, branch) {
    const rev = async (name: string) => ((await ok(gitDir, ['rev-parse', '--verify', `refs/heads/${name}`])) ? `refs/heads/${name}` : `refs/remotes/origin/${name}`)
    const [behind, ahead] = (await git(gitDir, ['rev-list', '--left-right', '--count', `${await rev(base)}...${await rev(branch)}`])).split(/\s+/).map(Number)
    return { ahead, behind }
  },
  async localDeleteBlocker(gitDir, branch, alsoDeletingRemote) {
    // every commit must exist on some remote branch, or deleting the branch would lose work. (git's own `branch -d`
    // checks against HEAD, which in a bare clone made by WorkDesk points at nothing.) When the remote branch goes too,
    // it cannot count as the safe copy.
    const remotes = (await git(gitDir, ['branch', '-r', '--contains', `refs/heads/${branch}`]))
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.includes('->'))
      .filter((l) => !(alsoDeletingRemote && l === `origin/${branch}`))
    if (remotes.length > 0) return undefined
    return alsoDeletingRemote
      ? `${branch} has commits that exist on no other branch: deleting it locally and on the remote would lose them (use force to delete anyway)`
      : `${branch} has commits that are not on any remote branch; deleting it would lose them (use force to delete anyway)`
  },
  async deleteLocalBranch(gitDir, branch) {
    try {
      await git(gitDir, ['branch', '-D', branch])
    } catch (err) {
      throw new Error(((err as { stderr?: string }).stderr ?? (err as Error).message).trim().split('\n')[0])
    }
  },
  async deleteRemoteBranch(gitDir, branch) {
    try {
      await remoteGit(gitDir, ['push', 'origin', '--delete', branch])
    } catch (err) {
      const stderr = ((err as { stderr?: string }).stderr ?? (err as Error).message).trim()
      // somebody (GitHub, after the merge) deleted it already: that is what was asked, only the clone's note of it is stale
      if (/remote ref does not exist/i.test(stderr)) {
        await ok(gitDir, ['update-ref', '-d', `refs/remotes/origin/${branch}`])
        return
      }
      throw new Error(stderr.split('\n').filter(Boolean).slice(-1)[0])
    }
  },
  async syncState(worktree) {
    const dirty = (await inTree(worktree, ['status', '--porcelain'])) !== ''
    try {
      const upstream = await git(worktree, ['rev-parse', '--abbrev-ref', '@{u}'])
      const [behind, ahead] = (await git(worktree, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])).split(/\s+/).map(Number)
      return { upstream, behind, ahead, dirty }
    } catch {
      return { behind: 0, ahead: 0, dirty }
    }
  },
  async pullFastForward(worktree) {
    const state = await this.syncState(worktree)
    if (!state.upstream) return { result: 'no-upstream', message: 'This branch has no remote branch to pull from' }
    if (state.behind === 0) return { result: 'up-to-date' }
    if (state.ahead > 0) {
      return { result: 'diverged', message: `Local and remote both have new commits (${state.ahead} ahead, ${state.behind} behind); rebase or merge in a terminal` }
    }
    try {
      await inTree(worktree, ['merge', '--ff-only', '@{u}'])
      return { result: 'updated' }
    } catch (err) {
      const text = ((err as { stderr?: string }).stderr ?? (err as Error).message).trim().split('\n')[0]
      return { result: 'blocked', message: text || 'The branch could not be fast-forwarded' }
    }
  },
  async remoteUrl(gitDir) {
    return git(gitDir, ['config', '--get', 'remote.origin.url']).then((u) => u || undefined, () => undefined)
  },
  async currentBranch(worktree) {
    return git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD'])
  }
}
