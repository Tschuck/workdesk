import type { BranchPrStatus } from '../domain/prs'
import { repoFromUrl } from '../domain/prs'
import type { ProjectRegistry } from '../projects/projects'
import type { WorkDesk } from '../domain/types'
import type { WorkDeskService } from '../service'
import type { GithubApi } from './github/api'

/** One branch of a WorkDesk and the Pull Requests from it. */
export interface BranchPrs {
  project: string
  branch: string
  /** owner/name on GitHub; missing when the Project's remote is not a GitHub repository */
  repo?: string
  prs: BranchPrStatus[]
  /** where a Pull Request for this branch can be opened */
  createUrl?: string
  error?: string
}

export interface DeskPrs {
  fetchedAt: number
  branches: BranchPrs[]
}

const TTL_MS = 5 * 60_000

/** Where a Pull Request for the branch can be opened, against the branch it is stacked on. */
const compareUrl = (repo: string, b: { branch: string; base?: string }): string =>
  `https://github.com/${repo}/compare/${encodeURIComponent(b.base ?? '')}${b.base ? '...' : ''}${encodeURIComponent(b.branch)}?expand=1`

/** Pull Requests of the branches of a WorkDesk, with their status. Kept for five minutes; a refresh asks again. */
export class DeskPrsService {
  private cache = new Map<string, DeskPrs>()

  constructor(
    private readonly d: {
      service: WorkDeskService
      registry: ProjectRegistry
      github: (profileId?: string) => Promise<{ api: GithubApi; me: string }>
      now?: () => number
    }
  ) {}

  async forDesk(deskId: string, refresh: boolean): Promise<DeskPrs> {
    const now = (this.d.now ?? Date.now)()
    const desk = this.d.service.getState().desks.find((x) => x.id === deskId)
    if (!desk) throw new Error(`Unknown WorkDesk ${deskId}`)
    const cached = this.cache.get(deskId)
    const sameBranches = cached && cached.branches.map((b) => b.project + '/' + b.branch).join() === desk.branches.map((b) => b.project + '/' + b.branch).join()
    if (!refresh && cached && sameBranches && now - cached.fetchedAt < TTL_MS) return cached

    const urls = new Map((await this.d.registry.listWithUrls()).map((p) => [p.name, p.url]))
    const { api, me } = await this.d.github(this.d.service.profileOf(desk))
    const branches = api.hasGraphql ? await this.branchesGraphql(api, desk.branches, urls) : await this.branchesRest(api, desk.branches, urls)
    const result = { fetchedAt: now, branches }
    this.cache.set(deskId, result)
    await this.assign(deskId, branches, me)
    return result
  }

  /**
   * The open Pull Requests of a WorkDesk's branches are work items of that WorkDesk: they show with its work items and are
   * watched from then on. One that another WorkDesk has, or a second one for a Review WorkDesk, stays where it is.
   */
  private async assign(deskId: string, branches: BranchPrs[], me: string): Promise<void> {
    for (const b of branches) {
      for (const p of b.prs) {
        if (p.state !== 'open' || !b.repo) continue
        const id = `${b.repo}#${p.number}`
        // somebody else's Pull Request is one to review, not a work item of your own that makes the WorkDesk wait
        const role = p.author && p.author.toLowerCase() !== me.toLowerCase() ? ('review' as const) : undefined
        try {
          await this.d.service.addDeskItem(deskId, { kind: 'pr', id, title: p.title, url: p.url, subtitle: b.repo, ...(role ? { role } : {}) })
        } catch {
          // already in a WorkDesk, or not allowed there: nothing to do (an older one without a role is told whose it is by the watch of the pull requests)
        }
      }
    }
  }

  /** All branches in one request. When it fails, every branch shows the error. */
  private async branchesGraphql(api: GithubApi, desk: WorkDesk['branches'], urls: Map<string, string | undefined>): Promise<BranchPrs[]> {
    const known = desk.map((b) => {
      const url = urls.get(b.project)
      const repo = url ? repoFromUrl(url) : undefined
      return { b, repo, createUrl: repo ? compareUrl(repo, b) : undefined }
    })
    const asked = known.filter((k) => k.repo)
    try {
      const lists = await api.branchPrsBatch(asked.map((k) => ({ owner: k.repo!.split('/')[0], repo: k.repo!.split('/')[1], branch: k.b.branch })))
      return known.map((k) => {
        const i = asked.indexOf(k)
        return k.repo ? { project: k.b.project, branch: k.b.branch, repo: k.repo, prs: lists[i], createUrl: k.createUrl } : { project: k.b.project, branch: k.b.branch, prs: [] }
      })
    } catch (err) {
      return known.map((k) => (k.repo ? { project: k.b.project, branch: k.b.branch, repo: k.repo, prs: [], createUrl: k.createUrl, error: (err as Error).message } : { project: k.b.project, branch: k.b.branch, prs: [] }))
    }
  }

  /** One request per branch and Pull Request: for a login that cannot send GraphQL. */
  private branchesRest(api: GithubApi, desk: WorkDesk['branches'], urls: Map<string, string | undefined>): Promise<BranchPrs[]> {
    return Promise.all(
      desk.map(async (b): Promise<BranchPrs> => {
        const url = urls.get(b.project)
        const repo = url ? repoFromUrl(url) : undefined
        if (!repo) return { project: b.project, branch: b.branch, prs: [] }
        const [owner, name] = repo.split('/')
        const createUrl = compareUrl(repo, b)
        try {
          return { project: b.project, branch: b.branch, repo, prs: await api.branchPrs(owner, name, b.branch), createUrl }
        } catch (err) {
          return { project: b.project, branch: b.branch, repo, prs: [], createUrl, error: (err as Error).message }
        }
      })
    )
  }

  /** The Pull Requests of one branch of a Project, whether or not a WorkDesk has it. */
  async forBranch(project: string, branch: string): Promise<BranchPrs> {
    const url = (await this.d.registry.listWithUrls()).find((p) => p.name === project)?.url
    const repo = url ? repoFromUrl(url) : undefined
    if (!repo) return { project, branch, prs: [] }
    const [owner, name] = repo.split('/')
    const createUrl = `https://github.com/${repo}/compare/${encodeURIComponent(branch)}?expand=1`
    try {
      const { api, me } = await this.d.github()
      const prs = api.hasGraphql ? (await api.branchPrsBatch([{ owner, repo: name, branch }]))[0] : await api.branchPrs(owner, name, branch)
      return { project, branch, repo, prs, createUrl }
    } catch (err) {
      return { project, branch, repo, prs: [], createUrl, error: (err as Error).message }
    }
  }
}
