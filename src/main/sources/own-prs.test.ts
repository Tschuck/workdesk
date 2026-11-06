import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ownPrNews, ownPrStage } from '../domain/own-pr-news'
import type { PrTodoState } from '../domain/prs'
import type { PrSnapshot } from '../domain/types'
import { WorkDeskService } from '../service'
import { FakeGit } from '../status/fake-git'
import type { WatchedPrState } from './github/api'
import { trackOwnPrs } from './own-prs'

const state = (over: Partial<PrTodoState> = {}): PrTodoState => ({ state: 'open', draft: false, ci: 'none', approvals: 0, changesRequested: 0, mergeable: 'clean', title: 'T', url: 'https://github.com/o/r/pull/1', base: 'main', fetchedAt: 0, ...over })
const read = (s: Partial<PrTodoState>, comments = 0): Map<string, WatchedPrState> => new Map([['o/r#1', { state: state(s), snapshot: { commentCount: comments } as PrSnapshot }]])

describe('what is new on a pull request of your own', () => {
  it('is a request for changes, an approval or comments since it was last looked at', () => {
    const seen = { approvals: 0, changesRequested: 0, commentCount: 2 }
    expect(ownPrNews(seen, state({ changesRequested: 1 }), 2).news).toEqual([{ type: 'review-received', message: 'Changes requested' }])
    expect(ownPrNews(seen, state({ approvals: 2 }), 5).news).toEqual([{ type: 'review-received', message: 'Approved (2)' }, { type: 'new-review-comments', message: '3 new comments' }])
    expect(ownPrNews(seen, state(), 2).news).toEqual([])
    // it went down (a review dismissed, a comment deleted): nothing to tell, but it is noted
    expect(ownPrNews({ approvals: 1, changesRequested: 1, commentCount: 4 }, state(), 3)).toEqual({ seen: { approvals: 0, changesRequested: 0, commentCount: 3 }, news: [] })
  })
  it('tells where it stands on the first look, in one line, the most pressing first', () => {
    expect(ownPrNews(undefined, state({ approvals: 1 }), 4)).toEqual({ seen: { approvals: 1, changesRequested: 0, commentCount: 4 }, news: [{ type: 'review-received', message: 'Approved' }] })
    expect(ownPrNews(undefined, state({ changesRequested: 1, approvals: 1 }), 0).news).toEqual([{ type: 'review-received', message: 'Changes requested' }])
    expect(ownPrNews(undefined, state(), 2).news).toEqual([{ type: 'new-review-comments', message: '2 comments' }])
    expect(ownPrNews(undefined, state(), 0).news).toEqual([])
  })
  it('says nothing about a merged or closed pull request', () => {
    expect(ownPrNews({ approvals: 0, changesRequested: 0, commentCount: 0 }, state({ state: 'merged', approvals: 1 }), 3).news).toEqual([])
  })
})

