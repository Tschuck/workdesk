import { describe, expect, it } from 'vitest'
import { arrangeDeskPrs, byDesk, parsePrRef, prPageUrl, prsInDesks } from './desk-prs'
import { isReviewDesk, prAuthors, sectionOf, sidebarOrder } from './order'
import type { WorkDesk } from './types'

const desk = (id: string, over: Partial<WorkDesk> = {}): WorkDesk => ({
  id,
  name: id,
  stage: 'implement',
  stageOverridden: false,
  priority: 0,
  presence: 'inactive',
  todoIds: [],
  branches: [],
  signals: [],
  createdAt: 0,
  ...over
})
const pr = (id: string, role?: 'review' | 'mine') => ({ kind: 'pr' as const, id, title: `PR ${id}`, ...(role ? { role } : {}) })
const review = (owner: string, repo: string, number: number) => ({ owner, repo, number, url: `https://github.com/${owner}/${repo}/pull/${number}` })

describe('the Pull requests section', () => {
  it('has the WorkDesks with pull requests of colleagues and none of yours', () => {
    expect(isReviewDesk(desk('r', { items: [pr('a/b#1', 'review')] }))).toBe(true)
    expect(isReviewDesk(desk('old', { reviews: [review('a', 'b', 2)] }))).toBe(true)
    expect(isReviewDesk(desk('both', { items: [pr('a/b#1', 'review'), pr('a/b#3', 'mine')] }))).toBe(false)
    expect(isReviewDesk(desk('mine', { items: [pr('a/b#3', 'mine')] }))).toBe(false)
    expect(isReviewDesk(desk('plain'))).toBe(false)
  })

  it('takes a pull request without a role that it does not review as yours', () => {
    expect(isReviewDesk(desk('own', { items: [pr('a/b#829')] }))).toBe(false)
    expect(isReviewDesk(desk('old', { items: [pr('a/b#1')], reviews: [review('a', 'b', 1)] }))).toBe(true)
  })

  it('takes them running and waiting alike; planned and postponed stay where they are', () => {
    const items = [pr('a/b#1', 'review')]
    expect(sectionOf(desk('a', { items, stage: 'to-review' }))).toBe('reviews')
    expect(sectionOf(desk('b', { items, stage: 'reviewed-waiting' }))).toBe('reviews')
    expect(sectionOf(desk('c', { items, presence: 'planned' }))).toBe('planned')
    expect(sectionOf(desk('d', { items, postponedUntil: Date.now() + 60_000 }))).toBe('postponed')
    expect(sectionOf(desk('e', { items }), Date.now(), new Set(['e']))).toBe('closable')
    expect(sectionOf(desk('mine', { stage: 'waiting' }))).toBe('waiting')
  })

  it('names who opened the pull requests that are not yours, each once', () => {
    const items = [{ ...pr('a/b#1', 'review'), author: 'alice' }, { ...pr('a/b#2', 'review'), author: 'alice' }, { ...pr('a/b#4', 'review'), author: 'bob' }, { ...pr('a/b#3', 'mine'), author: 'me' }, pr('a/b#5', 'review')]
    expect(prAuthors(desk('r', { items }))).toEqual(['alice', 'bob'])
    expect(prAuthors(desk('own', { items: [{ ...pr('a/b#6'), author: 'me' }] }))).toEqual([])
  })

  it('comes after your own work in the order of the left panel', () => {
    const order = sidebarOrder([desk('r', { items: [pr('a/b#1', 'review')] }), desk('w', { stage: 'waiting' }), desk('l')]).map((o) => o.desk.id)
    expect(order).toEqual(['l', 'w', 'r'])
  })
})

describe('the pull requests in the WorkDesks', () => {
  it('lists the ones to review first, then yours, with their WorkDesk', () => {
    const list = prsInDesks([
      desk('mine', { name: 'Feature', items: [pr('a/b#3', 'mine')] }),
      desk('rev', { name: 'Review', stage: 're-review', items: [pr('a/b#1', 'review')], reviews: [{ ...review('a', 'b', 1), snapshot: { state: 'open', headSha: 'x', reviewRequested: true, commentCount: 0, ci: 'none' } as never }] })
    ])
    expect(list.map((p) => [p.id, p.role, p.deskName, p.stage, p.state])).toEqual([
      ['a/b#1', 'review', 'Review', 'Re-review', 'open'],
      ['a/b#3', 'mine', 'Feature', 'Implement', undefined]
    ])
    expect(list[1].url).toBe('https://github.com/a/b/pull/3')
  })

  it('takes reviews that are no work item, once', () => {
    const list = prsInDesks([desk('old', { items: [pr('a/b#1')], reviews: [review('a', 'b', 1), review('c', 'd', 9)] })])
    expect(list.map((p) => p.id)).toEqual(['a/b#1', 'c/d#9'])
  })
})

