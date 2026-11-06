import { describe, expect, it } from 'vitest'
import { GithubApi } from './github/api'

describe('state of the Pull Request behind a review Todo', () => {
  const route = (over: { pr?: object; reviews?: object[]; checks?: object[] } = {}) =>
    new GithubApi(async (p) => {
      if (p === '/repos/o/r/pulls/7') {
        return { title: 'Fix login', html_url: 'https://github.com/o/r/pull/7', state: 'open', merged: false, draft: false, mergeable_state: 'clean', base: { ref: 'main' }, head: { sha: 'abc' }, ...over.pr }
      }
      if (p.includes('/reviews')) return over.reviews ?? []
      if (p.includes('/check-runs')) return { check_runs: over.checks ?? [] }
      throw new Error('unexpected ' + p)
    })

  it('reads my approval, the other verdicts and the checks', async () => {
    const api = route({
      reviews: [
        { user: { login: 'me' }, state: 'COMMENTED' }, { user: { login: 'me' }, state: 'APPROVED' }, { user: { login: 'me' }, state: 'COMMENTED' },
        { user: { login: 'zoe' }, state: 'APPROVED' }, { user: { login: 'bob' }, state: 'CHANGES_REQUESTED' }
      ],
      checks: [{ status: 'completed', conclusion: 'success' }, { status: 'in_progress' }]
    })
    expect(await api.prTodoState('o', 'r', 7, 'me', 5)).toEqual({
      state: 'open', draft: false, ci: 'pending', myReview: 'APPROVED', approvals: 2, changesRequested: 1, mergeable: 'clean',
      title: 'Fix login', url: 'https://github.com/o/r/pull/7', base: 'main', fetchedAt: 5
    })
  })

  it('knows merged, closed, draft and an unknown mergeable state', async () => {
    expect((await route({ pr: { merged: true, state: 'closed' } }).prTodoState('o', 'r', 7, 'me', 1)).state).toBe('merged')
    expect((await route({ pr: { state: 'closed' } }).prTodoState('o', 'r', 7, 'me', 1)).state).toBe('closed')
    const d = await route({ pr: { draft: true, mergeable_state: null } }).prTodoState('o', 'r', 7, 'me', 1)
    expect(d).toMatchObject({ draft: true, mergeable: 'unknown', myReview: undefined, approvals: 0, ci: 'none' })
  })
})
