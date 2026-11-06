import { describe, expect, it } from 'vitest'
import { prReadiness } from '../../domain/prs'
import { GithubApi, needingWork, toBranchPr, toOpenPr, toSnapshot } from './api'
import { ghFailure, tokenGraphql, unwrap } from './transport'

const node = (over: Record<string, unknown> = {}) => ({
  number: 7, title: 'Fix it', url: 'https://github.com/o/app/pull/7', isDraft: false, state: 'OPEN', merged: false,
  headRefName: 'fix-it', baseRefName: 'main', mergeStateStatus: 'CLEAN', repository: { nameWithOwner: 'o/app' }, author: { login: 'me' },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
  latestOpinionatedReviews: { nodes: [] },
  ...over
})

describe('Pull requests read through GraphQL', () => {
  it('turns a node into the state the readiness rule uses', () => {
    const p = toOpenPr(node({ latestOpinionatedReviews: { nodes: [{ state: 'APPROVED', author: { login: 'zoe' } }, { state: 'CHANGES_REQUESTED', author: { login: 'me' } }] } }), 'me', 5)
    expect(p).toMatchObject({ id: 'o/app#7', repo: 'o/app', head: 'fix-it' })
    expect(p.state).toMatchObject({ state: 'open', draft: false, ci: 'success', approvals: 1, changesRequested: 1, myReview: 'CHANGES_REQUESTED', mergeable: 'clean', base: 'main', fetchedAt: 5 })
    expect(prReadiness(p.state)).toBe('changes-requested')
  })

  it('maps checks, merge states and the lifecycle', () => {
    const state = (over: Record<string, unknown>) => toOpenPr(node(over), 'me', 0).state
    expect(state({ commits: { nodes: [] } }).ci).toBe('none')
    expect(state({ commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } }).ci).toBe('failure')
    expect(state({ commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] } }).ci).toBe('pending')
    expect(state({ mergeStateStatus: 'DIRTY' }).mergeable).toBe('dirty')
    expect(state({ mergeStateStatus: 'HAS_HOOKS' }).mergeable).toBe('has_hooks')
    expect(state({ state: 'MERGED', merged: true }).state).toBe('merged')
    expect(state({ state: 'CLOSED' }).state).toBe('closed')
    expect(prReadiness(state({ latestOpinionatedReviews: { nodes: [{ state: 'APPROVED', author: { login: 'zoe' } }] } }))).toBe('ready')
  })

  it('lists the own Pull Requests that need work with the reason, and not drafts', () => {
    const prs = [
      toOpenPr(node({ number: 1, mergeStateStatus: 'DIRTY' }), 'me', 0),
      toOpenPr(node({ number: 2, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } }), 'me', 0),
      toOpenPr(node({ number: 3, latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: { login: 'zoe' } }] } }), 'me', 0),
      toOpenPr(node({ number: 4 }), 'me', 0),
      toOpenPr(node({ number: 5, isDraft: true, mergeStateStatus: 'DIRTY' }), 'me', 0)
    ]
    expect(needingWork(prs).map((c) => [c.id, c.hint, c.branch])).toEqual([
      ['o/app#1', 'merge conflicts', 'fix-it'],
      ['o/app#2', 'checks failed', 'fix-it'],
      ['o/app#3', 'changes requested', 'fix-it']
    ])
  })

  it('asks once for the whole list, and once per Pull Request detail', async () => {
    const queries: string[] = []
    const api = new GithubApi(async () => ({}), async (q, v) => {
      queries.push(q.includes('search(') ? 'list' : 'one')
      return q.includes('search(') ? { search: { nodes: [node({ number: 1 }), node({ number: 2 }), {}] } } : { repository: { pullRequest: node({ number: v?.n === 9 ? 9 : 1 }) } }
    })
    expect((await api.myOpenPrs('me', 0)).map((p) => p.id)).toEqual(['o/app#1', 'o/app#2'])
    expect((await api.prDetails('o', 'app', 9, 'me', 0)).state).toBe('open')
    expect(queries).toEqual(['list', 'one'])
  })

  it('needs GraphQL for the list, and reads a single Pull Request over REST without it', async () => {
    const rest = new GithubApi(async (p) => {
      if (/\/pulls\/\d+$/.test(p)) return { state: 'open', merged: false, title: 'T', html_url: 'u', base: { ref: 'main' }, head: { sha: 's', ref: 'h' }, mergeable_state: 'clean' }
      if (p.includes('/reviews')) return []
      return { check_runs: [] }
    })
    await expect(rest.myOpenPrs('me', 0)).rejects.toThrow(/GraphQL/)
    expect((await rest.prDetails('o', 'app', 3, 'me', 0)).title).toBe('T')
  })
})

