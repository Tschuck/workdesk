import { randomUUID } from 'node:crypto'
import { applyDerivedStage, isWaitingStage } from '../domain/stage'
import { addSignal } from '../domain/signal'
import { deriveDeskStage, diffPr } from '../domain/review'
import type { BranchWorktree, ReviewInfo, WorkDesk } from '../domain/types'
import type { ProjectRegistry } from '../projects/projects'
import type { RepoGit } from '../projects/repo-git'
import { createBranchWorktree } from '../projects/worktrees'
import type { WorkDeskService } from '../service'
import { repoFromUrl, type PrTodoState } from '../domain/prs'
import { matchesRepo, needingWork, parsePrId, type GithubApi, type OpenPr, type PrInfo, type WatchedPrState } from './github/api'
import { watchedPrs } from './pr-watch'
import { RemoteCache } from '../remote-cache'
import { DEFAULT_PROFILE_ID } from '../domain/profiles'
import { prReadiness, READINESS_LABEL } from '../domain/prs'
import { GITHUB_SOURCE_ID } from './github/source'
import type { Candidate, Source } from './source'
import type { SourceStore } from './store'

export interface SourcesDeps {
  service: WorkDeskService
  sources: Source[]
  store: SourceStore
  registry: ProjectRegistry
  repoGit: RepoGit
  /** the GitHub client of a Profile's login; none: of the Profile in view */
  github: (profileId?: string) => Promise<{ api: GithubApi; me: string }>
  /** where remote answers are kept; without one every call goes to the network */
  remote?: RemoteCache
  /**
   * Which pull requests the lists offer: with several Profiles only those of repositories that are Projects of the Profile in view (the same login
   * can see the repositories of all of them). `undefined`: all of them.
   */
  scope?: () => Promise<((prId: string) => boolean) | undefined>
  log?: (msg: string, err?: unknown) => void
}

/** Candidates, Review WorkDesks and the polling that keeps them current. */
export class SourcesService {
  private polling = false

  private readonly remote: RemoteCache

  constructor(private readonly d: SourcesDeps) {
    this.remote = d.remote ?? new RemoteCache({ ttlMs: 0 })
  }

  private source(id: string): Source {
    const s = this.d.sources.find((x) => x.id === id)
    if (!s) throw new Error(`Unknown Source ${id}`)
    return s
  }

  async candidates(sourceId: string, refresh = false): Promise<Candidate[]> {
    const source = this.source(sourceId)
    // what the source offers is kept; what was skipped is taken out each time, so a skip shows at once
    const all = await this.remote.get(`candidates:${sourceId}`, () => source.fetchCandidates(), { refresh })
    const inScope = sourceId === GITHUB_SOURCE_ID ? await this.d.scope?.() : undefined
    return this.d.store.notSkipped(sourceId, inScope ? all.filter((c) => inScope(c.id)) : all)
  }

  /**
   * The user's own Pull Requests that need work. One whose branch a WorkDesk has checked out is left out: that
   * WorkDesk already shows it.
   */
  async myPrsNeedingWork(refresh = false): Promise<Candidate[]> {
    const inScope = await this.d.scope?.()
    const prs = needingWork(await this.myOpenPrs(refresh)).filter((c) => !inScope || inScope(c.id))
    const checkedOut = new Set<string>()
    const projects = await this.d.registry.listWithUrls()
    for (const desk of this.d.service.getState().desks) {
      for (const b of desk.branches) {
        const url = projects.find((p) => p.name === b.project)?.url
        const repo = url ? repoFromUrl(url) : undefined
        if (repo) checkedOut.add(`${repo.toLowerCase()}:${b.branch}`)
      }
    }
    return this.d.store.notSkipped(
      GITHUB_SOURCE_ID,
      prs.filter((c) => !c.branch || !checkedOut.has(`${parsePrId(c.id).owner}/${parsePrId(c.id).repo}:${c.branch}`.toLowerCase()))
    )
  }