describe('opening a pull request', () => {
  it('shows its comment threads as previews', () => {
    expect(prPageUrl('https://github.com/a/b/pull/3')).toBe('https://github.com/a/b/pull/3?comments%3Amode=thread-previews')
    expect(prPageUrl('https://github.com/a/b/pull/3?x=1')).toBe('https://github.com/a/b/pull/3?x=1&comments%3Amode=thread-previews')
    expect(prPageUrl('https://github.com/a/b/pull/3?comments%3Amode=thread-previews')).toBe('https://github.com/a/b/pull/3?comments%3Amode=thread-previews')
  })
})

describe('the pull requests by WorkDesk', () => {
  it('keeps the WorkDesks in the order of the list, each with its pull requests', () => {
    const list = prsInDesks([desk('mine', { name: 'Feature', items: [pr('a/b#3', 'mine')] }), desk('rev', { name: 'Review', items: [pr('a/b#1', 'review'), pr('a/b#2', 'review')] })])
    expect(byDesk(list).map((g) => [g.deskName, g.prs.map((p) => p.id)])).toEqual([
      ['Review', ['a/b#1', 'a/b#2']],
      ['Feature', ['a/b#3']]
    ])
  })
})

describe('ordering and grouping the pull requests', () => {
  const desks = [
    desk('a', { name: 'Alpha', stage: 'reviewed-waiting', createdAt: 3, items: [{ ...pr('a/b#1', 'review'), author: 'zoe' }] }),
    desk('b', { name: 'Beta', stage: 'to-review', createdAt: 1, items: [{ ...pr('a/b#2', 'review'), author: 'adam' }] }),
    desk('c', { name: 'Gamma', stage: 'to-review', createdAt: 2, items: [pr('a/b#3', 'review')] }),
    desk('m', { name: 'Mine', stage: 'waiting', createdAt: 0, items: [pr('a/b#4', 'mine')] })
  ]
  const names = (s: { title?: string; cards: { deskName: string }[] }[]) => s.map((x) => [x.title, x.cards.map((c) => c.deskName)])

  it('by WorkDesk: one list, the ones to review first, in the order asked for', () => {
    const prs = prsInDesks(desks)
    expect(names(arrangeDeskPrs(prs, 'desk', 'name'))).toEqual([[undefined, ['Alpha', 'Beta', 'Gamma', 'Mine']]])
    expect(names(arrangeDeskPrs(prs, 'desk', 'oldest'))).toEqual([[undefined, ['Beta', 'Gamma', 'Alpha', 'Mine']]])
    expect(names(arrangeDeskPrs(prs, 'desk', 'newest'))).toEqual([[undefined, ['Alpha', 'Gamma', 'Beta', 'Mine']]])
    expect(names(arrangeDeskPrs(prs, 'desk', 'author'))).toEqual([[undefined, ['Beta', 'Alpha', 'Gamma', 'Mine']]])
  })

  it('by Stage: To review before Reviewed, waiting, then your own', () => {
    expect(names(arrangeDeskPrs(prsInDesks(desks), 'stage', 'oldest'))).toEqual([
      ['To review', ['Beta', 'Gamma']],
      ['Reviewed, waiting', ['Alpha']],
      ['Waiting', ['Mine']]
    ])
  })
})

describe('a pull request as typed', () => {
  it('is read from its address or owner/repo#n', () => {
    expect(parsePrRef('https://github.com/o/r/pull/7')).toEqual({ id: 'o/r#7', url: 'https://github.com/o/r/pull/7' })
    expect(parsePrRef('https://github.com/o/r/pull/7/files?x=1')).toEqual({ id: 'o/r#7', url: 'https://github.com/o/r/pull/7' })
    expect(parsePrRef(' o/r#8 ')).toEqual({ id: 'o/r#8', url: 'https://github.com/o/r/pull/8' })
    expect(parsePrRef('https://gitlab.com/o/r/pull/7')).toBeUndefined()
    expect(parsePrRef('#7')).toBeUndefined()
  })
})
