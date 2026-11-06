import { describe, expect, it } from 'vitest'
import { describeDeskChange, describeSignal, describeTodoChanges } from './events'
import type { Todo, WorkDesk } from './types'

const desk: WorkDesk = {
  id: 'd', name: 'Login', stage: 'to-review', stageOverridden: false, priority: 0, presence: 'inactive',
  todoIds: [], branches: [], signals: [], createdAt: 1,
  reviews: [{ owner: 'o', repo: 'r', number: 5, url: 'u', snapshot: { state: 'open', headSha: 'a', reviewRequested: false, commentCount: 1, ci: 'pending' } }]
}

describe('describeDeskChange', () => {
  it('says nothing when nothing changed', () => {
    expect(describeDeskChange(desk, { ...desk })).toEqual([])
  })
  it('names Stage, name, parking and branch changes', () => {
    const next: WorkDesk = {
      ...desk, name: 'Login fix', stage: 'waiting', stageOverridden: true, presence: 'parked',
      branches: [{ project: 'api', branch: 'a', index: 1, path: '/x', base: 'main' }]
    }
    expect(describeDeskChange(desk, next).map((e) => e.text)).toEqual([
      'Renamed to "Login fix"',
      'Stage: To review → Waiting (set by hand)',
      'Parked: terminals and editor shut down',
      'Branch added: api · a (on top of main)'
    ])
    const back = describeDeskChange(next, { ...next, presence: 'inactive', branches: [] }).map((e) => e.text)
    expect(back).toEqual(['Reactivated', 'Branch removed: api · a'])
  })
  it('does not log going from inactive to active', () => {
    expect(describeDeskChange(desk, { ...desk, presence: 'active' })).toEqual([])
  })
  it('says which pull request when several are reviewed', () => {
    const one = desk.reviews![0]
    const two = { ...one, number: 6, snapshot: { ...one.snapshot!, ci: 'pending' as const } }
    const before = { ...desk, reviews: [one, two] }
    const after = { ...before, reviews: [one, { ...two, snapshot: { ...two.snapshot, ci: 'failure' as const } }] }
    expect(describeDeskChange(before, after).map((e) => e.text)).toEqual(['Checks (#6): pending → failure'])
  })
  it('follows the pull request of a review', () => {
    const snap = desk.reviews![0].snapshot!
    const next = { ...desk, reviews: [{ ...desk.reviews![0], snapshot: { ...snap, ci: 'success' as const, commentCount: 4, reviewRequested: true, headSha: 'b', state: 'merged' as const } }] }
    expect(describeDeskChange(desk, next).map((e) => e.text)).toEqual([
      'Pull request merged', 'Checks: pending → success', 'Review requested again', '3 new comment(s)', 'New commits pushed'
    ])
  })
})

describe('describeSignal / describeTodoChanges', () => {
  it('writes a Signal as a line', () => {
    expect(describeSignal({ type: 'claude-finished' })).toEqual({ type: 'signal', text: 'Claude finished' })
    expect(describeSignal({ type: 'ci-finished', message: 'failed' }).text).toBe('CI finished: failed')
  })
  it('logs Todos added to the WorkDesk and resolved or reopened in it, and no others', () => {
    const t = (id: string, deskId: string | undefined, resolved = false): Todo => ({ id, title: id.toUpperCase(), topics: [], list: 'today', resolved, deskId, createdAt: 1 })
    const prev = [t('a', 'd'), t('b', undefined), t('c', 'other')]
    const next = [t('a', 'd', true), t('b', 'd'), t('c', 'other', true), t('e', 'd')]
    expect(describeTodoChanges('d', prev, next).map((e) => e.text)).toEqual(['Todo resolved: A', 'Todo added: B', 'Todo added: E'])
  })
})
