import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BranchesService } from '../branches-service'
import { ProjectRegistry } from '../projects/projects'
import { realRepoGit } from '../projects/repo-git'
import { WorkDeskService } from '../service'
import { FakeGit } from '../status/fake-git'
import { GithubApi, toSnapshot } from './github/api'
import { githubSource, GITHUB_SOURCE_ID } from './github/source'
import { applyChanges, SourcesService } from './sources-service'
import { SourceStore } from './store'

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' })
const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, env, encoding: 'utf8' }).trim()

let tmp: string
let root: string
let service: WorkDeskService
let sources: SourcesService
let branches: BranchesService
const PR = { kind: 'pr' as const, id: 'o/app#7', title: 'Fix it', url: 'https://github.com/o/app/pull/7' }
/** start the Review WorkDesk of the pull request */
const startReview = (checkout: boolean, name = '') => branches.startFromItems({ name, todoIds: [], items: [PR], branches: [], projects: [], checkout })
let pr: { reviewRequested: boolean; comments: number; checks: unknown[]; state: string; merged: boolean; reviews: unknown[] }

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'workdesk-rv-'))
  root = join(tmp, 'root')
  const seed = join(tmp, 'seed')
  const origin = join(tmp, 'origin.git')
  await mkdir(seed)
  sh(seed, 'init', '-b', 'main')
  await writeFile(join(seed, 'a'), 'a')
  sh(seed, 'add', '.')
  sh(seed, 'commit', '-m', 'init')
  sh(tmp, 'clone', '--bare', seed, origin)
  sh(seed, 'remote', 'add', 'origin', origin)
  sh(seed, 'push', 'origin', 'main:fix-it')

  pr = { reviewRequested: true, comments: 0, checks: [], state: 'open', merged: false, reviews: [] }
  const api = new GithubApi(async (p) => {
    if (p === '/user') return { login: 'me' }
    if (p.startsWith('/search/issues')) {
      return { items: [{ number: 7, title: 'Fix it', html_url: 'https://github.com/o/app/pull/7', repository_url: 'https://api.github.com/repos/o/app', user: { login: 'dev' } }] }
    }
    if (p === '/repos/o/app/pulls/7') {
      return {
        title: 'Fix it', html_url: 'https://github.com/o/app/pull/7', state: pr.state, merged: pr.merged,
        head: { ref: 'fix-it', sha: 'abc', repo: { full_name: 'o/app' } },
        base: { repo: { full_name: 'o/app', clone_url: origin } },
        requested_reviewers: pr.reviewRequested ? [{ login: 'me' }] : []
      }
    }
    if (p.includes('/reviews')) return pr.reviews
    if (p.includes('/pulls/7/comments')) return Array.from({ length: pr.comments }, () => ({ user: { login: 'x' } }))
    if (p.includes('/issues/7/comments')) return []
    if (p.includes('/check-runs')) return { check_runs: pr.checks }
    throw new Error('unexpected ' + p)
  }, async () => {
    // the same Pull Request as the background poll reads it: one GraphQL node
    const checks = pr.checks as { status: string; conclusion?: string }[]
    const rollup = checks.length === 0 ? null : { state: checks.some((c) => c.status !== 'completed') ? 'PENDING' : checks.some((c) => c.conclusion === 'failure') ? 'FAILURE' : 'SUCCESS' }
    const reviews = (pr.reviews as { user: { login: string }; state: string; commit_id: string }[]).map((r) => ({ state: r.state, author: { login: r.user.login }, commit: { oid: r.commit_id } }))
    return {
      a0: {
        pullRequest: {
          number: 7, title: 'Fix it', url: 'https://github.com/o/app/pull/7', isDraft: false, state: pr.state === 'closed' ? 'CLOSED' : 'OPEN', merged: pr.merged,
          headRefName: 'fix-it', baseRefName: 'main', headRefOid: 'abc', mergeStateStatus: 'CLEAN', repository: { nameWithOwner: 'o/app' },
          commits: { nodes: [{ commit: { statusCheckRollup: rollup } }] },
          latestOpinionatedReviews: { nodes: reviews.filter((r) => r.state !== 'COMMENTED') }, reviews: { nodes: reviews },
          reviewRequests: { nodes: pr.reviewRequested ? [{ requestedReviewer: { login: 'me' } }] : [] },
          comments: { nodes: [] }, reviewThreads: { nodes: [{ comments: { nodes: Array.from({ length: pr.comments }, () => ({ author: { login: 'x' } })) } }] }
        }
      }
    }
  })
  service = new WorkDeskService(root, new FakeGit())
  await service.load()
  const github = async () => ({ api, me: 'me' })
  const registry = new ProjectRegistry(join(service.status.dir, 'projects.json'), realRepoGit, root)
  sources = new SourcesService({
    service,
    sources: [githubSource(async () => (await github()).api)],
    store: new SourceStore(service.status.dir),
    registry,
    repoGit: realRepoGit,
    github
  })
  branches = new BranchesService(service, registry, realRepoGit)
  branches.sources = sources
})
afterEach(async () => {
  service.status.autoCommit.dispose()
  await rm(tmp, { recursive: true, force: true })
})

