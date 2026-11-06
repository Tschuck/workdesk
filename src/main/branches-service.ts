import { rm } from 'node:fs/promises'
import type { AppState } from '../shared/api'
import { restackSteps, ticketBranchName, type RestackStep } from './domain/stack'
import { deskDir, worktreeDirName } from './projects/layout'
import { deskNoteId } from './domain/desk-todos'
import type { ProjectRegistry } from './projects/projects'
import type { BranchInfo, CommitInfo, PullResult, RepoGit, SyncState } from './projects/repo-git'
import { githubBranchUrl, repoFromUrl } from './domain/prs'
import { EnvStore } from './env/env-store'
import { join } from 'node:path'
import { createBranchWorktree, ensureDeskFolder, preflight, type PreflightIssue } from './projects/worktrees'
import type { WorkDeskService } from './service'
import type { BranchWorktree, DeskItem, WorkDesk } from './domain/types'
import { parsePrId } from './sources/github/api'
import { deriveDeskStage } from './domain/review'
import type { SourcesService } from './sources/sources-service'

/** A branch as offered on the Branches page. */
export interface BranchRow extends BranchInfo {
  /** the WorkDesk that already has it */
  inDesk?: { id: string; name: string }
}

export interface ProjectBranches {
  project: string
  branches: BranchRow[]
  error?: string
}

export interface BranchSync extends SyncState {
  project: string
  branch: string
}

/** A branch that does not exist yet. */
export interface NewBranch {
  project: string
  branch: string
  /** where it starts: an existing branch of the Project; empty = the default branch */
  from?: string
}

/** Everything the Branches page shows about one branch. */
export interface BranchDetails extends BranchRow {
  project: string
  /** the default branch of the Project, e.g. main */
  defaultBranch?: string
  isDefault: boolean
  /** the branch on GitHub; only for a pushed branch of a GitHub repository */
  githubUrl?: string
  /** commits not in the default branch, and commits it has that this branch lacks */
  ahead: number
  behind: number
  /** all of it is in the default branch already (a squash merge is not recognised) */
  merged: boolean
  commits: CommitInfo[]
}

export interface DeleteOptions {
  local: boolean
  remote: boolean
  /** delete a local branch that is not merged (`git branch -D`) */
  force?: boolean
}

export interface BranchRef {
  project: string
  branch: string
}

/** What the user picked to start a WorkDesk from. */
export interface StartItemsRequest {
  name: string
  todoIds: string[]
  items: DeskItem[]
  branches: BranchRef[]
  /** for a lone ticket: the Projects that get a branch named after it */
  projects: string[]
  /** check out the branches of Pull Requests */
  checkout: boolean
  /** only plan it: the WorkDesk is made but nothing is checked out or started */
  plan?: boolean
}

/** Ticket WorkDesks, extra Branches and Stacks. */
export class BranchesService {
  constructor(
    private readonly service: WorkDeskService,
    private readonly registry: ProjectRegistry,
    private readonly git: RepoGit,
    /** a Branch was checked out and its Project has commands for that: show them running in the WorkDesk */
    private readonly onCheckedOut: (deskId: string, worktree: BranchWorktree, commands: string[]) => Promise<void> = async () => undefined
  ) {}

  /** Set once the sources exist: needed to check Pull Request branches out. */
  sources?: Pick<SourcesService, 'checkoutPr' | 'reviewFor'>

  /** After a checkout went through: the Project's commands run in a terminal of the WorkDesk. Never fails the checkout. */
  async announce(deskId: string, worktrees: readonly BranchWorktree[]): Promise<void> {
    for (const w of worktrees) {
      try {
        const commands = (await this.registry.get(w.project)).checkoutCommands ?? []
        if (commands.length > 0) await this.onCheckedOut(deskId, w, commands)
      } catch {
        // a missing terminal must not undo a checkout
      }
    }
  }

