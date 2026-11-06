import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prReadiness, prStatusLabel, reviewVerdicts } from '../domain/prs'
import { ProjectRegistry } from '../projects/projects'
import type { RepoGit } from '../projects/repo-git'
import { WorkDeskService } from '../service'
import { FakeGit } from '../status/fake-git'
import { DeskPrsService } from './desk-prs'
import { GithubApi } from './github/api'

describe('review verdicts', () => {
  it('counts the latest verdict of each reviewer; comments do not undo an approval', () => {
    expect(reviewVerdicts([])).toEqual({ approvals: 0, changesRequested: 0 })
    expect(reviewVerdicts([
      { user: 'a', state: 'CHANGES_REQUESTED' }, { user: 'a', state: 'APPROVED' },
      { user: 'b', state: 'APPROVED' }, { user: 'b', state: 'COMMENTED' },
      { user: 'c', state: 'CHANGES_REQUESTED' },
      { user: 'd', state: 'APPROVED' }, { user: 'd', state: 'DISMISSED' },
      { user: 'e', state: 'PENDING' }, { state: 'APPROVED' }
    ])).toEqual({ approvals: 2, changesRequested: 1 })
  })
})

describe('Pull Requests of a WorkDesk', () => {
  let tmp: string
  let service: WorkDeskService
  let calls: string[]
  let now: number
  let failList: boolean
  let prs: DeskPrsService

  const pull = (n: number, over: object = {}) => ({
    number: n, title: `PR ${n}`, html_url: `https://github.com/o/app/pull/${n}`, state: 'open', merged_at: null, draft: false,
    base: { ref: 'main' }, head: { sha: 'sha' + n }, requested_reviewers: [], requested_teams: [], ...over
  })

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'workdesk-dp-'))
    const root = join(tmp, 'root')
    service = new WorkDeskService(root, new FakeGit())
    await service.load()
    await mkdir(service.status.dir, { recursive: true })
    await writeFile(join(service.status.dir, 'projects.json'), JSON.stringify([
      { name: 'app', gitDir: '/g/app.git', origin: 'bare-clone' },
      { name: 'other', gitDir: '/g/other.git', origin: 'bare-clone' }
    ]))
    const urls: Record<string, string> = { '/g/app.git': 'git@github.com:o/app.git', '/g/other.git': 'https://gitlab.com/x/y.git' }
    const git = { remoteUrl: async (d: string) => urls[d] } as unknown as RepoGit
    calls = []
    failList = false
    now = 1000
    const api = new GithubApi(async (p) => {
      calls.push(p)
      if (p.includes('/pulls?head=')) {
        if (failList) throw new Error('GitHub 403 for /repos/o/app/pulls')
        if (p.includes(encodeURIComponent('o:feature'))) {
          return [pull(7, { requested_reviewers: [{ login: 'zoe' }], requested_teams: [{ name: 'core' }] }), pull(3, { state: 'closed', merged_at: '2026-01-01' })]
        }
        if (p.includes(encodeURIComponent('o:draft'))) return [pull(9, { draft: true })]
        return []
      }
      if (/\/pulls\/\d+$/.test(p)) return { mergeable_state: p.endsWith('/pulls/7') ? 'blocked' : 'clean' }
      if (p.includes('/pulls/7/reviews')) return [{ user: { login: 'a' }, state: 'APPROVED' }, { user: { login: 'b' }, state: 'CHANGES_REQUESTED' }]
      if (p.includes('/reviews')) return []
      if (p.includes('/check-runs')) return { check_runs: p.includes('sha7') ? [{ status: 'completed', conclusion: 'failure' }] : [{ status: 'completed', conclusion: 'success' }] }
      throw new Error('unexpected ' + p)
    })
    prs = new DeskPrsService({
      service, registry: new ProjectRegistry(join(service.status.dir, 'projects.json'), git, root), github: async () => ({ api, me: 'me' }), now: () => now
    })
    let s = await service.addTodo({ title: 'T', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'Desk')
    const wt = (project: string, branch: string, base?: string) => ({ project, branch, base, path: '/x/' + branch, index: 1 })
    await service.updateDesk('desk', (d) => ({ ...d, branches: [wt('app', 'feature'), wt('app', 'draft', 'feature'), wt('app', 'no-pr'), wt('other', 'on-gitlab')] }))
  })
  afterEach(async () => {
    service.status.autoCommit.dispose()
    await rm(tmp, { recursive: true, force: true })
  })

  it('finds the Pull Requests of each branch with state, CI, reviews and who is asked', async () => {
    const r = await prs.forDesk('desk', false)
    const feature = r.branches.find((b) => b.branch === 'feature')!
    expect(feature.repo).toBe('o/app')
    expect(feature.prs.map((p) => [p.number, p.state, p.ci, p.approvals, p.changesRequested, p.pending])).toEqual([
      [7, 'open', 'failure', 1, 1, ['zoe', 'core']],
      [3, 'merged', 'success', 0, 0, []]
    ])
    expect(feature.prs[0]).toMatchObject({ title: 'PR 7', base: 'main', url: 'https://github.com/o/app/pull/7' })
    expect(feature.prs.map(prStatusLabel)).toEqual(['open', 'merged'])
    // the same readiness rule as for a review Todo: PR 7 has a change request, so it is not ready
    expect(feature.prs[0].mergeable).toBe('blocked')
    expect(prReadiness(feature.prs[0])).toBe('changes-requested')
    expect(prReadiness(r.branches.find((b) => b.branch === 'draft')!.prs[0])).toBe('draft')
    expect(r.branches.find((b) => b.branch === 'draft')!.prs.map(prStatusLabel)).toEqual(['draft'])
  })

  it('makes the open Pull Requests of the branches work items of the WorkDesk, once, and not the merged ones', async () => {
    await prs.forDesk('desk', false)
    const items = () => service.getState().desks[0].items
    expect(items()).toEqual([
      { kind: 'pr', id: 'o/app#7', title: 'PR 7', url: 'https://github.com/o/app/pull/7', subtitle: 'o/app' },
      { kind: 'pr', id: 'o/app#9', title: 'PR 9', url: 'https://github.com/o/app/pull/9', subtitle: 'o/app' }
    ])
    await prs.forDesk('desk', true)
    expect(items()).toHaveLength(2)
  })

  it('leaves a Pull Request alone that another WorkDesk has', async () => {
    let s = await service.addTodo({ title: 'U', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[1].id], 'Other desk')
    await service.addDeskItem('other-desk', { kind: 'pr', id: 'o/app#7', title: 'PR 7' })
    await prs.forDesk('desk', false)
    expect(service.getState().desks.find((d) => d.id === 'desk')!.items?.map((i) => i.id)).toEqual(['o/app#9'])
  })

  it('offers to open a Pull Request for a branch without one, against the branch it is stacked on', async () => {
    const r = await prs.forDesk('desk', false)
    const by = Object.fromEntries(r.branches.map((b) => [b.branch, b]))
    expect(by['no-pr'].prs).toEqual([])
    expect(by['no-pr'].createUrl).toBe('https://github.com/o/app/compare/no-pr?expand=1')
    expect(by['draft'].createUrl).toBe('https://github.com/o/app/compare/feature...draft?expand=1')
    // a repository that is not on GitHub is left out, without an error
    expect(by['on-gitlab']).toEqual({ project: 'other', branch: 'on-gitlab', prs: [] })
  })

  it('keeps for five minutes, refreshes on request, and keeps one failing branch from hiding the others', async () => {
    await prs.forDesk('desk', false)
    const n = calls.length
    now += 4 * 60_000
    await prs.forDesk('desk', false)
    expect(calls.length).toBe(n)
    now += 61_000
    await prs.forDesk('desk', false)
    expect(calls.length).toBeGreaterThan(n)

    const m = calls.length
    await prs.forDesk('desk', true)
    expect(calls.length).toBeGreaterThan(m)

    failList = true
    const r = await prs.forDesk('desk', true)
    expect(r.branches.find((b) => b.branch === 'feature')).toMatchObject({ prs: [], error: expect.stringContaining('403') })
    expect(r.branches.find((b) => b.branch === 'on-gitlab')!.prs).toEqual([])
    await expect(prs.forDesk('nope', false)).rejects.toThrow(/Unknown WorkDesk/)
  })

  it('asks again when the WorkDesk gets another branch', async () => {
    await prs.forDesk('desk', false)
    const n = calls.length
    await service.updateDesk('desk', (d) => ({ ...d, branches: [...d.branches, { project: 'app', branch: 'draft2', path: '/x/d2', index: 2 }] }))
    await prs.forDesk('desk', false)
    expect(calls.length).toBeGreaterThan(n)
  })
})

