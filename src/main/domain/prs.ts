import { stageLabel } from './stage'
import type { Stage, WorkDesk } from './types'

export type ReviewState = 'mine' | 'requested' | 're-review' | 'approved' | 'changes' | 'commented' | 'none'

export interface PrItem {
  /** `owner/repo#number`, also the Todo's external id */
  id: string
  owner: string
  repo: string
  number: number
  title: string
  url: string
  author: string
  draft: boolean
  /** the branch it comes from */
  head?: string
  reviewState: ReviewState
}

/** How a Pull Request of one of a WorkDesk's branches stands. */
export interface BranchPrStatus {
  number: number
  title: string
  url: string
  state: 'open' | 'merged' | 'closed'
  draft: boolean
  /** who opened it */
  author?: string
  /** the branch it merges into */
  base: string
  ci: 'none' | 'pending' | 'success' | 'failure'
  approvals: number
  changesRequested: number
  /** people or teams still asked for a review */
  pending: string[]
  /** GitHub's verdict on merging it, as for a review Todo */
  mergeable: Mergeable
}

/** GitHub's `mergeable_state` of a Pull Request. */
export type Mergeable = 'clean' | 'blocked' | 'dirty' | 'behind' | 'unstable' | 'draft' | 'has_hooks' | 'unknown'

/** The live state of the Pull Request behind a review Todo. */
export interface PrTodoState {
  state: 'open' | 'merged' | 'closed'
  draft: boolean
  ci: 'none' | 'pending' | 'success' | 'failure'
  /** the user's latest verdict */
  myReview?: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'
  approvals: number
  changesRequested: number
  mergeable: Mergeable
  title: string
  url: string
  base: string
  /** the branch the Pull Request comes from */
  head?: string
  fetchedAt: number
}

export type Readiness = 'merged' | 'closed' | 'draft' | 'changes-requested' | 'conflicts' | 'ci-failed' | 'ci-running' | 'behind' | 'needs-review' | 'ready'

/** What decides whether a Pull Request can be merged: the same for a review Todo and for a branch's own. */
export type ReadinessInput = Pick<PrTodoState, 'state' | 'draft' | 'ci' | 'approvals' | 'changesRequested' | 'mergeable'> & Partial<Pick<PrTodoState, 'myReview'>>

/** Where a Pull Request stands on its way to a merge, most pressing problem first. */
export function prReadiness(s: ReadinessInput): Readiness {
  if (s.state === 'merged') return 'merged'
  if (s.state === 'closed') return 'closed'
  if (s.draft) return 'draft'
  if (s.changesRequested > 0) return 'changes-requested'
  if (s.mergeable === 'dirty') return 'conflicts'
  if (s.ci === 'failure') return 'ci-failed'
  if (s.ci === 'pending') return 'ci-running'
  if (s.mergeable === 'behind') return 'behind'
  // nobody approved yet, or GitHub says it is blocked (missing required reviews or checks)
  if (s.approvals === 0 && s.myReview !== 'APPROVED') return 'needs-review'
  if (s.mergeable === 'blocked') return 'needs-review'
  return 'ready'
}

export const READINESS_LABEL: Record<Readiness, string> = {
  merged: 'merged',
  closed: 'closed',
  draft: 'draft',
  'changes-requested': 'changes requested',
  conflicts: 'merge conflicts',
  'ci-failed': 'checks failed',
  'ci-running': 'checks running',
  behind: 'behind its base',
  'needs-review': 'needs a review',
  ready: 'ready to merge'
}

/** Latest verdict of each reviewer counts; comments do not undo an approval, a dismissed review is gone. */
export function reviewVerdicts(reviews: readonly { user?: string; state: string }[]): { approvals: number; changesRequested: number } {
  const verdict = new Map<string, string>()
  for (const r of reviews) {
    if (!r.user) continue
    if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED') verdict.set(r.user, r.state)
    else if (r.state === 'DISMISSED') verdict.delete(r.user)
  }
  const states = [...verdict.values()]
  return { approvals: states.filter((s) => s === 'APPROVED').length, changesRequested: states.filter((s) => s === 'CHANGES_REQUESTED').length }
}

/** Short words for the chips next to a Pull Request. */
export function prStatusLabel(s: BranchPrStatus): string {
  if (s.state === 'merged') return 'merged'
  if (s.state === 'closed') return 'closed'
  return s.draft ? 'draft' : 'open'
}

