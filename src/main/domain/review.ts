import type { PrSnapshot, ReviewInfo, SignalType, Stage } from './types'

/** Review Stage worked out from the Pull Request; a hand-set Stage still overrides it. */
export function deriveReviewStage(pr: PrSnapshot): Stage {
  if (pr.state !== 'open') return 'done'
  if (!pr.myReview) return 'to-review'
  if (pr.reviewRequested || pr.answered) return 're-review'
  return 'reviewed-waiting'
}

/**
 * The Stage of a WorkDesk that reviews several pull requests: what needs you most wins. A pull request to review again, then one to review
 * for the first time; all reviewed is waiting, and only when every one is merged or closed it is done. No pull request: nothing to say.
 */
export function deriveDeskStage(reviews: readonly ReviewInfo[]): Stage | undefined {
  if (reviews.length === 0) return undefined
  const stages = reviews.map((r) => (r.snapshot ? deriveReviewStage(r.snapshot) : 'to-review'))
  if (stages.includes('re-review')) return 're-review'
  if (stages.includes('to-review')) return 'to-review'
  return stages.every((s) => s === 'done') ? 'done' : 'reviewed-waiting'
}

export interface PrChange {
  stage: Stage
  signals: SignalType[]
}

/** What changed since the last poll. The first snapshot raises nothing. */
export function diffPr(prev: PrSnapshot | undefined, next: PrSnapshot): PrChange {
  const stage = deriveReviewStage(next)
  const signals: SignalType[] = []
  if (prev && next.state === 'open') {
    if (deriveReviewStage(prev) !== 're-review' && stage === 're-review') signals.push('re-review-requested')
    if (next.commentCount > prev.commentCount) signals.push('new-review-comments')
    if (prev.ci === 'pending' && (next.ci === 'success' || next.ci === 'failure')) signals.push('ci-finished')
  }
  return { stage, signals }
}