describe('many pull requests in one request', () => {
  const watched = (over: Record<string, unknown> = {}) => node({
    headRefOid: 'sha1', reviewRequests: { nodes: [{ requestedReviewer: { login: 'me' } }, { requestedReviewer: {} }] },
    reviews: { nodes: [{ state: 'COMMENTED', author: { login: 'me' }, commit: { oid: 'old' } }, { state: 'PENDING', author: { login: 'me' }, commit: { oid: 'x' } }, { state: 'APPROVED', author: { login: 'me' }, commit: { oid: 'sha0' } }] },
    comments: { nodes: [{ author: { login: 'me' } }, { author: { login: 'zoe' } }] },
    reviewThreads: { nodes: [{ comments: { nodes: [{ author: { login: 'zoe' } }, { author: { login: 'me' } }] } }] },
    ...over
  })

  it('reads what a review reacts to: who is asked, my last review, the comments of others', () => {
    expect(toSnapshot(watched(), 'me')).toEqual({ state: 'open', headSha: 'sha1', reviewRequested: true, answered: false, myReview: { state: 'APPROVED', commitId: 'sha0' }, commentCount: 2, ci: 'success', changesBy: [], requested: ['me'] })
    expect(toSnapshot(watched({ reviewRequests: { nodes: [] }, reviews: { nodes: [] } }), 'me')).toMatchObject({ reviewRequested: false, myReview: undefined, requested: [] })
    // who asked for changes, and who is asked again (a person or a team)
    const asked = watched({ latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: { login: 'sebb' } }, { state: 'APPROVED', author: { login: 'zoe' } }] }, reviewRequests: { nodes: [{ requestedReviewer: { login: 'sebb' } }, { requestedReviewer: { name: 'OID' } }] } })
    expect(toSnapshot(asked, 'me')).toMatchObject({ changesBy: ['sebb'], requested: ['sebb', 'OID'] })
  })

  it('asks for all of them with an alias each, twenty to a request, and leaves out one that cannot be read', async () => {
    const queries: string[] = []
    const api = new GithubApi(async () => ({}), async (q) => {
      queries.push(q)
      const aliases = [...q.matchAll(/a(\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\) \{ pullRequest\(number: (\d+)\)/g)]
      return Object.fromEntries(aliases.map((m) => [`a${m[1]}`, { pullRequest: m[4] === '13' ? null : watched({ number: Number(m[4]) }) }]))
    })
    const ids = Array.from({ length: 45 }, (_, i) => `o/app#${i + 1}`)
    const read = await api.prBatch(ids, 'me', 0)
    expect(queries).toHaveLength(3)
    expect(queries[0]).toContain('a0: repository(owner: "o", name: "app") { pullRequest(number: 1)')
    expect(read.size).toBe(44)
    expect(read.has('o/app#13')).toBe(false)
    expect(read.get('o/app#45')?.snapshot.headSha).toBe('sha1')
  })

  it('refuses an owner or repository that could change the query', async () => {
    const api = new GithubApi(async () => ({}), async () => ({}))
    await expect(api.prBatch(['o"x/app#1'], 'me', 0)).rejects.toThrow(/usable/)
  })
})