describe('Pull Requests of a WorkDesk through GraphQL', () => {
  let tmp: string
  let service: WorkDeskService
  let queries: string[]
  let failing = false
  let prs: DeskPrsService

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'workdesk-dpg-'))
    const root = join(tmp, 'root')
    service = new WorkDeskService(root, new FakeGit())
    await service.load()
    await mkdir(service.status.dir, { recursive: true })
    await writeFile(join(service.status.dir, 'projects.json'), JSON.stringify([
      { name: 'app', gitDir: '/g/app.git', origin: 'bare-clone' },
      { name: 'other', gitDir: '/g/other.git', origin: 'bare-clone' }
    ]))
    const urls: Record<string, string> = { '/g/app.git': 'git@github.com:o/app.git', '/g/other.git': 'https://gitlab.com/x/y.git' }
    const git = { remoteUrl: async (d: string) => urls[d] } as unknown as RepoGit
    queries = []
    failing = false
    const node = (n: number) => ({ number: n, title: `PR ${n}`, url: `https://github.com/o/app/pull/${n}`, state: 'OPEN', merged: false, isDraft: false, baseRefName: 'main', mergeStateStatus: 'CLEAN' })
    const api = new GithubApi(async () => ({}), async (q) => {
      queries.push(q)
      if (failing) throw new Error('GitHub GraphQL 502')
      return { a0: { pullRequests: { nodes: [node(7)] } }, a1: { pullRequests: { nodes: [] } } }
    })
    prs = new DeskPrsService({ service, registry: new ProjectRegistry(join(service.status.dir, 'projects.json'), git, root), github: async () => ({ api, me: 'me' }) })
    let s = await service.addTodo({ title: 'T', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'Desk')
    const wt = (project: string, branch: string) => ({ project, branch, path: '/x/' + branch, index: 1 })
    await service.updateDesk('desk', (d) => ({ ...d, branches: [wt('app', 'feature'), wt('other', 'on-gitlab'), wt('app', 'no-pr')] }))
  })
  afterEach(async () => {
    service.status.autoCommit.dispose()
    await rm(tmp, { recursive: true, force: true })
  })

  it('asks once for all the branches of the WorkDesk, skips the ones that are not on GitHub, and assigns the open pull requests', async () => {
    const r = await prs.forDesk('desk', false)
    expect(queries).toHaveLength(1)
    expect(r.branches.map((b) => [b.branch, b.repo, b.prs.map((p) => p.number)])).toEqual([['feature', 'o/app', [7]], ['on-gitlab', undefined, []], ['no-pr', 'o/app', []]])
    expect(r.branches[0].createUrl).toContain('/o/app/compare/')
    expect(service.getState().desks[0].items?.map((i) => i.id)).toEqual(['o/app#7'])
  })

  it('shows the error on every branch that was asked about when the request fails', async () => {
    failing = true
    const r = await prs.forDesk('desk', true)
    expect(r.branches.map((b) => [b.branch, b.error])).toEqual([['feature', 'GitHub GraphQL 502'], ['on-gitlab', undefined], ['no-pr', 'GitHub GraphQL 502']])
  })
})