  /**
   * Start a WorkDesk from several work items at once: Todos, Pull Requests, tickets and branches. The Pull Requests that are not yours
   * are reviewed in it (their Stage follows GitHub); a lone ticket with Projects gets a branch named after it.
   * Pull Requests and tickets stay what they are (no Todo is made); Todos move into the WorkDesk.
   */
  async startFromItems(req: StartItemsRequest): Promise<AppState> {
    const { todoIds, items, plan = false } = req
    const existing = plan ? [] : req.branches
    const projects = plan ? [] : req.projects
    const checkout = plan ? false : req.checkout
    if (todoIds.length + items.length + existing.length === 0) throw new Error('Pick at least one item')
    const plainTodos = todoIds
    const all = items
    const taken = new Set(this.service.getState().desks.flatMap((d) => (d.items ?? []).map((i) => `${i.kind}:${i.id}`)))
    for (const i of items) if (taken.has(`${i.kind}:${i.id}`)) throw new Error(`"${i.title}" is already in a WorkDesk`)
    const prs = all.filter((i) => i.kind === 'pr')
    const tickets = all.filter((i) => i.kind === 'ticket')
    // the Pull Requests that are somebody else's: reviewed here (one of yours is only a work item)
    const reviewed = prs.filter((p) => p.role !== 'mine')
    const lone = plainTodos.length + existing.length + tickets.length === 0 && prs.length === 1 ? prs[0] : undefined
    const ticketKey = tickets.length === 1 && prs.length === 0 && plainTodos.length === 0 ? tickets[0].ticketKey : undefined
    if (projects.length > 0 && tickets.every((t) => !t.ticketKey)) throw new Error('Projects are only used for a ticket with a key')
    await this.assertAvailable(existing)

    const first = this.service.getState().todos.find((t) => t.id === todoIds[0])
    const title = req.name.trim() || first?.title || items[0]?.title || existing[0]?.branch || 'WorkDesk'
    const id = this.service.uniqueDeskId(ticketKey ?? (lone ? `review-${parsePrId(lone.id).repo}-${parsePrId(lone.id).number}` : title))
    const created: { worktree: BranchWorktree; gitDir: string }[] = []
    const add = async (projectName: string, branch: string) => {
      const project = await this.registry.get(projectName)
      await this.git.fetch(project.gitDir).catch(() => undefined)
      const worktree = await createBranchWorktree(this.git, this.service.root, id, project, created.map((c) => c.worktree), branch)
      created.push({ worktree, gitDir: project.gitDir })
    }
    try {
      for (const b of existing) await add(b.project, b.branch)
      if (ticketKey && projects.length > 0) for (const p of projects) await add(p, ticketBranchName(ticketKey))
      const reviews: NonNullable<WorkDesk['reviews']> = []
      for (const pr of reviewed) {
        const { owner, repo, number } = parsePrId(pr.id)
        if (plan) {
          // planning asks GitHub nothing: the review state is read when the WorkDesk is started
          reviews.push({ owner, repo, number, url: pr.url ?? `https://github.com/${owner}/${repo}/pull/${number}` })
        } else {
          if (!this.sources) throw new Error('GitHub is not set up')
          const { url, snapshot } = await this.sources.reviewFor(owner, repo, number)
          reviews.push({ owner, repo, number, url, snapshot })
        }
      }
      const stage: WorkDesk['stage'] = deriveDeskStage(reviews) ?? 'implement'
      if (checkout && prs.length > 0) {
        if (!this.sources) throw new Error('GitHub is not set up')
        for (const pr of prs) {
          const { owner, repo, number } = parsePrId(pr.id)
          created.push({ worktree: await this.sources.checkoutPr(owner, repo, number, id, undefined, created.map((c) => c.worktree)), gitDir: '' })
        }
      }
      const worktrees = created.length > 1 ? await this.inferStacks(created.filter((c) => c.gitDir)).then((s) => [...s, ...created.filter((c) => !c.gitDir).map((c) => c.worktree)]) : created.map((c) => c.worktree)
      const state = await this.service.registerItemsDesk(
        { id, name: title, stage, stageOverridden: false, presence: plan ? 'planned' : 'inactive', todoIds: [...todoIds], items: items as DeskItem[], branches: worktrees, ...(reviews.length > 0 ? { reviews } : {}), signals: [], createdAt: Date.now() },
        todoIds
      )
      await this.announce(id, worktrees)
      return state
    } catch (err) {
      for (const c of created) if (c.gitDir) await this.git.removeWorktree(c.gitDir, c.worktree.path).catch(() => undefined)
      await rm(deskDir(this.service.root, id), { recursive: true, force: true })
      throw err
    }
  }

