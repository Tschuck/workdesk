import { describe, expect, it } from 'vitest'
import { unifyDesk } from './migrate-unify'
import { deriveDeskStage } from './review'
import type { PrSnapshot, ReviewInfo } from './types'

const snap = (over: Partial<PrSnapshot> = {}): PrSnapshot => ({ state: 'open', headSha: 'a', reviewRequested: false, commentCount: 0, ci: 'none', ...over })
const pr = (n: number, snapshot?: PrSnapshot): ReviewInfo => ({ owner: 'o', repo: 'r', number: n, url: `u${n}`, snapshot })

describe('older WorkDesk files', () => {
  it('lose their type, and the one pull request becomes a list', () => {
    const old = { id: 'a', kind: 'review', stage: 'to-review', review: pr(7), branches: [{ project: 'p', branch: 'b', path: '/x', index: 1 }] }
    expect(unifyDesk(old)).toEqual({ id: 'a', stage: 'to-review', reviews: [pr(7)], branches: [{ project: 'p', branch: 'b', path: '/x', index: 1, pr: 'o/r#7' }] })
  })
  it('lose the type of the others too, and are left alone when there is nothing to do', () => {
    expect(unifyDesk({ id: 'b', kind: 'plain', stage: 'implement' })).toEqual({ id: 'b', stage: 'implement' })
    const done = { id: 'c', stage: 'implement' }
    expect(unifyDesk(done)).toBe(done)
  })
})

describe('the Stage of several pull requests', () => {
  it('is worked out from the one that needs you most', () => {
    expect(deriveDeskStage([])).toBeUndefined()
    expect(deriveDeskStage([pr(1, snap({ myReview: { state: 'APPROVED', commitId: 'a' } })), pr(2)])).toBe('to-review')
    expect(deriveDeskStage([pr(1, snap({ myReview: { state: 'COMMENTED', commitId: 'a' }, reviewRequested: true })), pr(2)])).toBe('re-review')
    expect(deriveDeskStage([pr(1, snap({ myReview: { state: 'APPROVED', commitId: 'a' } })), pr(2, snap({ state: 'merged' }))])).toBe('reviewed-waiting')
    expect(deriveDeskStage([pr(1, snap({ state: 'closed' })), pr(2, snap({ state: 'merged' }))])).toBe('done')
  })
})