  /** Pull Requests that were seen merged or closed: they are not asked about again. */
  private readonly done = new Set<string>()

  /**
   * The Pull Requests of the started WorkDesks, read with ONE request and kept for the length of a round: the PR watch
   * (chips, "ready to merge") and the review polling (Signals) both take what they need from it.
   */
  async watched(refresh = false): Promise<Map<string, WatchedPrState>> {
    const desks = this.d.service.getState().desks
    // each Pull Request is read with the login of the Profile of the WorkDesk that has it, whichever Profile is in view
    const byProfile = new Map<string, Set<string>>()
    for (const p of watchedPrs(desks)) {
      if (this.done.has(p.id)) continue
      const profile = this.d.service.profileOf(desks.find((d) => d.id === p.deskId) ?? {})
      byProfile.set(profile, (byProfile.get(profile) ?? new Set()).add(p.id))
    }
    const read = new Map<string, WatchedPrState>()
    for (const [profile, set] of byProfile) {
      const ids = [...set].sort()
      // the key of Profile #1 is the one from before Profiles
      const key = `github:watched:${profile === DEFAULT_PROFILE_ID ? '' : profile + ':'}${ids.join(',')}`
      try {
        const part = await this.remote.get(key, async () => {
          const { api, me } = await this.d.github(profile)
          return api.prBatch(ids, me, Date.now())
        }, { refresh })
        for (const [id, e] of part) read.set(id, e)
      } catch (err) {
        // one Profile's login failing must not stop the others being watched
        if (byProfile.size === 1) throw err
        this.d.log?.(`watching the Pull Requests of Profile ${profile} failed`, err)
      }
    }
    for (const [id, e] of read) if (e.state.state !== 'open') this.done.add(id)
    return read
  }

  /** Every open Pull Request of the user's, as something to pick, with where it stands as the hint: for adding one to a WorkDesk. */
  async myPrs(refresh = false): Promise<Candidate[]> {
    const inScope = await this.d.scope?.()
    return (await this.myOpenPrs(refresh)).filter((p) => !inScope || inScope(p.id)).map((p) => ({
      id: p.id, title: p.title, name: p.title, url: p.url, subtitle: p.repo, hint: READINESS_LABEL[prReadiness(p.state)], branch: p.head, draft: p.state.draft
    }))
  }

  /** All the user's open Pull Requests with their state: one request, shared by everything that needs them. */
  myOpenPrs(refresh = false, profileId?: string): Promise<OpenPr[]> {
    return this.remote.get(profileId && profileId !== DEFAULT_PROFILE_ID ? `github:my-prs:${profileId}` : 'github:my-prs', async () => {
      const { api, me } = await this.d.github(profileId)
      return api.myOpenPrs(me, Date.now())
    }, { refresh })
  }

  /**
   * Own open Pull Requests whose branch a started WorkDesk has become work items of that WorkDesk. Uses the list of the
   * user's open Pull Requests that is kept anyway, so it costs no request of its own.
   */
  async assignOwnPrs(): Promise<number> {
    const desks = this.d.service.getState().desks.filter((d) => d.presence !== 'parked' && d.presence !== 'planned' && d.branches.length > 0)
    if (desks.length === 0) return 0
    const urls = new Map((await this.d.registry.listWithUrls()).map((p) => [p.name, p.url]))
    const own = new Map<string, OpenPr[]>()
    let added = 0
    for (const desk of desks) {
      // the open Pull Requests of the login of the WorkDesk's own Profile
      const profile = this.d.service.profileOf(desk)
      let prs = own.get(profile)
      if (!prs) {
        try {
          prs = await this.myOpenPrs(false, profile)
        } catch (err) {
          this.d.log?.(`assigning Pull Requests for Profile ${profile} failed`, err)
          prs = []
        }
        own.set(profile, prs)
      }
      for (const b of desk.branches) {
        const url = urls.get(b.project)
        const repo = url ? repoFromUrl(url)?.toLowerCase() : undefined
        if (!repo) continue
        for (const p of prs.filter((x) => x.repo.toLowerCase() === repo && x.head === b.branch)) {
          try {
            await this.d.service.addDeskItem(desk.id, { kind: 'pr', id: p.id, title: p.title, url: p.url, subtitle: p.repo })
            added++
          } catch {
            // it is in a WorkDesk already, or this one cannot take it
          }
        }
      }
    }
    return added
  }