describe('telling a WorkDesk about it', () => {
  let tmp: string
  let service: WorkDeskService
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'workdesk-own-'))
    service = new WorkDeskService(join(tmp, 'root'), new FakeGit())
    await service.load()
    const own = { kind: 'pr' as const, id: 'o/r#1', title: 'My change', url: 'https://github.com/o/r/pull/1' }
    const theirs = { kind: 'pr' as const, id: 'o/r#2', title: 'Theirs', role: 'review' as const }
    await service.registerItemsDesk({ id: 'd', name: 'D', stage: 'implement', stageOverridden: false, presence: 'parked', todoIds: [], items: [own, theirs], branches: [], signals: [], createdAt: 0 }, [])
  })
  afterEach(async () => {
    service.status.autoCommit.dispose()
    await rm(tmp, { recursive: true, force: true })
  })
  const targets = [{ id: 'o/r#1', deskId: 'd', title: 'My change' }]
  const desk = () => service.getState().desks[0]

  it('raises a Signal on a parked WorkDesk once, and keeps what was seen with the item', async () => {
    const told: string[] = []
    // the first look: where it stands, once
    await trackOwnPrs(service, read({ approvals: 1 }, 1), targets, (_p, n) => void told.push(n.message))
    expect(desk().signals.map((s) => s.message)).toEqual(['#1 Approved'])
    expect(desk().items![0].seen).toEqual({ approvals: 1, changesRequested: 0, commentCount: 1 })
    // somebody asks for changes and comments
    await trackOwnPrs(service, read({ approvals: 1, changesRequested: 1 }, 3), targets, (_p, n) => void told.push(n.message))
    expect(desk().signals.map((s) => [s.type, s.message])).toEqual([['review-received', '#1 Approved'], ['review-received', '#1 Changes requested'], ['new-review-comments', '#1 2 new comments']])
    expect(told).toEqual(['Approved', 'Changes requested', '2 new comments'])
    // the same again: nothing new
    await trackOwnPrs(service, read({ approvals: 1, changesRequested: 1 }, 3), targets)
    expect(desk().signals).toHaveLength(3)
    // what was seen is kept, so a restart does not tell it again
    expect(desk().items![0].seen).toEqual({ approvals: 1, changesRequested: 1, commentCount: 3 })
    expect(desk().presence).toBe('parked')
  })

  it('moves a WorkDesk between Implement and Waiting with its pull requests, unless the Stage was set by hand or it reviews pull requests', async () => {
    // open, nobody asked for changes, not approved yet: it waits
    await trackOwnPrs(service, read({}, 0), targets)
    expect(desk().stage).toBe('waiting')
    expect(desk().stageOverridden).toBe(false)
    // approved: merging it is up to you
    await trackOwnPrs(service, read({ approvals: 1 }, 0), targets)
    expect(desk().stage).toBe('implement')
    // changes requested: the work is yours again
    await trackOwnPrs(service, read({ approvals: 1, changesRequested: 1 }, 0), targets)
    expect(desk().stage).toBe('implement')
    // a draft says nothing
    await trackOwnPrs(service, read({ draft: true }, 0), targets)
    expect(desk().stage).toBe('implement')
    // everything merged and no Todo open: done
    await trackOwnPrs(service, read({ state: 'merged' }), targets)
    expect(desk().stage).toBe('done')
    // by hand: it stays
    await service.updateDesk('d', (d) => ({ ...d, stage: 'testing', stageOverridden: true }))
    await trackOwnPrs(service, read({ approvals: 1 }, 0), targets)
    expect(desk().stage).toBe('testing')
    // a WorkDesk that reviews pull requests has its Stage from those
    await service.updateDesk('d', (d) => ({ ...d, stage: 'to-review', stageOverridden: false, reviews: [{ owner: 'o', repo: 'r', number: 2, url: 'u' }] }))
    await trackOwnPrs(service, read({ approvals: 1 }, 0), targets)
    expect(desk().stage).toBe('to-review')
  })

  it('keeps what it knew of a pull request that was not read this round', async () => {
    await trackOwnPrs(service, read({ approvals: 1 }, 0), targets)
    expect(desk().stage).toBe('implement')
    // GitHub did not answer for it: it still counts as approved, the Stage does not flip
    await trackOwnPrs(service, new Map(), targets)
    expect(desk().stage).toBe('implement')
  })

  it('does not call a WorkDesk done while a Todo of it is open', async () => {
    await service.updateDesk('d', (d) => ({ ...d, todoIds: ['t1'] }))
    ;(service as unknown as { todos: unknown[] }).todos = [{ id: 't1', title: 'T', resolved: false, list: 'today' }]
    await trackOwnPrs(service, read({ state: 'merged' }), targets)
    expect(desk().stage).toBe('implement')
  })

  it('takes somebody else\'s pull request as one to review: it gets the role and the WorkDesk follows the review', async () => {
    const snapshot = { state: 'open', headSha: 'a', reviewRequested: false, commentCount: 0, ci: 'none' } as PrSnapshot
    const theirs = new Map<string, WatchedPrState>([['o/r#1', { state: state({ approvals: 1 }), snapshot, mine: false }]])
    await trackOwnPrs(service, theirs, targets)
    expect(desk().items![0].role).toBe('review')
    expect(desk().reviews).toEqual([{ owner: 'o', repo: 'r', number: 1, url: 'https://github.com/o/r/pull/1', snapshot }])
    // not reviewed by me yet
    expect(desk().stage).toBe('to-review')
    // and nothing is told of it as of a pull request of your own
    expect(desk().signals).toEqual([])
  })

  it('leaves the pull requests it reviews for somebody else to the review logic', async () => {
    await trackOwnPrs(service, new Map([['o/r#2', { state: state({ changesRequested: 1 }), snapshot: { commentCount: 9 } as PrSnapshot }]]), [{ id: 'o/r#2', deskId: 'd', title: 'Theirs' }])
    expect(desk().signals).toEqual([])
    expect(desk().items![1].seen).toBeUndefined()
  })
})

describe('the Stage from the pull requests of your own', () => {
  it('is Implement with changes requested, Waiting when open ones are not questioned, nothing for drafts and finished ones', () => {
    const pr = (over: object) => ({ state: 'open' as const, draft: false, changesRequested: 0, approvals: 0, ci: 'none' as const, mergeable: 'clean' as const, ...over })
    expect(ownPrStage([pr({})])).toBe('waiting')
    expect(ownPrStage([pr({}), pr({ changesRequested: 1 })])).toBe('implement')
    expect(ownPrStage([pr({ draft: true })])).toBe('implement')
    expect(ownPrStage([pr({ state: 'merged' }), pr({ state: 'closed' })])).toBeUndefined()
    expect(ownPrStage([pr({ state: 'merged' }), pr({})])).toBe('waiting')
    // changes were asked for, and everybody who asked is asked again: the ball is back with them
    expect(ownPrStage([pr({ changesRequested: 1, changesBy: ['sebb'], requested: ['sebb'] })])).toBe('waiting')
    expect(ownPrStage([pr({ changesRequested: 2, changesBy: ['sebb', 'zoe'], requested: ['sebb'] })])).toBe('implement')
    expect(ownPrStage([pr({ changesRequested: 1, changesBy: ['sebb'], requested: [] })])).toBe('implement')
    // approved, nothing asked of you: merging is up to you, also while a sibling is still open
    expect(ownPrStage([pr({ approvals: 1 })])).toBe('implement')
    expect(ownPrStage([pr({ approvals: 1 }), pr({})])).toBe('implement')
    expect(ownPrStage([pr({ approvals: 1, draft: true })])).toBe('implement')
    // approved but GitHub still blocks it (a second review is required), or its checks run: it waits
    expect(ownPrStage([pr({ approvals: 1, mergeable: 'blocked' })])).toBe('waiting')
    expect(ownPrStage([pr({ approvals: 1, ci: 'pending' })])).toBe('waiting')
    // what only you can fix is yours, approved or not
    expect(ownPrStage([pr({ mergeable: 'dirty' })])).toBe('implement')
    expect(ownPrStage([pr({ ci: 'failure' })])).toBe('implement')
    expect(ownPrStage([pr({ mergeable: 'behind' })])).toBe('implement')
    expect(ownPrStage([pr({ ci: 'pending' })])).toBe('waiting')
    expect(ownPrStage([])).toBeUndefined()
  })
})
