import { prReadiness, type PrTodoState } from './prs'
import type { DeskItem, SignalType, WorkDesk } from './types'

/** What was known of a pull request the last time it was looked at, kept with its work item. */
export type PrSeen = NonNullable<DeskItem['seen']>

export interface PrNews {
  type: Extract<SignalType, 'review-received' | 'new-review-comments'>
  message: string
}

/**
 * What happened on a pull request of your own since it was last looked at: somebody asked for changes, approved it, or commented.
 * The first look of a pull request (a WorkDesk from before this was watched) tells where it stands once, in one line, so a review that
 * came while nothing looked is not missed; after that only what changed is news.
 */
export function ownPrNews(seen: PrSeen | undefined, state: Pick<PrTodoState, 'state' | 'approvals' | 'changesRequested'>, commentCount: number): { seen: PrSeen; news: PrNews[] } {
  const next: PrSeen = { approvals: state.approvals, changesRequested: state.changesRequested, commentCount }
  if (state.state !== 'open') return { seen: next, news: [] }
  const news: PrNews[] = []
  if (!seen) {
    if (state.changesRequested > 0) news.push({ type: 'review-received', message: 'Changes requested' })
    else if (state.approvals > 0) news.push({ type: 'review-received', message: state.approvals > 1 ? `Approved (${state.approvals})` : 'Approved' })
    else if (commentCount > 0) news.push({ type: 'new-review-comments', message: `${commentCount} comment${commentCount === 1 ? '' : 's'}` })
    return { seen: next, news }
  }
  if (state.changesRequested > seen.changesRequested) news.push({ type: 'review-received', message: 'Changes requested' })
  if (state.approvals > seen.approvals) news.push({ type: 'review-received', message: state.approvals > 1 ? `Approved (${state.approvals})` : 'Approved' })
  if (commentCount > seen.commentCount) news.push({ type: 'new-review-comments', message: `${commentCount - seen.commentCount} new comment${commentCount - seen.commentCount === 1 ? '' : 's'}` })
  return { seen: next, news }
}

/**
 * Where a WorkDesk stands because of its own pull requests: the work is yours (Implement) when one of them has changes requested that are
 * not answered yet, or can only move by you: merge conflicts, failed checks, behind its base, or ready to merge. Open pull requests
 * that wait for a review or for running checks (also an approved one that GitHub still blocks) mean it waits.
 * A draft is still being worked on, so it is Implement until it is marked ready for review; merged and closed ones say nothing.
 */
export function ownPrStage(prs: readonly (Pick<PrTodoState, 'state' | 'draft' | 'changesRequested' | 'approvals' | 'ci' | 'mergeable'> & { changesBy?: string[]; requested?: string[] })[]): 'implement' | 'waiting' | undefined {
  const open = prs.filter((p) => p.state === 'open')
  if (open.length === 0) return undefined
  // not ready for review yet: the work goes on
  if (open.some((p) => p.draft)) return 'implement'
  const onYou = (p: (typeof open)[number]): boolean => {
    if (p.changesRequested > 0) {
      // changes were asked for and not answered yet: it is on you. Once everybody who asked is asked to review again, the ball is back with them.
      const asked = p.changesBy ?? []
      return !(asked.length > 0 && asked.every((who) => (p.requested ?? []).includes(who)))
    }
    return (['conflicts', 'ci-failed', 'behind', 'ready'] as const).some((r) => r === prReadiness(p))
  }
  return open.some(onYou) ? 'implement' : 'waiting'
}

/** Every pull request of its own is merged or closed (and there is at least one): nothing is left to wait for. */
export const ownPrsFinished = (prs: readonly Pick<PrTodoState, 'state'>[]): boolean => prs.length > 0 && prs.every((p) => p.state !== 'open')

/** The pull requests of a WorkDesk that are its own business (work items), not the ones it reviews for somebody else. */
export const ownPrItems = (desk: WorkDesk): DeskItem[] => {
  const reviewed = new Set((desk.reviews ?? []).map((r) => `${r.owner}/${r.repo}#${r.number}`))
  return (desk.items ?? []).filter((i) => i.kind === 'pr' && i.role !== 'review' && !reviewed.has(i.id))
}