  /**
   * Make one WorkDesk of two: everything of `otherId` goes into `targetId` (its pull requests, Todos, pages and note, and its branch
   * folders, moved with git so uncommitted work and the review comments in them come along). The emptied WorkDesk is left for the caller
   * to clear. Nothing is changed when a folder cannot be moved.
   */
  async combineDesks(targetId: string, otherId: string): Promise<AppState> {
    if (targetId === otherId) throw new Error('Pick another WorkDesk to combine with')
    const target = this.desk(targetId)
    const other = this.desk(otherId)
    for (const w of other.branches) {
      if (target.branches.some((t) => t.project === w.project && t.branch === w.branch)) throw new Error(`${w.branch} of ${w.project} is in both WorkDesks: take it out of one first`)
    }
    // the folders: to `<target>/<project>[--n-branch]`, numbered after the ones of that Project the target has
    const dir = await ensureDeskFolder(this.service.root, targetId, this.service.status.dirOfDesk(targetId, target.profileId))
    const moved: { from: string; to: string; gitDir: string; worktree: BranchWorktree }[] = []
    try {
      for (const w of other.branches) {
        const index = [...target.branches, ...moved.map((m) => m.worktree)].filter((x) => x.project === w.project).length + 1
        const to = join(dir, worktreeDirName(w.project, index, w.branch))
        const gitDir = (await this.registry.get(w.project)).gitDir
        await this.git.moveWorktree(gitDir, w.path, to)
        moved.push({ from: w.path, to, gitDir, worktree: { ...w, path: to, index } })
      }
    } catch (err) {
      for (const m of moved.reverse()) await this.git.moveWorktree(m.gitDir, m.to, m.from).catch(() => undefined)
      throw err
    }

    // the note of the other WorkDesk is put under the one of this one
    const status = this.service.status
    const theirs = (await status.readNote(deskNoteId(otherId))).trim()
    if (theirs) {
      const mine = (await status.readNote(deskNoteId(targetId))).trim()
      await status.writeNote(deskNoteId(targetId), `${mine ? mine + '\n\n---\n\n' : ''}From "${other.name}":\n\n${theirs}\n`)
    }
    const seen = new Set((target.items ?? []).map((i) => `${i.kind}:${i.id}`))
    const items = [...(target.items ?? []), ...(other.items ?? []).filter((i) => !seen.has(`${i.kind}:${i.id}`))]
    const prId = (r: { owner: string; repo: string; number: number }) => `${r.owner}/${r.repo}#${r.number}`
    const known = new Set((target.reviews ?? []).map(prId))
    const reviews = [...(target.reviews ?? []), ...(other.reviews ?? []).filter((r) => !known.has(prId(r)))]
    const refUrls = new Set((target.refs ?? []).map((r) => r.url))
    const refs = [...(target.refs ?? []), ...(other.refs ?? []).filter((r) => !refUrls.has(r.url))]
    await this.service.updateDesk(targetId, (d) => {
      const stage = d.stageOverridden ? d.stage : (deriveDeskStage(reviews) ?? d.stage)
      return { ...d, stage, branches: [...d.branches, ...moved.map((m) => m.worktree)], items, reviews: reviews.length > 0 ? reviews : undefined, refs: refs.length > 0 ? refs : undefined }
    })
    await this.service.updateDesk(otherId, (d) => ({ ...d, branches: [] }))
    // the Todos move over one by one (out of the other WorkDesk, into this one)
    for (const id of other.todoIds) await this.service.assignTodoToDesk(id, targetId)
    return this.service.getState()
  }