  /** The registered Project a Pull Request belongs to and the branch it comes from; none for a fork or an unknown repository. */
  prBranch(id: string, refresh = false): Promise<{ project?: string; branch?: string }> {
    return this.remote.get(`github:pr-branch:${id}`, async () => {
      const { owner, repo, number } = parsePrId(id)
      const { api } = await this.d.github()
      const info = await api.prInfo(owner, repo, number)
      if (info.fromFork) return {}
      const projects = await this.d.registry.listWithUrls()
      const project = projects.find((p) => p.url && matchesRepo(p.url, owner, repo)) ?? projects.find((p) => p.name === repo)
      return project ? { project: project.name, branch: info.headRef } : { branch: info.headRef }
    }, { refresh })
  }

  /** Where one Pull Request stands, for the detail pane of a work item. */
  prState(id: string, refresh = false): Promise<PrTodoState> {
    return this.remote.get(`github:pr:${id}`, async () => {
      const { owner, repo, number } = parsePrId(id)
      const { api, me } = await this.d.github()
      return api.prDetails(owner, repo, number, me, Date.now())
    }, { refresh })
  }

  skip(sourceId: string, candidateId: string): Promise<void> {
    this.source(sourceId)
    return this.d.store.markSkipped(sourceId, candidateId)
  }

  /** Check the Pull Request's head branch out in its own worktree, cloning the repository the first time. */
  async checkoutPr(owner: string, repo: string, number: number, deskId: string, known?: PrInfo, existing: readonly BranchWorktree[] = []): Promise<BranchWorktree> {
    const { service, registry, repoGit } = this.d
    const info = known ?? (await (await this.d.github()).api.prInfo(owner, repo, number))
    // a renamed Project is still found by where it was cloned from
    const projects = await registry.listWithUrls()
    const project =
      projects.find((p) => p.url && matchesRepo(p.url, owner, repo)) ??
      projects.find((p) => p.name === repo) ??
      (await registry.addByClone(repo, info.cloneUrl))
    await repoGit.fetch(project.gitDir)
    if (info.fromFork) await repoGit.fetchPullRef(project.gitDir, number)
    const branch = info.fromFork ? `pr-${number}` : info.headRef
    const worktree = await createBranchWorktree(repoGit, service.root, deskId, project, [...existing], branch)
    // which pull request this folder is the checkout of
    return { ...worktree, pr: `${owner}/${repo}#${number}` }
  }

  /**
   * Where a Pull Request's review stands, for a Review WorkDesk: one GraphQL request (REST needs six, one `gh` process each).
   * A login that cannot send GraphQL falls back to REST.
   */
  async reviewFor(owner: string, repo: string, number: number): Promise<{ url: string; snapshot: NonNullable<ReviewInfo['snapshot']> }> {
    const { api, me } = await this.d.github()
    if (api.hasGraphql) {
      const id = `${owner}/${repo}#${number}`
      const read = (await api.prBatch([id], me, Date.now())).get(id)
      if (!read) throw new Error(`Pull Request ${id} not found`)
      return { url: read.state.url, snapshot: read.snapshot }
    }
    return { url: (await api.prInfo(owner, repo, number)).url, snapshot: await api.snapshot(owner, repo, number, me) }
  }

  /** The head branch of a pull request (for finding its ticket by the key in the name); none when GitHub cannot say. */
  async prHeadRef(owner: string, repo: string, number: number): Promise<string | undefined> {
    try {
      return (await (await this.d.github()).api.prInfo(owner, repo, number)).headRef
    } catch {
      return undefined
    }
  }