describe('lists of a repository and of branches through GraphQL', () => {
  const listed = (n: number, over: Record<string, unknown> = {}) => ({
    number: n, title: `PR ${n}`, url: `u${n}`, isDraft: false, headRefName: `b${n}`, author: { login: 'dev' },
    reviewRequests: { nodes: [] }, reviews: { nodes: [] }, ...over
  })

  it('lists the open pull requests of a repository with the review state, in one request', async () => {
    let asked = 0
    const api = new GithubApi(async () => ({}), async () => {
      asked++
      return {
        repository: {
          pullRequests: {
            nodes: [
              listed(1, { reviewRequests: { nodes: [{ requestedReviewer: { login: 'me' } }] } }),
              listed(2, { reviews: { nodes: [{ state: 'APPROVED', author: { login: 'me' } }] } }),
              listed(3, { reviews: { nodes: [{ state: 'COMMENTED', author: { login: 'me' } }, { state: 'DISMISSED', author: { login: 'me' } }] } }),
              listed(4, { author: { login: 'me' } }),
              listed(5, { reviews: { nodes: [{ state: 'APPROVED', author: { login: 'me' } }] }, reviewRequests: { nodes: [{ requestedReviewer: { login: 'me' } }] }, isDraft: true })
            ]
          }
        }
      }
    })
    const prs = await api.openPrs('o', 'app', 'me')
    expect(asked).toBe(1)
    expect(prs.map((p) => [p.id, p.reviewState, p.draft, p.head])).toEqual([
      ['o/app#1', 'requested', false, 'b1'],
      ['o/app#2', 'approved', false, 'b2'],
      ['o/app#3', 'commented', false, 'b3'],
      ['o/app#4', 'mine', false, 'b4'],
      ['o/app#5', 're-review', true, 'b5']
    ])
  })

  it('maps a branch pull request node', () => {
    const n = {
      number: 4, title: 'T', url: 'u', state: 'OPEN', merged: false, isDraft: false, baseRefName: 'main', mergeStateStatus: 'BLOCKED',
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] },
      latestOpinionatedReviews: { nodes: [{ state: 'APPROVED' }, { state: 'CHANGES_REQUESTED' }, { state: 'APPROVED' }] },
      reviewRequests: { nodes: [{ requestedReviewer: { login: 'zoe' } }, { requestedReviewer: { name: 'core' } }, { requestedReviewer: null }] }
    }
    expect(toBranchPr(n)).toEqual({ number: 4, title: 'T', url: 'u', state: 'open', draft: false, base: 'main', ci: 'failure', approvals: 2, changesRequested: 1, pending: ['zoe', 'core'], mergeable: 'blocked' })
    expect(toBranchPr({ ...n, state: 'MERGED', merged: true }).state).toBe('merged')
    expect(toBranchPr({ ...n, state: 'CLOSED' }).state).toBe('closed')
  })

  it('asks for the pull requests of many branches at once, with the names safely quoted', async () => {
    const queries: string[] = []
    const api = new GithubApi(async () => ({}), async (q) => {
      queries.push(q)
      return { a0: { pullRequests: { nodes: [{ number: 1, title: 'A', url: 'u', state: 'OPEN' }] } }, a1: { pullRequests: { nodes: [] } } }
    })
    const lists = await api.branchPrsBatch([{ owner: 'o', repo: 'app', branch: 'feat/"quoted"' }, { owner: 'o', repo: 'web', branch: 'x' }])
    expect(queries).toHaveLength(1)
    expect(queries[0]).toContain('headRefName: "feat/\\"quoted\\""')
    expect(lists.map((l) => l.map((p) => p.number))).toEqual([[1], []])
    expect(await api.branchPrsBatch([])).toEqual([])
  })
})

describe('GraphQL transports', () => {
  it('reports a failed gh call in gh\'s words, not as the whole command line', () => {
    const long = Object.assign(new Error('Command failed: gh api graphql -f query=query { a very long query }'), { stderr: 'some noise\ngh: Variable $n of type Int! was provided invalid value\n' })
    expect(ghFailure(long, 'graphql').message).toBe('GitHub (graphql): Variable $n of type Int! was provided invalid value')
    expect(ghFailure(new Error('spawn gh ENOENT\nmore'), '/user').message).toBe('GitHub (/user): spawn gh ENOENT')
  })

  it('returns the data, and fails with the messages when there is none', () => {
    expect(unwrap({ data: { a: 1 } })).toEqual({ a: 1 })
    expect(() => unwrap({ errors: [{ message: 'bad' }, { message: 'worse' }] })).toThrow(/bad; worse/)
    expect(() => unwrap({})).toThrow(/no data/)
  })

  it('posts the query with the token', async () => {
    let seen: { url: string; init: RequestInit } | undefined
    const run = tokenGraphql('tok', (async (url: string, init: RequestInit) => {
      seen = { url, init }
      return { ok: true, status: 200, json: async () => ({ data: { x: 1 } }) } as Response
    }) as unknown as typeof fetch)
    expect(await run('query { x }', { q: 'v' })).toEqual({ x: 1 })
    expect(seen?.url).toBe('https://api.github.com/graphql')
    expect(seen?.init.method).toBe('POST')
    expect((seen?.init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    expect(JSON.parse(seen!.init.body as string)).toEqual({ query: 'query { x }', variables: { q: 'v' } })
  })
})