describe('GitHub PR Source and Review WorkDesks', () => {
  it('goes from Candidate to Review WorkDesk with a checked-out head Branch, without making a Todo', async () => {
    const [cand] = await sources.candidates(GITHUB_SOURCE_ID)
    expect(cand).toMatchObject({ id: 'o/app#7', title: 'Fix it' })

    const after = await startReview(true, '  My review  ')
    const desk = after.desks[0]
    expect(desk.name).toBe('My review')
    expect(desk).toMatchObject({ stage: 'to-review', id: 'review-app-7', items: [PR] })
    expect(desk.branches).toHaveLength(1)
    expect(await realRepoGit.currentBranch(desk.branches[0].path)).toBe('fix-it')
    expect(after.todos).toEqual([])
    await expect(startReview(true)).rejects.toThrow(/already in a WorkDesk/)
  })

  it('starts a review without checking the branch out, and checks it out later', async () => {
    const after = await startReview(false, 'Just reading')
    const desk = after.desks[0]
    expect(desk).toMatchObject({ name: 'Just reading', branches: [], reviews: [{ owner: 'o', repo: 'app', number: 7 }] })
    // nothing was cloned or checked out: no Project, no branch folder, but the WorkDesk folder with its notes exists
    expect(await new ProjectRegistry(join(service.status.dir, 'projects.json'), realRepoGit, root).list()).toEqual([])
    expect(existsSync(join(root, desk.id))).toBe(true)
    expect(existsSync(join(root, desk.id, 'app'))).toBe(false)

    // later: the branch is cloned and checked out
    const later = await sources.checkoutReview(desk.id)
    expect(later.desks[0].branches).toHaveLength(1)
    expect(await realRepoGit.currentBranch(later.desks[0].branches[0].path)).toBe('fix-it')
    expect(later.desks[0].branches[0].pr).toBe('o/app#7')
    await expect(sources.checkoutReview(desk.id)).rejects.toThrow(/already/)
    await expect(sources.checkoutReview('nope')).rejects.toThrow(/Unknown WorkDesk/)
  })

  it('only a WorkDesk that reviews a pull request has a branch to check out later', async () => {
    let s = await service.addTodo({ title: 'plain', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'Plain')
    await expect(sources.checkoutReview('plain')).rejects.toThrow(/reviews no Pull Request/)
  })

  it('plans a WorkDesk for several pull requests: each is reviewed, the Stage is the one that needs you most', async () => {
    const second = { kind: 'pr' as const, id: 'o/web#3', title: 'Show it', url: 'https://github.com/o/web/pull/3' }
    const mine = { kind: 'pr' as const, id: 'o/api#9', title: 'My own', url: 'https://github.com/o/api/pull/9', role: 'mine' as const }
    const after = await branches.startFromItems({ name: 'Both', todoIds: [], items: [PR, second, mine], branches: [], projects: [], checkout: false, plan: true })
    const desk = after.desks[0]
    expect(desk.id).toBe('both')
    expect(desk.reviews?.map((r) => `${r.repo}#${r.number}`)).toEqual(['app#7', 'web#3'])
    expect(desk.items?.map((i) => i.id)).toEqual(['o/app#7', 'o/web#3', 'o/api#9'])
    expect(desk.stage).toBe('to-review')
  })

  it('works the Stage and the Signals out from all the pull requests of a WorkDesk', () => {
    const snap = (over: object) => ({ state: 'open' as const, headSha: 'a', reviewRequested: false, commentCount: 0, ci: 'none' as const, ...over })
    const approved = { state: 'APPROVED', commitId: 'a' }
    const desk = {
      id: 'd', name: 'D', stage: 'to-review', stageOverridden: false, priority: 0, presence: 'inactive', todoIds: [], signals: [], createdAt: 0,
      branches: [{ project: 'app', branch: 'x', path: '/a', index: 1, pr: 'o/app#7' }, { project: 'web', branch: 'y', path: '/w', index: 1, pr: 'o/web#3' }],
      reviews: [
        { owner: 'o', repo: 'app', number: 7, url: 'u7', snapshot: snap({ myReview: approved }) },
        { owner: 'o', repo: 'web', number: 3, url: 'u3', snapshot: snap({ myReview: approved }) }
      ]
    } as unknown as Parameters<typeof applyChanges>[0]
    const waiting = applyChanges(desk, new Map([['o/app#7', snap({ myReview: approved })], ['o/web#3', snap({ myReview: approved })]]))
    expect(waiting.stage).toBe('reviewed-waiting')
    // the author of the frontend asks again: that one needs you, with a Signal tied to its own folder
    const again = applyChanges(waiting, new Map([['o/web#3', snap({ myReview: approved, reviewRequested: true })]]))
    expect(again.stage).toBe('re-review')
    expect(again.signals.map((s) => [s.type, s.branchPath])).toEqual([['re-review-requested', '/w']])
    expect(again.reviews?.[0].snapshot?.reviewRequested).toBe(false)
    // a hand-set Stage stays
    expect(applyChanges({ ...waiting, stage: 'testing', stageOverridden: true }, new Map([['o/web#3', snap({ reviewRequested: true })]])).stage).toBe('testing')
  })

  it('clears the Signals of the work when the review is handed over, so the WorkDesk moves to Waiting', () => {
    const snap = (over: object) => ({ state: 'open' as const, headSha: 'a', reviewRequested: false, commentCount: 0, ci: 'none' as const, ...over })
    const open = { state: 'CHANGES_REQUESTED', commitId: 'a' }
    const desk = {
      id: 'd', name: 'D', stage: 'to-review', stageOverridden: false, priority: 0, presence: 'active', todoIds: [], createdAt: 0,
      signals: [{ id: 's1', type: 'claude-finished', at: 1, read: false }],
      branches: [],
      reviews: [{ owner: 'o', repo: 'app', number: 7, url: 'u7', snapshot: snap({ reviewRequested: true }) }]
    } as unknown as Parameters<typeof applyChanges>[0]
    const after = applyChanges(desk, new Map([['o/app#7', snap({ myReview: open })]]))
    expect(after.stage).toBe('reviewed-waiting')
    expect(after.signals.map((x) => x.read)).toEqual([true])
    // already waiting: a later Signal of Claude is left alone
    const later = applyChanges({ ...after, signals: [...after.signals, { id: 's2', type: 'claude-finished', at: 2, read: false }] } as typeof after, new Map([['o/app#7', snap({ myReview: open })]]))
    expect(later.signals.map((x) => x.read)).toEqual([true, false])
  })

  it('offers only the pull requests of the repositories in scope when there is a scope (several Profiles)', async () => {
    expect((await sources.candidates(GITHUB_SOURCE_ID)).map((c) => c.id)).toEqual(['o/app#7'])
    const deps = (sources as unknown as { d: { scope?: () => Promise<((id: string) => boolean) | undefined> } }).d
    deps.scope = async () => (id) => id.startsWith('o/elsewhere')
    expect(await sources.candidates(GITHUB_SOURCE_ID)).toEqual([])
    deps.scope = async () => (id) => id.startsWith('o/app')
    expect((await sources.candidates(GITHUB_SOURCE_ID)).map((c) => c.id)).toEqual(['o/app#7'])
    deps.scope = async () => undefined
    expect(await sources.candidates(GITHUB_SOURCE_ID)).toHaveLength(1)
  })

  it('skipping hides a Candidate for good', async () => {
    const [cand] = await sources.candidates(GITHUB_SOURCE_ID)
    await sources.skip(GITHUB_SOURCE_ID, cand.id)
    expect(await sources.candidates(GITHUB_SOURCE_ID)).toEqual([])
  })

  it('polls a parked review too: the author asking again is a Signal, a merge is Done, and the WorkDesk stays parked', async () => {
    await startReview(true)
    const desk = () => service.getState().desks[0]
    pr.reviewRequested = false
    pr.reviews = [{ user: { login: 'me' }, state: 'APPROVED', commit_id: 'abc' }]
    await sources.poll()
    expect(desk().stage).toBe('reviewed-waiting')
    await service.parkDesk(desk().id)

    pr.reviewRequested = true
    pr.comments = 1
    await sources.poll()
    expect(desk().presence).toBe('parked')
    expect(desk().stage).toBe('re-review')
    expect(desk().signals.filter((x) => !x.read).map((x) => x.type)).toEqual(['re-review-requested', 'new-review-comments'])

    pr.state = 'closed'
    pr.merged = true
    await sources.poll()
    expect(desk().presence).toBe('parked')
    expect(desk().stage).toBe('done')
  })

  it('polling follows the review: re-review, comments, CI and merge, and a hand-set Stage wins', async () => {
    await startReview(true)
    const pushed: number[] = []
    service.onStateChanged = (st) => pushed.push(st.desks.length)
    const desk = () => service.getState().desks[0]
    const open = () => desk().signals.filter((x) => !x.read).map((x) => x.type)

    // I reviewed; waiting for the author, CI still running
    pr.reviewRequested = false
    pr.reviews = [{ user: { login: 'me' }, state: 'APPROVED', commit_id: 'abc' }]
    pr.checks = [{ status: 'in_progress' }]
    expect(await sources.poll()).toBe(1)
    expect(desk().stage).toBe('reviewed-waiting')
    expect(open()).toEqual([])

    // author pushes, comments, CI finishes and asks me again
    pr.reviewRequested = true
    pr.comments = 2
    pr.checks = [{ status: 'completed', conclusion: 'success' }]
    await sources.poll()
    expect(desk().stage).toBe('re-review')
    expect(open()).toEqual(['re-review-requested', 'new-review-comments', 'ci-finished'])
    expect(desk().signals[0].branchPath).toBe(desk().branches[0].path)

    // a hand-set Stage overrides, until merged is derived... which is also overridden
    await service.updateDesk(desk().id, (d) => ({ ...d, stage: 'to-review', stageOverridden: true }))
    pr.state = 'closed'
    pr.merged = true
    await sources.poll()
    expect(desk().stage).toBe('to-review')
    expect(desk().reviews![0].snapshot!.state).toBe('merged')
    expect(await sources.poll()).toBe(0)
    expect(pushed.length).toBeGreaterThan(2)
  })

  it('merged without override ends in Done', async () => {
    await startReview(true)
    pr.state = 'closed'
    pr.merged = true
    await sources.poll()
    expect(service.getState().desks[0].stage).toBe('done')
  })
})

describe('a review whose comments were answered', () => {
  const node = (threads: object[], head = 'b') => ({
    number: 1, state: 'OPEN', headRefOid: head,
    reviews: { nodes: [{ state: 'CHANGES_REQUESTED', submittedAt: '2026-01-01T10:00:00Z', author: { login: 'me' }, commit: { oid: 'a' } }] },
    reviewThreads: { nodes: threads }
  })
  const c = (login: string, createdAt: string) => ({ author: { login }, createdAt })
  it('is to be reviewed again when the author replied or resolved all threads of mine, without a re-request', () => {
    expect(toSnapshot(node([{ isResolved: false, comments: { nodes: [c('me', '2026-01-01T10:00:00Z'), c('zoe', '2026-01-02T10:00:00Z')] } }]), 'me').answered).toBe(true)
    expect(toSnapshot(node([{ isResolved: true, comments: { nodes: [c('me', '2026-01-01T10:00:00Z')] } }]), 'me').answered).toBe(true)
  })
  it('is not while a thread of mine is waiting for an answer, or nothing happened', () => {
    const open = { isResolved: false, comments: { nodes: [c('me', '2026-01-01T10:00:00Z')] } }
    expect(toSnapshot(node([open]), 'me').answered).toBe(false)
    expect(toSnapshot(node([open, { isResolved: true, comments: { nodes: [c('me', '2026-01-01T10:00:00Z')] } }]), 'me').answered).toBe(false)
    expect(toSnapshot(node([]), 'me').answered).toBe(false)
  })
})
