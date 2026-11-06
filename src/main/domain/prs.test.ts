import { describe, expect, it } from 'vitest'
import { DEFAULT_PR_FILTER, deriveReviewState, filterPrs, isCandidate, prTodoStatus, repoFromUrl, statusLabel, type PrItem, type PrTodoStatus } from './prs'
import type { WorkDesk } from './types'

const pr = (n: number, over: Partial<PrItem> = {}): PrItem => ({
  id: `o/r#${n}`, owner: 'o', repo: 'r', number: n, title: `PR ${n}`, url: `u${n}`, author: 'dev', draft: false, reviewState: 'none', ...over
})
const desk = { id: 'd1', name: 'Desk', stage: 're-review' } as WorkDesk

describe('review state', () => {
  it('is derived from authorship, requests and the latest review', () => {
    expect(deriveReviewState({ mine: true, requested: true })).toBe('mine')
    expect(deriveReviewState({ mine: false, requested: true })).toBe('requested')
    expect(deriveReviewState({ mine: false, requested: true, myReview: 'APPROVED' })).toBe('re-review')
    expect(deriveReviewState({ mine: false, requested: false, myReview: 'APPROVED' })).toBe('approved')
    expect(deriveReviewState({ mine: false, requested: false, myReview: 'CHANGES_REQUESTED' })).toBe('changes')
    expect(deriveReviewState({ mine: false, requested: false, myReview: 'COMMENTED' })).toBe('commented')
    expect(deriveReviewState({ mine: false, requested: false })).toBe('none')
  })

  it('only unreviewed, non-draft Pull Requests are candidates', () => {
    expect(isCandidate(pr(1))).toBe(true)
    expect(isCandidate(pr(1, { draft: true }))).toBe(false)
    expect(isCandidate(pr(1, { reviewState: 'approved' }))).toBe(false)
    expect(isCandidate(pr(1, { reviewState: 're-review' }))).toBe(true)
  })

  it('reads owner/repo from clone URLs', () => {
    expect(repoFromUrl('git@github.com:acme/acme-api.git')).toBe('acme/acme-api')
    expect(repoFromUrl('https://github.com/acme/acme-api')).toBe('acme/acme-api')
    expect(repoFromUrl('https://gitlab.com/a/b.git')).toBeUndefined()
  })
})

describe('status from WorkDesks', () => {
  it('follows the WorkDesk that has the item', () => {
    expect(prTodoStatus('o/r#1', [])).toEqual({ kind: 'none' })
    const s = prTodoStatus('o/r#1', [{ ...desk, items: [{ kind: 'pr', id: 'o/r#1', title: 't' }] }])
    expect(s).toEqual({ kind: 'desk', deskId: 'd1', deskName: 'Desk', stage: 're-review' })
    expect(statusLabel(s)).toBe('WorkDesk · Re-review')
    expect(statusLabel({ kind: 'none' })).toBe('not started')
    // a WorkDesk that has the branch checked out is on the pull request too
    const withBranch = { ...desk, branches: [{ project: 'backend', branch: 'feat-x', path: '/p', index: 1 }] } as WorkDesk
    expect(prTodoStatus('o/r#2', [withBranch], { project: 'backend', head: 'feat-x' })).toMatchObject({ kind: 'desk', deskId: 'd1' })
    expect(prTodoStatus('o/r#2', [withBranch], { project: 'other', head: 'feat-x' })).toEqual({ kind: 'none' })
    expect(prTodoStatus('o/r#2', [withBranch], { project: 'backend', head: 'other' })).toEqual({ kind: 'none' })
    expect(prTodoStatus('o/r#2', [withBranch])).toEqual({ kind: 'none' })
  })
})