  /** Add a Branch to a WorkDesk; with `base` it joins the Stack on top of that Branch. */
  async addBranch(deskId: string, project: string, branch: string, base?: string) {
    const desk = this.desk(deskId)
    const name = branch.trim()
    if (!name || /\s/.test(name)) throw new Error('Branch names cannot be empty or contain spaces')
    const p = await this.registry.get(project)
    const rows = (await this.listBranches(false)).find((l) => l.project === project)?.branches ?? []
    const exists = rows.some((b) => b.name === name)
    // an existing name is checked out (and must be free); a new name starts at `base`: any branch of the Project
    if (exists) await this.assertAvailable([{ project, branch: name }])
    let ref: string | undefined
    const from = !exists ? base?.trim() || undefined : undefined
    if (from) {
      const row = rows.find((b) => b.name === from)
      if (!row) throw new Error(`Cannot start from ${from}: no such branch in ${project}`)
      ref = row.local ? from : `origin/${from}`
    }
    const created = await createBranchWorktree(this.git, this.service.root, deskId, p, desk.branches, name, ref)
    // a new branch targets the branch it starts from; an existing one sits on the nearest of the WorkDesk's branches in its history
    const stackedOn = exists ? await this.nearestBase(p.gitDir, name, desk.branches.filter((b) => b.project === project).map((b) => b.branch)) : from
    await this.service.updateDesk(deskId, (d) => ({ ...d, branches: [...d.branches, stackedOn ? { ...created, base: stackedOn } : created] }))
    await this.announce(deskId, [created])
    return this.service.getState()
  }

  /** Branches that no longer sit on top of their base. Only proposes; nothing is changed. */
  async restackPlan(deskId: string): Promise<RestackStep[]> {
    const desk = this.service.getState().desks.find((d) => d.id === deskId)
    if (!desk) throw new Error(`Unknown WorkDesk ${deskId}`)
    const gitDirs = new Map((await this.registry.list()).map((p) => [p.name, p.gitDir]))
    const behind = new Set<BranchWorktree>()
    for (const b of desk.branches) {
      const gitDir = gitDirs.get(b.project)
      if (b.base && gitDir && !(await this.git.isAncestor(gitDir, b.base, b.branch))) behind.add(b)
    }
    return restackSteps(desk, (b) => behind.has(b))
  }

  /** Branches of the Projects of the Profile in view (a Project of another Profile is neither listed nor fetched); `refresh` fetches them from the remotes first. */
  async listBranches(refresh: boolean): Promise<ProjectBranches[]> {
    const desks = this.service.getState().desks
    return Promise.all(
      (await this.registry.listVisible()).map(async (p): Promise<ProjectBranches> => {
        try {
          if (refresh) await this.git.fetch(p.gitDir)
          const branches = (await this.git.listBranches(p.gitDir)).map((b): BranchRow => {
            const desk = desks.find((d) => d.branches.some((x) => x.project === p.name && x.branch === b.name))
            return { ...b, inDesk: desk ? { id: desk.id, name: desk.name } : undefined }
          })
          return { project: p.name, branches }
        } catch (err) {
          return { project: p.name, branches: [], error: (err as Error).message }
        }
      })
    )
  }

