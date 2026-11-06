import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectRegistry } from '../projects/projects'
import type { RepoGit } from '../projects/repo-git'
import { RemoteCache } from '../remote-cache'
import { WorkDeskService } from '../service'
import { FakeGit } from '../status/fake-git'
import { GithubApi } from './github/api'
import type { Candidate } from './source'
import { SourcesService } from './sources-service'
import { SourceStore } from './store'

const node = (n: number, over: Record<string, unknown> = {}) => ({
  number: n, title: `PR ${n}`, url: `https://github.com/o/app/pull/${n}`, isDraft: false, state: 'OPEN', merged: false,
  headRefName: `branch-${n}`, baseRefName: 'main', mergeStateStatus: 'DIRTY', repository: { nameWithOwner: 'o/app' }, author: { login: 'me' },
  commits: { nodes: [] }, latestOpinionatedReviews: { nodes: [] }, ...over
})

describe('remote data is kept, shared and asked for once', () => {
  let tmp: string
  let service: WorkDeskService
  let sources: SourcesService
  let requests: { graphql: number; candidates: number }

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'workdesk-rc-'))
    const root = join(tmp, 'root')
    service = new WorkDeskService(root, new FakeGit())
    await service.load()
    await mkdir(service.status.dir, { recursive: true })
    await writeFile(join(service.status.dir, 'projects.json'), JSON.stringify([{ name: 'app', gitDir: '/g/app.git', origin: 'bare-clone' }]))
    const git = { remoteUrl: async () => 'git@github.com:o/app.git' } as unknown as RepoGit
    requests = { graphql: 0, candidates: 0 }
    const api = new GithubApi(async () => ({}), async () => {
      requests.graphql++
      return { search: { nodes: [node(1), node(2, { mergeStateStatus: 'CLEAN' })] } }
    })
    sources = new SourcesService({
      service,
      sources: [{ id: 'github-prs', name: 'GitHub', fetchCandidates: async (): Promise<Candidate[]> => (requests.candidates++, [{ id: 'o/app#9', title: 'Nine', url: 'u' }, { id: 'o/app#10', title: 'Ten', url: 'u' }]) }],
      store: new SourceStore(service.status.dir),
      registry: new ProjectRegistry(join(service.status.dir, 'projects.json'), git, root),
      repoGit: git,
      github: async () => ({ api, me: 'me' }),
      remote: new RemoteCache()
    })
  })
  afterEach(async () => {
    service.status.autoCommit.dispose()
    await rm(tmp, { recursive: true, force: true })
  })

  it('asks a source once, again on a refresh, and a skip shows without asking', async () => {
    expect((await sources.candidates('github-prs')).map((c) => c.id)).toEqual(['o/app#9', 'o/app#10'])
    await sources.candidates('github-prs')
    expect(requests.candidates).toBe(1)
    await sources.skip('github-prs', 'o/app#9')
    expect((await sources.candidates('github-prs')).map((c) => c.id)).toEqual(['o/app#10'])
    expect(requests.candidates).toBe(1)
    await sources.candidates('github-prs', true)
    expect(requests.candidates).toBe(2)
  })

  it('reads all own pull requests with one request, and lists those that need work', async () => {
    expect((await sources.myPrsNeedingWork()).map((c) => [c.id, c.hint])).toEqual([['o/app#1', 'merge conflicts']])
    // the list for adding to a WorkDesk has all of them, with where each stands, from the same kept answer
    expect((await sources.myPrs()).map((c) => [c.id, c.hint, c.branch])).toEqual([['o/app#1', 'merge conflicts', 'branch-1'], ['o/app#2', 'needs a review', 'branch-2']])
    await sources.myPrsNeedingWork()
    await sources.assignOwnPrs()
    expect(requests.graphql).toBe(1)
    await sources.myPrsNeedingWork(true)
    expect(requests.graphql).toBe(2)
  })

  it('assigns the own pull request of a started WorkDesk\'s branch, once, and leaves parked and planned ones alone', async () => {
    let s = await service.addTodo({ title: 'T', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'Desk')
    const wt = (branch: string) => ({ project: 'app', branch, path: '/x/' + branch, index: 1 })
    await service.updateDesk('desk', (d) => ({ ...d, branches: [wt('branch-1'), wt('other')] }))
    expect(await sources.assignOwnPrs()).toBe(1)
    expect(service.getState().desks[0].items).toEqual([{ kind: 'pr', id: 'o/app#1', title: 'PR 1', url: 'https://github.com/o/app/pull/1', subtitle: 'o/app' }])
    expect(await sources.assignOwnPrs()).toBe(0)

    await service.removeDeskItem('desk', 'pr', 'o/app#1')
    await service.parkDesk('desk')
    expect(await sources.assignOwnPrs()).toBe(0)
    expect(requests.graphql).toBe(1)
  })
})