  /** Check out the branches of the pull requests a WorkDesk reviews that are not checked out yet (one folder each). */
  async checkoutReview(deskId: string) {
    const { service } = this.d
    const desk = service.getState().desks.find((d) => d.id === deskId)
    if (!desk) throw new Error(`Unknown WorkDesk ${deskId}`)
    if ((desk.reviews ?? []).length === 0) throw new Error('This WorkDesk reviews no Pull Request, so there is no branch to check out')
    const missing = desk.reviews!.filter((r) => !desk.branches.some((b) => b.pr === `${r.owner}/${r.repo}#${r.number}`))
    if (missing.length === 0) throw new Error('The branches are checked out already')
    const made: BranchWorktree[] = []
    for (const r of missing) made.push(await this.checkoutPr(r.owner, r.repo, r.number, deskId, undefined, [...desk.branches, ...made]))
    await service.updateDesk(deskId, (d) => ({ ...d, branches: [...d.branches, ...made] }))
    return service.getState()
  }

  /** One polling round over all open Review WorkDesks. Returns how many were updated. `refresh` asks GitHub again instead of taking what was read a moment ago. */
  async poll(refresh = false): Promise<number> {
    if (this.polling) return 0
    this.polling = true
    try {
      // the WorkDesks with a pull request that is still open
      const reviewing = this.d.service.getState().desks.filter((x) => x.presence !== 'planned' && (x.reviews ?? []).some((r) => r.snapshot?.state !== 'merged' && r.snapshot?.state !== 'closed'))
      if (reviewing.length === 0) return 0
      const read = await this.watched(refresh)
      let updated = 0
      for (const desk of reviewing) {
        const fresh = new Map<string, NonNullable<ReviewInfo['snapshot']>>()
        for (const r of desk.reviews ?? []) {
          const next = read.get(`${r.owner}/${r.repo}#${r.number}`)?.snapshot
          if (next) fresh.set(`${r.owner}/${r.repo}#${r.number}`, next)
        }
        if (fresh.size === 0) continue
        try {
          await this.d.service.updateDesk(desk.id, (cur) => applyChanges(cur, fresh))
          updated++
        } catch (err) {
          this.d.log?.(`polling ${desk.id} failed`, err)
        }
      }
      return updated
    } catch (err) {
      this.d.log?.('polling failed', err)
      return 0
    } finally {
      this.polling = false
    }
  }
}

/** What GitHub said about the pull requests of a WorkDesk: the snapshots, the Signals for what changed, and the Stage worked out from all of them. */
export function applyChanges(desk: WorkDesk, fresh: ReadonlyMap<string, NonNullable<ReviewInfo['snapshot']>>): WorkDesk {
  let signals = desk.signals
  const reviews = (desk.reviews ?? []).map((r) => {
    const next = fresh.get(`${r.owner}/${r.repo}#${r.number}`)
    if (!next) return r
    const branchPath = desk.branches.find((b) => b.pr === `${r.owner}/${r.repo}#${r.number}`)?.path ?? desk.branches[0]?.path
    for (const type of diffPr(r.snapshot, next).signals) signals = addSignal(signals, { id: randomUUID(), type, at: Date.now(), branchPath })
    return { ...r, snapshot: next }
  })
  const stage = applyDerivedStage({ stage: desk.stage, stageOverridden: desk.stageOverridden }, deriveDeskStage(reviews) ?? desk.stage)
  // the review was handed over: what Claude raised while you worked on it (finished, needs input) is old news and must not keep the WorkDesk out of Waiting; a Signal of this very poll stays
  if (!isWaitingStage(desk.stage) && isWaitingStage(stage.stage)) {
    const old = new Set(desk.signals.map((x) => x.id))
    signals = signals.map((x) => (old.has(x.id) ? { ...x, read: true } : x))
  }
  return { ...desk, ...stage, signals, reviews }
}