  /**
   * Start a WorkDesk from existing branches, of one or several Projects. A Todo with the WorkDesk's name is
   * made for it. Selected branches of one Project that sit on top of each other form a Stack.
   */
  async createFromBranches(selection: BranchRef[], name: string, newBranches: NewBranch[] = []): Promise<AppState> {
    const wanted = selection.filter((s, i) => selection.findIndex((x) => x.project === s.project && x.branch === s.branch) === i)
    if (wanted.length + newBranches.length === 0) throw new Error('Pick at least one branch, or name a new one')
    const title = name.trim() || wanted[0]?.branch || newBranches[0].branch
    await this.assertAvailable(wanted)
    const fresh = await this.prepareNewBranches(newBranches)

    const id = this.service.uniqueDeskId(title)
    const created: { worktree: BranchWorktree; gitDir: string }[] = []
    try {
      for (const w of wanted) {
        const project = await this.registry.get(w.project)
        const worktree = await createBranchWorktree(this.git, this.service.root, id, project, created.map((c) => c.worktree), w.branch)
        created.push({ worktree, gitDir: project.gitDir })
      }
      const startedFrom = new Map<BranchWorktree, string>()
      for (const n of fresh) {
        const project = await this.registry.get(n.project)
        const worktree = await createBranchWorktree(this.git, this.service.root, id, project, created.map((c) => c.worktree), n.branch, n.ref)
        created.push({ worktree, gitDir: project.gitDir })
        if (n.from) startedFrom.set(worktree, n.from)
      }
      // a new branch started from another branch targets it (PR base); existing ones are stacked by their history
      const branches = (await this.inferStacks(created)).map((b, i) => (startedFrom.has(created[i].worktree) ? { ...b, base: startedFrom.get(created[i].worktree) } : b))
      const state = await this.service.registerItemsDesk(
        { id, name: title, stage: 'implement', stageOverridden: false, presence: 'inactive', todoIds: [], branches, signals: [], createdAt: Date.now() },
        []
      )
      await this.announce(id, branches)
      return state
    } catch (err) {
      for (const c of created) await this.git.removeWorktree(c.gitDir, c.worktree.path).catch(() => undefined)
      await rm(deskDir(this.service.root, id), { recursive: true, force: true })
      throw err
    }
  }

  /** What would be lost if this branch's folder were removed from its WorkDesk. */
  async removalPreflight(deskId: string, project: string, branch: string): Promise<PreflightIssue[]> {
    const wt = this.desk(deskId).branches.find((b) => b.project === project && b.branch === branch)
    if (!wt) throw new Error(`${branch} of ${project} is not in this WorkDesk`)
    const issues = await preflight(this.git, [wt])
    const files = await new EnvStore(this.service.root).unstored(wt.path, project)
    if (files.length > 0) issues.push({ project, branch, kind: 'env', detail: files })
    return issues
  }

  /**
   * Take a branch out of a WorkDesk and delete its worktree folder. The branch itself stays in the Project;
   * branches that were stacked on it are re-attached to what it was based on. Call `removalPreflight` first.
   */
  async removeBranchFromDesk(deskId: string, project: string, branch: string): Promise<AppState> {
    const desk = this.desk(deskId)
    const wt = desk.branches.find((b) => b.project === project && b.branch === branch)
    if (!wt) throw new Error(`${branch} of ${project} is not in this WorkDesk`)
    const p = await this.registry.get(project)
    await this.git.removeWorktree(p.gitDir, wt.path)
    await rm(wt.path, { recursive: true, force: true })
    await this.service.updateDesk(deskId, (d) => ({
      ...d,
      branches: d.branches
        .filter((b) => b !== wt && !(b.project === project && b.branch === branch))
        .map((b) => (b.project === project && b.base === branch ? { ...b, base: wt.base } : b))
    }))
    return this.service.getState()
  }

  private async row(project: string, branch: string): Promise<{ gitDir: string; row: BranchRow }> {
    const p = await this.registry.get(project)
    const row = (await this.listBranches(false)).find((l) => l.project === project)?.branches.find((b) => b.name === branch)
    if (!row) throw new Error(`Branch ${branch} was not found in ${project}; refresh the list`)
    return { gitDir: p.gitDir, row }
  }

  /** Details of one branch: last commits, how it relates to the default branch, who has it. */
  async branchDetails(project: string, branch: string): Promise<BranchDetails> {
    const { gitDir, row } = await this.row(project, branch)
    const remoteUrl = (await this.registry.listWithUrls()).find((p) => p.name === project)?.url
    const repo = remoteUrl ? repoFromUrl(remoteUrl) : undefined
    const defaultBranch = await this.git.defaultBranch(gitDir)
    const isDefault = defaultBranch === branch
    const { ahead, behind } = defaultBranch && !isDefault ? await this.git.aheadBehind(gitDir, defaultBranch, branch) : { ahead: 0, behind: 0 }
    return {
      ...row,
      project,
      defaultBranch,
      isDefault,
      githubUrl: repo && row.remote ? githubBranchUrl(repo, branch) : undefined,
      ahead,
      behind,
      merged: !isDefault && !!defaultBranch && ahead === 0,
      commits: await this.git.branchCommits(gitDir, branch, 10)
    }
  }

