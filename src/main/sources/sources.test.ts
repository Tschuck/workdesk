import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deriveReviewStage, diffPr } from '../domain/review'
import type { PrSnapshot } from '../domain/types'
import { MemorySecrets } from '../secrets'
import { ciState, GithubApi, parsePrId, prId } from './github/api'
import { GITHUB_TOKEN_KEY, resolveTransport, tokenTransport } from './github/transport'
import { SourceStore } from './store'

const snap = (over: Partial<PrSnapshot> = {}): PrSnapshot => ({
  state: 'open', headSha: 'a', reviewRequested: true, commentCount: 0, ci: 'none', ...over
})

describe('Review Stage', () => {
  it('is derived from the Pull Request', () => {
    expect(deriveReviewStage(snap())).toBe('to-review')
    expect(deriveReviewStage(snap({ reviewRequested: false, myReview: { state: 'APPROVED', commitId: 'a' } }))).toBe('reviewed-waiting')
    expect(deriveReviewStage(snap({ reviewRequested: true, myReview: { state: 'COMMENTED', commitId: 'a' } }))).toBe('re-review')
    expect(deriveReviewStage(snap({ state: 'merged' }))).toBe('done')
    expect(deriveReviewStage(snap({ state: 'closed' }))).toBe('done')
  })

  it('raises Signals for re-review, new comments and finished CI, but not on the first poll', () => {
    const reviewed = snap({ reviewRequested: false, myReview: { state: 'APPROVED', commitId: 'a' }, ci: 'pending' })
    expect(diffPr(undefined, reviewed).signals).toEqual([])
    const next = snap({ reviewRequested: true, myReview: { state: 'APPROVED', commitId: 'a' }, commentCount: 2, ci: 'success' })
    expect(diffPr(reviewed, next)).toEqual({ stage: 're-review', signals: ['re-review-requested', 'new-review-comments', 'ci-finished'] })
    expect(diffPr(next, next).signals).toEqual([])
    expect(diffPr(reviewed, snap({ state: 'merged' }))).toEqual({ stage: 'done', signals: [] })
  })
})

describe('GitHub API', () => {
  const me = 'me'
  const routes: Record<string, unknown> = {
    '/user': { login: me },
    '/repos/o/r/pulls/7': {
      title: 'Fix', html_url: 'https://github.com/o/r/pull/7', state: 'open', merged: false,
      head: { ref: 'fix-it', sha: 'abc', repo: { full_name: 'o/r' } },
      base: { repo: { full_name: 'o/r', clone_url: 'https://github.com/o/r.git' } },
      requested_reviewers: [{ login: me }]
    },
    '/repos/o/r/pulls/7/reviews?per_page=100': [
      { user: { login: me }, state: 'COMMENTED', commit_id: 'old' },
      { user: { login: 'x' }, state: 'APPROVED', commit_id: 'old' },
      { user: { login: me }, state: 'APPROVED', commit_id: 'abc' },
      { user: { login: me }, state: 'PENDING', commit_id: 'abc' }
    ],
    '/repos/o/r/pulls/7/comments?per_page=100': [{ user: { login: 'x' } }, { user: { login: me } }],
    '/repos/o/r/issues/7/comments?per_page=100': [{ user: { login: 'y' } }],
    '/repos/o/r/commits/abc/check-runs?per_page=100': { check_runs: [{ status: 'completed', conclusion: 'success' }, { status: 'in_progress' }] }
  }
  const api = new GithubApi(async (p) => {
    if (p.startsWith('/search/issues')) {
      return { items: [{ number: 7, title: 'Fix', html_url: 'u', repository_url: 'https://api.github.com/repos/o/r', user: { login: 'dev' } }] }
    }
    if (!(p in routes)) throw new Error('unexpected ' + p)
    return routes[p]
  })

  it('lists review requests as Candidates', async () => {
    expect(await api.reviewRequested()).toEqual([{ id: 'o/r#7', title: 'Fix', url: 'u', subtitle: 'o/r · dev', author: 'dev', name: 'Fix', dependencyUpdate: false, draft: false }])
  })

  it('builds a snapshot from reviews, comments and checks', async () => {
    expect(await api.snapshot('o', 'r', 7, me)).toEqual({
      state: 'open', headSha: 'abc', reviewRequested: true,
      myReview: { state: 'APPROVED', commitId: 'abc' }, commentCount: 2, ci: 'pending'
    })
    expect(await api.prInfo('o', 'r', 7)).toMatchObject({ headRef: 'fix-it', fromFork: false, cloneUrl: 'https://github.com/o/r.git' })
  })

  it('maps CI and ids', () => {
    expect(ciState([])).toBe('none')
    expect(ciState([{ status: 'completed', conclusion: 'failure' }])).toBe('failure')
    expect(ciState([{ status: 'completed', conclusion: 'skipped' }])).toBe('success')
    expect(parsePrId(prId('a', 'b-c', 12))).toEqual({ owner: 'a', repo: 'b-c', number: 12 })
    expect(() => parsePrId('nope')).toThrow()
  })
})

