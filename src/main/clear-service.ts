import { EnvStore } from './env/env-store'
import { localDateString } from './domain/todos'
import type { ProjectRegistry } from './projects/projects'
import type { RepoGit } from './projects/repo-git'
import { clearDesk, preflight, type PreflightIssue } from './projects/worktrees'
import type { AppState } from '../shared/api'
import type { WorkDeskService } from './service'
import { repoFromUrl } from './domain/prs'
import type { GithubApi } from './sources/github/api'

/**
 * A Branch of a WorkDesk that can be deleted with it. `unsafe`: why deleting the local one loses commits (they are on no remote branch);
 * `unsafeOnRemote`: the same for the remote one (only when it is on the remote): nothing else would have them.
 */
export interface ClearBranch {
  project: string
  branch: string
  /** there is a local copy (the clone) */
  local: boolean
  onRemote: boolean
  unsafe?: string
  unsafeOnRemote?: string
  /** the remote could not be asked (offline, no SSH login): what is known of it is from the last fetch and may be out of date */
  stale?: string
}

/** What to delete of a Branch with the WorkDesk: its local copy, and / or the branch on the remote. */
export interface ClearBranchPick {
  project: string
  branch: string
  local?: boolean
  remote?: boolean
}

/** Clearing a WorkDesk: look at what would be lost, then archive and remove it. Never deletes Branches. */
export class ClearService {
  private readonly env: EnvStore

  constructor(
    private readonly d: {
      service: WorkDeskService
      registry: ProjectRegistry
      git: RepoGit
      root: string
      /** stop terminals and close the editor window of the WorkDesk */
      shutDown: (deskId: string) => Promise<void>
      /** the GitHub login, to ask whether a Branch is still there (the clone's fetch needs SSH, which can fail) */
      github?: (profileId?: string) => Promise<{ api: GithubApi }>
      now?: () => number
    }
  ) {
    this.env = new EnvStore(d.root)
  }

  private desk(id: string) {
    const desk = this.d.service.getState().desks.find((x) => x.id === id)
    if (!desk) throw new Error(`Unknown WorkDesk ${id}`)
    return desk
  }

  /** Uncommitted, untracked and unpushed work, Branches without a remote, and `.env` files not in the env store. */
  async preflight(id: string): Promise<PreflightIssue[]> {
    const desk = this.desk(id)
    const issues = await preflight(this.d.git, desk.branches)
    for (const b of desk.branches) {
      const files = await this.env.unstored(b.path, b.project)
      if (files.length > 0) issues.push({ project: b.project, branch: b.branch, kind: 'env', detail: files })
    }
    return issues
  }

  /**
   * Every Branch of the WorkDesk, with whether it is on the remote and what deleting it would lose. The remote is asked first (a pruning
   * fetch): a branch that was deleted there after its merge would still show as on the remote from the last fetch.
   */
  async branches(id: string): Promise<ClearBranch[]> {
    const desk = this.desk(id)
    const projects = await this.d.registry.list()
    const urls = new Map((await this.d.registry.listWithUrls()).map((p) => [p.name, p.url]))
    const out: ClearBranch[] = []
    const fetched = new Set<string>()
    const failed = new Map<string, string>()
    for (const b of desk.branches) {
      const project = projects.find((p) => p.name === b.project)
      if (!project) continue
      if (!fetched.has(project.gitDir)) {
        fetched.add(project.gitDir)
        // offline or no access: what was fetched last is all there is, and the Branches say so
        await this.d.git.fetch(project.gitDir).catch((err: Error) => void failed.set(project.gitDir, String((err as { stderr?: string }).stderr ?? err.message).trim().split('\n').filter(Boolean).slice(-1)[0]))
      }
      const known = (await this.d.git.listBranches(project.gitDir)).find((x) => x.name === b.branch)
      // GitHub's own answer wins over the clone's note of the remote (stale when the fetch failed)
      let onRemote = known?.remote ?? false
      let asked = !failed.has(project.gitDir)
      const repo = urls.get(b.project) ? repoFromUrl(urls.get(b.project)!) : undefined
      if (!asked && repo && this.d.github) {
        try {
          const [owner, name] = repo.split('/')
          onRemote = await (await this.d.github(this.d.service.profileOf(desk))).api.branchExists(owner, name, b.branch)
          asked = true
        } catch {
          // GitHub could not be asked either: the clone's note stays, said to be out of date
        }
      }
      if (!known?.local && !onRemote) continue
      out.push({
        project: b.project,
        branch: b.branch,
        local: !!known?.local,
        onRemote,
        ...(!asked ? { stale: failed.get(project.gitDir) } : {}),
        ...(known?.local ? { unsafe: await this.d.git.localDeleteBlocker(project.gitDir, b.branch, false) } : {}),
        ...(onRemote && known?.local ? { unsafeOnRemote: await this.d.git.localDeleteBlocker(project.gitDir, b.branch, true) } : {})
      })
    }
    return out
  }

  /**
   * Only called after the user approved the pre-flight. `deleteBranches` are what the user ticked of the Branches of this WorkDesk: the
   * local copy (after the folders are gone, a checked-out Branch cannot be deleted) and / or the branch on the remote. One that cannot
   * be deleted is told about after the WorkDesk is cleared.
   */
  async clear(id: string, deleteBranches: readonly ClearBranchPick[] = []): Promise<AppState> {
    const desk = this.desk(id)
    const projects = await this.d.registry.list()
    const sessions = (await this.d.service.claudeSessions.list(id)).map((s) => s.sessionId)
    await this.d.shutDown(id)
    const { signals: _signals, ...stored } = desk
    await clearDesk(this.d.git, this.d.service.status, this.d.root, stored, desk.branches, projects, sessions, localDateString((this.d.now ?? Date.now)()))
    const failed: string[] = []
    for (const want of deleteBranches) {
      const project = projects.find((p) => p.name === want.project)
      if (!project || !desk.branches.some((b) => b.project === want.project && b.branch === want.branch)) continue
      try {
        const known = (await this.d.git.listBranches(project.gitDir)).find((b) => b.name === want.branch)
        // only when it is still there: one that is gone on the remote has nothing to delete
        if (want.remote && known?.remote) await this.d.git.deleteRemoteBranch(project.gitDir, want.branch)
        // the local copy goes after the remote one (or when there is none): a Branch that stays on the remote keeps its local copy
        if (want.local && known?.local && (!known.remote || want.remote)) await this.d.git.deleteLocalBranch(project.gitDir, want.branch)
      } catch (err) {
        failed.push(`${want.project} · ${want.branch}: ${(err as Error).message}`)
      }
    }
    const state = await this.d.service.removeDesk(id)
    if (failed.length > 0) throw new Error(`The WorkDesk is cleared, but a Branch could not be deleted: ${failed.join('; ')}`)
    return state
  }
}