  /**
   * Delete a branch locally, on the remote, or both. The default branch is never deleted, and a branch that a WorkDesk
   * or one of your own folders has checked out is not deleted locally (clear or switch it first).
   */
  async deleteBranch(project: string, branch: string, opts: DeleteOptions): Promise<ProjectBranches[]> {
    if (!opts.local && !opts.remote) throw new Error('Choose what to delete: the local branch, the remote branch, or both')
    const { gitDir, row } = await this.row(project, branch)
    const defaultBranch = await this.git.defaultBranch(gitDir)
    if (defaultBranch === branch) throw new Error(`${branch} is the default branch of ${project} and is not deleted here`)
    if (opts.local) {
      if (!row.local) throw new Error(`There is no local branch ${branch}`)
      if (row.inDesk) throw new Error(`${branch} is in the WorkDesk "${row.inDesk.name}"; clear it or take the branch out first`)
      if (row.checkedOutAt) throw new Error(`${branch} is checked out in ${row.checkedOutAt}; switch that folder to another branch first`)
    }
    if (opts.remote && !row.remote) throw new Error(`${branch} is not on the remote`)
    // nothing is deleted before the commits are known to be safe (or you forced it)
    if (opts.local && !opts.force) {
      const why = await this.git.localDeleteBlocker(gitDir, branch, !!opts.remote)
      if (why) throw new Error(why)
    }
    // the remote goes first: if it fails, the local branch (and its commits) is still there
    if (opts.remote) await this.git.deleteRemoteBranch(gitDir, branch)
    if (opts.local) await this.git.deleteLocalBranch(gitDir, branch)
    return this.listBranches(false)
  }

  private desk(deskId: string) {
    const desk = this.service.getState().desks.find((d) => d.id === deskId)
    if (!desk) throw new Error(`Unknown WorkDesk ${deskId}`)
    return desk
  }

  /** Fetch the remotes of the Projects a WorkDesk uses; local branches are not touched. */
  async fetchDesk(deskId: string): Promise<BranchSync[]> {
    const desk = this.desk(deskId)
    const projects = await this.registry.list()
    for (const name of new Set(desk.branches.map((b) => b.project))) {
      const p = projects.find((x) => x.name === name)
      if (p) await this.git.fetch(p.gitDir)
    }
    return this.deskSync(deskId)
  }

  /** How far each branch of a WorkDesk is behind or ahead of its remote branch. */
  async deskSync(deskId: string): Promise<BranchSync[]> {
    const desk = this.desk(deskId)
    return Promise.all(desk.branches.map(async (b) => ({ project: b.project, branch: b.branch, ...(await this.git.syncState(b.path)) })))
  }

  /** Bring one branch up to its remote branch, only when that is a plain fast-forward. */
  async pullBranch(deskId: string, project: string, branch: string): Promise<PullResult> {
    const wt = this.desk(deskId).branches.find((b) => b.project === project && b.branch === branch)
    if (!wt) throw new Error(`${branch} of ${project} is not in this WorkDesk`)
    return this.git.pullFastForward(wt.path)
  }