describe('GitHub auth', () => {
  it('prefers a Keychain token, then gh, else none', async () => {
    const secrets = new MemorySecrets()
    expect((await resolveTransport(secrets, async () => false)).auth).toEqual({ kind: 'none' })
    expect((await resolveTransport(secrets, async () => true)).auth).toEqual({ kind: 'gh' })
    await secrets.set(GITHUB_TOKEN_KEY, 't0ken')
    expect((await resolveTransport(secrets, async () => true)).auth).toEqual({ kind: 'token' })
  })

  it('sends the token as a bearer header', async () => {
    let seen: { url: string; auth?: string } | undefined
    const fake = (async (url: string, init: { headers: Record<string, string> }) => {
      seen = { url, auth: init.headers.Authorization }
      return { ok: true, json: async () => ({ ok: 1 }) }
    }) as unknown as typeof fetch
    expect(await tokenTransport('abc', fake)('/user')).toEqual({ ok: 1 })
    expect(seen).toEqual({ url: 'https://api.github.com/user', auth: 'Bearer abc' })
    const bad = (async () => ({ ok: false, status: 401 })) as unknown as typeof fetch
    await expect(tokenTransport('abc', bad)('/user?x=1')).rejects.toThrow('GitHub 401 for /user')
  })
})

describe('SourceStore', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'workdesk-src-')) })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('hides tracked and skipped Candidates', async () => {
    const store = new SourceStore(dir)
    const cands = ['a', 'b', 'c'].map((id) => ({ id, title: id, url: id }))
    await store.markTracked('github-prs', 'a')
    await store.markTracked('github-prs', 'a')
    await store.markSkipped('github-prs', 'b')
    expect((await store.open('github-prs', cands)).map((c) => c.id)).toEqual(['c'])
    expect(await store.tracked('github-prs')).toEqual(['a'])
    expect(await store.config('github-prs', { x: 1 })).toEqual({ x: 1 })
    await store.setConfig('github-prs', { y: 2 })
    expect(await store.config('github-prs', {})).toEqual({ y: 2 })
  })
})

import { matchesRepo } from './github/api'
describe('repo matching', () => {
  it('matches https and ssh clone URLs, not look-alikes', () => {
    expect(matchesRepo('git@github.com:acme/acme-api.git', 'acme', 'acme-api')).toBe(true)
    expect(matchesRepo('https://github.com/Acme/acme-api.git/', 'acme', 'acme-api')).toBe(true)
    expect(matchesRepo('https://github.com/acme/acme-api-2.git', 'acme', 'acme-api')).toBe(false)
    expect(matchesRepo('https://github.com/other/acme-api.git', 'acme', 'acme-api')).toBe(false)
  })
})

describe('review requests as Candidates', () => {
  it('mark dependency updates and drafts like the Pull Request page', async () => {
    const item = (number: number, title: string, draft = false) => ({ number, title, draft, html_url: 'u', repository_url: 'https://api.github.com/repos/o/r', user: { login: 'bot' } })
    const api = new GithubApi(async () => ({ items: [item(1, 'chore(deps): bump x'), item(2, 'chore(deps-dev): update y'), item(3, 'Add feature', true), item(4, 'Add feature')] }))
    expect((await api.reviewRequested()).map((c) => [c.id, c.dependencyUpdate, c.draft])).toEqual([
      ['o/r#1', true, false], ['o/r#2', true, false], ['o/r#3', false, true], ['o/r#4', false, false]
    ])
  })
})