describe('filters', () => {
  const items = [
    pr(1, { reviewState: 'requested' }),
    pr(2, { reviewState: 'approved' }),
    pr(3, { title: 'chore(deps): bump x' }),
    pr(4, { reviewState: 'mine', author: 'me' }),
    pr(5, { draft: true, author: 'Zoe' })
  ]
  const inDesk: PrTodoStatus = { kind: 'desk', deskId: 'd', deskName: 'D', stage: 'implement' }
  const statuses: Record<string, PrTodoStatus> = { 'o/r#1': inDesk, 'o/r#2': inDesk }
  const statusOf = (p: PrItem): PrTodoStatus => statuses[p.id] ?? { kind: 'none' }
  const ids = (f: Partial<typeof DEFAULT_PR_FILTER>) => filterPrs(items, { ...DEFAULT_PR_FILTER, ...f }, statusOf).map((p) => p.number)

  it('hides dependency updates by default and by choice shows them', () => {
    expect(ids({})).toEqual([1, 2, 4, 5])
    expect(ids({ showDeps: true })).toEqual([1, 2, 3, 4, 5])
  })
  it('filters by text, review and whether a WorkDesk has it', () => {
    expect(ids({ text: 'zoe' })).toEqual([5])
    expect(ids({ text: '#2' })).toEqual([2])
    expect(ids({ hideReviewed: true })).toEqual([1, 5])
    expect(ids({ hideDrafts: true })).toEqual([1, 2, 4])
    expect(ids({ review: 'needs' })).toEqual([1])
    expect(ids({ review: 'reviewed' })).toEqual([2, 4])
    expect(ids({ review: 'mine' })).toEqual([4])
    expect(ids({ status: 'desk' })).toEqual([1, 2])
    expect(ids({ status: 'none' })).toEqual([4, 5])
  })
})

import { githubBranchUrl } from './prs'
describe('branch links', () => {
  it('links to the branch on GitHub, keeping slashes and escaping the rest', () => {
    expect(githubBranchUrl('o/app', 'main')).toBe('https://github.com/o/app/tree/main')
    expect(githubBranchUrl('o/app', 'feature/login-fix')).toBe('https://github.com/o/app/tree/feature/login-fix')
    expect(githubBranchUrl('o/app', 'fix #12 & more')).toBe('https://github.com/o/app/tree/fix%20%2312%20%26%20more')
  })
})

import { prReadiness, type PrTodoState } from './prs'
describe('readiness of a Pull Request', () => {
  const pr = (over: Partial<PrTodoState> = {}): PrTodoState => ({
    state: 'open', draft: false, ci: 'success', approvals: 1, changesRequested: 0, mergeable: 'clean', title: 't', url: 'u', base: 'main', fetchedAt: 0, ...over
  })

  it('is ready once it is approved, the checks are done and nothing blocks it', () => {
    expect(prReadiness(pr())).toBe('ready')
    expect(prReadiness(pr({ ci: 'none' }))).toBe('ready')
    // approved by me and nobody else counted yet
    expect(prReadiness(pr({ approvals: 0, myReview: 'APPROVED' }))).toBe('ready')
  })

  it('shows what is in the way, most pressing first', () => {
    expect(prReadiness(pr({ ci: 'pending' }))).toBe('ci-running')
    expect(prReadiness(pr({ ci: 'failure' }))).toBe('ci-failed')
    expect(prReadiness(pr({ changesRequested: 1, ci: 'pending' }))).toBe('changes-requested')
    expect(prReadiness(pr({ mergeable: 'dirty', ci: 'failure' }))).toBe('conflicts')
    expect(prReadiness(pr({ mergeable: 'behind' }))).toBe('behind')
    expect(prReadiness(pr({ approvals: 0 }))).toBe('needs-review')
    expect(prReadiness(pr({ mergeable: 'blocked' }))).toBe('needs-review')
    expect(prReadiness(pr({ draft: true }))).toBe('draft')
    expect(prReadiness(pr({ state: 'merged' }))).toBe('merged')
    expect(prReadiness(pr({ state: 'closed', draft: true }))).toBe('closed')
    // unknown while GitHub is still working it out is not a reason to wait
    expect(prReadiness(pr({ mergeable: 'unknown' }))).toBe('ready')
  })
})