  /** Names must be new and valid; `from` must exist. Returns the ref each branch starts at. */
  private async prepareNewBranches(list: NewBranch[]): Promise<{ project: string; branch: string; from?: string; ref?: string }[]> {
    const listing = await this.listBranches(false)
    const seen = new Set<string>()
    const out: { project: string; branch: string; from?: string; ref?: string }[] = []
    for (const n of list) {
      const name = n.branch.trim()
      if (!name || /\s|\.\.|[~^:?*[\\]|\.lock$|^[-/.]|[/.]$|@\{/.test(name)) throw new Error(`"${n.branch}" is not a valid branch name`)
      const rows = listing.find((l) => l.project === n.project)
      if (!rows) throw new Error(`Unknown Project ${n.project}`)
      if (rows.branches.some((b) => b.name === name)) throw new Error(`${name} already exists in ${n.project}; pick it from the list instead`)
      if (seen.has(`${n.project}/${name}`)) throw new Error(`${name} is named twice`)
      seen.add(`${n.project}/${name}`)
      const from = n.from?.trim() || undefined
      let ref: string | undefined
      if (from) {
        const row = rows.branches.find((b) => b.name === from)
        if (!row) throw new Error(`Cannot start from ${from}: no such branch in ${n.project}`)
        // remote-only branches are reached through origin/
        ref = row.local ? from : `origin/${from}`
      }
      out.push({ project: n.project, branch: name, from, ref })
    }
    return out
  }

  /** Branches that are taken cannot be checked out a second time. */
  private async assertAvailable(wanted: BranchRef[]): Promise<void> {
    const listing = await this.listBranches(false)
    for (const w of wanted) {
      const row = listing.find((l) => l.project === w.project)?.branches.find((b) => b.name === w.branch)
      if (!row) throw new Error(`Branch ${w.branch} was not found in ${w.project}; refresh the list`)
      if (row.inDesk) throw new Error(`${w.branch} (${w.project}) is already in the WorkDesk "${row.inDesk.name}"`)
      if (row.checkedOutAt) throw new Error(`${w.branch} (${w.project}) is checked out in ${row.checkedOutAt}; switch that folder to another branch first`)
    }
  }

  /** The nearest of `candidates` that lies in the history of `branch`: what it is stacked on. */
  private async nearestBase(gitDir: string, branch: string, candidates: string[]): Promise<string | undefined> {
    const below: string[] = []
    for (const other of candidates) {
      if (other === branch) continue
      // `other` lies in the history of `branch`, and not the other way round (equal branches are no stack)
      if ((await this.git.isAncestor(gitDir, other, branch)) && !(await this.git.isAncestor(gitDir, branch, other))) below.push(other)
    }
    let base: string | undefined
    for (const c of below) {
      if (!base) base = c
      else if (await this.git.isAncestor(gitDir, base, c)) base = c
    }
    return base
  }

  /** A selected branch is based on the nearest other selected branch of its Project that it contains. */
  private async inferStacks(created: { worktree: BranchWorktree; gitDir: string }[]): Promise<BranchWorktree[]> {
    const result: BranchWorktree[] = []
    for (const { worktree: b, gitDir } of created) {
      const base = await this.nearestBase(gitDir, b.branch, created.filter((c) => c.worktree.project === b.project).map((c) => c.worktree.branch))
      result.push(base ? { ...b, base } : b)
    }
    return result
  }

  /** Add existing branches (of any Project) to an open WorkDesk; they join a Stack where they sit on its branches. */
  async addExistingBranches(deskId: string, selection: BranchRef[]): Promise<AppState> {
    const desk = this.desk(deskId)
    const wanted = selection.filter((s, i) => selection.findIndex((x) => x.project === s.project && x.branch === s.branch) === i)
    if (wanted.length === 0) throw new Error('Pick at least one branch')
    await this.assertAvailable(wanted)

    const created: { worktree: BranchWorktree; gitDir: string }[] = []
    try {
      for (const w of wanted) {
        const project = await this.registry.get(w.project)
        const worktree = await createBranchWorktree(this.git, this.service.root, deskId, project, [...desk.branches, ...created.map((c) => c.worktree)], w.branch)
        created.push({ worktree, gitDir: project.gitDir })
      }
      const added: BranchWorktree[] = []
      for (const { worktree: b, gitDir } of created) {
        const same = [...desk.branches, ...created.map((c) => c.worktree)].filter((x) => x.project === b.project).map((x) => x.branch)
        const base = await this.nearestBase(gitDir, b.branch, same)
        added.push(base ? { ...b, base } : b)
      }
      await this.service.updateDesk(deskId, (d) => ({ ...d, branches: [...d.branches, ...added] }))
      await this.announce(deskId, added)
      return this.service.getState()
    } catch (err) {
      for (const c of created) await this.git.removeWorktree(c.gitDir, c.worktree.path).catch(() => undefined)
      throw err
    }
  }
}