/** The user's review state of a Pull Request. */
export function deriveReviewState(p: { mine: boolean; requested: boolean; myReview?: string }): ReviewState {
  if (p.mine) return 'mine'
  if (p.myReview && p.requested) return 're-review'
  if (p.requested) return 'requested'
  if (p.myReview === 'APPROVED') return 'approved'
  if (p.myReview === 'CHANGES_REQUESTED') return 'changes'
  if (p.myReview === 'COMMENTED') return 'commented'
  return 'none'
}

/** Reviewed: a review is left and nothing is asked again; own Pull Requests need no review. */
export const isReviewed = (pr: Pick<PrItem, 'reviewState'>): boolean =>
  ['mine', 'approved', 'changes', 'commented'].includes(pr.reviewState)

/** Worth a Todo: not yet reviewed (or asked again) and not a draft. */
export const isCandidate = (pr: Pick<PrItem, 'reviewState' | 'draft'>): boolean => !pr.draft && !isReviewed(pr)

/** Dependency updates such as "chore(deps): update x". */
export const isDepUpdate = (pr: Pick<PrItem, 'title'>): boolean => /chore\(deps[^)]*\)/i.test(pr.title)

/** `owner/repo` of a GitHub clone URL, https or ssh. */
export function repoFromUrl(url: string): string | undefined {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim())
  return m ? `${m[1]}/${m[2]}` : undefined
}

/** The page of a branch on GitHub; slashes in the name stay slashes. */
export const githubBranchUrl = (repo: string, branch: string): string =>
  `https://github.com/${repo}/tree/${branch.split('/').map(encodeURIComponent).join('/')}`

/** Whether a WorkDesk has a Pull request or ticket: it is a work item of one, or it is not started. */
export type PrTodoStatus =
  | { kind: 'none' }
  | { kind: 'desk'; deskId: string; deskName: string; stage: Stage }

/**
 * `own` is the Project of the Pull request's repository and its branch: a WorkDesk that has that branch checked out
 * is working on the Pull request too, though it holds it only through the branch.
 */
export function prTodoStatus(id: string, desks: readonly WorkDesk[], own?: { project?: string; head?: string }): PrTodoStatus {
  const holder =
    desks.find((d) => (d.items ?? []).some((i) => i.id === id)) ??
    (own?.project && own.head ? desks.find((d) => d.branches.some((b) => b.project === own.project && b.branch === own.head)) : undefined)
  return holder ? { kind: 'desk', deskId: holder.id, deskName: holder.name, stage: holder.stage } : { kind: 'none' }
}

export const statusLabel = (s: PrTodoStatus): string => (s.kind === 'none' ? 'not started' : `WorkDesk · ${stageLabel(s.stage)}`)

export type StatusFilter = 'all' | 'none' | 'desk'
export type ReviewFilter = 'all' | 'needs' | 'reviewed' | 'mine'

export interface PrFilter {
  text: string
  showDeps: boolean
  hideReviewed: boolean
  status: StatusFilter
  review: ReviewFilter
  /** hide drafts */
  hideDrafts: boolean
}

export const DEFAULT_PR_FILTER: PrFilter = { text: '', showDeps: false, hideReviewed: false, status: 'all', review: 'all', hideDrafts: false }

export function filterPrs(items: readonly PrItem[], f: PrFilter, statusOf: (pr: PrItem) => PrTodoStatus): PrItem[] {
  const q = f.text.trim().toLowerCase()
  return items.filter((pr) => {
    if (!f.showDeps && isDepUpdate(pr)) return false
    if (f.hideReviewed && isReviewed(pr)) return false
    if (f.hideDrafts && pr.draft) return false
    if (f.review === 'needs' && !(pr.reviewState === 'requested' || pr.reviewState === 're-review')) return false
    if (f.review === 'reviewed' && !isReviewed(pr)) return false
    if (f.review === 'mine' && pr.reviewState !== 'mine') return false
    if (f.status !== 'all') {
      const kind = statusOf(pr).kind
      if (kind !== f.status) return false
    }
    return !q || pr.title.toLowerCase().includes(q) || pr.author.toLowerCase().includes(q) || String(pr.number) === q.replace(/^#/, '')
  })
}
