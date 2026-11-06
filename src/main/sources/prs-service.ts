import { repoFromUrl, type PrItem } from '../domain/prs'
import type { ProjectRegistry } from '../projects/projects'
import type { WorkDeskService } from '../service'
import type { GithubApi } from './github/api'
import { GITHUB_SOURCE_ID } from './github/source'
import type { SourceStore } from './store'

/** Pull Requests of one repository, grouped under its Project when it has one. */
export interface PrRepo {
  repo: string
  /** name of the registered Project this repository belongs to */
  project?: string
  /** watched by hand (can be removed), not from a Project */
  manual: boolean
  items: PrItem[]
  error?: string
  fetched: boolean
}

export interface PrsState {
  repos: PrRepo[]
  fetchedAt: number | null
  skipped: string[]
}

interface WatchConfig {
  repos: string[]
}

const REPO_RE = /^[\w][\w.-]*\/[\w.][\w.-]*$/

/** Open Pull Requests of the Projects' repositories (and extra watched ones), turned into Todos on request. */
export class PrsService {
  private cache = new Map<string, { items: PrItem[]; error?: string }>()
  private fetchedAt: number | null = null

  /** Forget what was read (another Profile is in view, with its own login and repositories). */
  reset(): void {
    this.cache.clear()
    this.fetchedAt = null
  }

  constructor(
    private readonly d: {
      service: WorkDeskService
      store: SourceStore
      registry: ProjectRegistry
      github: (profileId?: string) => Promise<{ api: GithubApi; me: string }>
      now?: () => number
    }
  ) {}

  private async watched(): Promise<{ repo: string; project?: string; manual: boolean }[]> {
    const out: { repo: string; project?: string; manual: boolean }[] = []
    for (const p of await this.d.registry.listVisibleWithUrls()) {
      const repo = p.url ? repoFromUrl(p.url) : undefined
      if (repo && !out.some((o) => o.repo.toLowerCase() === repo.toLowerCase())) out.push({ repo, project: p.name, manual: false })
    }
    const extra = await this.d.store.config<WatchConfig>(GITHUB_SOURCE_ID, { repos: [] })
    for (const repo of extra.repos) if (!out.some((o) => o.repo.toLowerCase() === repo.toLowerCase())) out.push({ repo, manual: true })
    return out
  }

  async state(): Promise<PrsState> {
    const watched = await this.watched()
    return {
      fetchedAt: this.fetchedAt,
      skipped: await this.d.store.skipped(GITHUB_SOURCE_ID),
      repos: watched.map((w) => {
        const hit = this.cache.get(w.repo)
        return { ...w, items: hit?.items ?? [], error: hit?.error, fetched: !!hit }
      })
    }
  }

  /** Fetch repositories: all of them, or only those not fetched yet. */
  async refresh(all: boolean): Promise<PrsState> {
    const watched = await this.watched()
    const todo = watched.filter((w) => all || !this.cache.has(w.repo))
    if (todo.length > 0) {
      const { api, me } = await this.d.github()
      await Promise.all(
        todo.map(async (w) => {
          const [owner, repo] = w.repo.split('/')
          try {
            this.cache.set(w.repo, { items: await api.openPrs(owner, repo, me) })
          } catch (err) {
            this.cache.set(w.repo, { items: [], error: (err as Error).message })
          }
        })
      )
      this.fetchedAt = (this.d.now ?? Date.now)()
    }
    return this.state()
  }

  async addRepo(repo: string): Promise<PrsState> {
    const name = repo.trim()
    if (!REPO_RE.test(name)) throw new Error('Use the form owner/name')
    if (!(await this.watched()).some((w) => w.repo.toLowerCase() === name.toLowerCase())) {
      const cfg = await this.d.store.config<WatchConfig>(GITHUB_SOURCE_ID, { repos: [] })
      await this.d.store.setConfig(GITHUB_SOURCE_ID, { ...cfg, repos: [...cfg.repos, name] })
    }
    return this.refresh(false)
  }

  async removeRepo(repo: string): Promise<PrsState> {
    const cfg = await this.d.store.config<WatchConfig>(GITHUB_SOURCE_ID, { repos: [] })
    await this.d.store.setConfig(GITHUB_SOURCE_ID, { ...cfg, repos: cfg.repos.filter((r) => r !== repo) })
    this.cache.delete(repo)
    return this.state()
  }

  async skip(id: string, on: boolean): Promise<PrsState> {
    await (on ? this.d.store.markSkipped(GITHUB_SOURCE_ID, id) : this.d.store.unmarkSkipped(GITHUB_SOURCE_ID, id))
    return this.state()
  }
}
