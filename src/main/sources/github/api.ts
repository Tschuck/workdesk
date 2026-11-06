import { deriveReviewState, isDepUpdate, prReadiness, READINESS_LABEL, reviewVerdicts, type BranchPrStatus, type Mergeable, type PrItem, type PrTodoState } from '../../domain/prs'
import type { CiState, PrSnapshot } from '../../domain/types'
import type { Candidate } from '../source'

/** GET a GitHub REST path and return the parsed JSON. */
export type Transport = (path: string) => Promise<unknown>

/** Run a GraphQL query; the result is its `data`. A variable is text or a number (an Int). */
export type Graphql = (query: string, variables?: Record<string, string | number>) => Promise<unknown>

export interface PrInfo {
  owner: string
  repo: string
  number: number
  title: string
  url: string
  headRef: string
  /** the PR comes from a fork, so its branch is not in the base repo */
  fromFork: boolean
  cloneUrl: string
}

interface Obj { [k: string]: any }

export const prId = (owner: string, repo: string, number: number): string => `${owner}/${repo}#${number}`

/** Does a clone URL (https or ssh form) point at owner/repo? */
export function matchesRepo(url: string, owner: string, repo: string): boolean {
  const clean = url.replace(/\/+$/, '').replace(/\.git$/, '').toLowerCase()
  const tail = `${owner}/${repo}`.toLowerCase()
  return clean.endsWith('/' + tail) || clean.endsWith(':' + tail)
}

export function parsePrId(id: string): { owner: string; repo: string; number: number } {
  const m = /^([^/]+)\/([^#]+)#(\d+)$/.exec(id)
  if (!m) throw new Error(`Not a Pull Request id: ${id}`)
  return { owner: m[1], repo: m[2], number: Number(m[3]) }
}

export function ciState(checkRuns: Obj[]): CiState {
  if (checkRuns.length === 0) return 'none'
  if (checkRuns.some((c) => c.status !== 'completed')) return 'pending'
  const bad = ['failure', 'timed_out', 'cancelled', 'action_required']
  return checkRuns.some((c) => bad.includes(c.conclusion)) ? 'failure' : 'success'
}

const PR_FIELDS = `number title url isDraft state merged headRefName baseRefName mergeStateStatus
  repository { nameWithOwner } author { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  latestOpinionatedReviews(first: 30) { nodes { state author { login } } }`

/** What the background poll reads of a Pull Request on top of its state: who is asked, the user's reviews, the comments. */
const WATCH_FIELDS = `${PR_FIELDS}
  headRefOid
  reviewRequests(first: 30) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
  reviews(last: 50) { nodes { state submittedAt author { login } commit { oid } } }
  comments(first: 100) { nodes { author { login __typename } } }
  reviewThreads(first: 50) { nodes { isResolved comments(first: 20) { nodes { createdAt author { login __typename } } } } }`

/** A watched Pull Request: where it stands for the readiness rule, and the parts a review reacts to. */
export interface WatchedPrState {
  state: PrTodoState
  snapshot: PrSnapshot
  /** the Pull Request is the user's own (they opened it); unknown when GitHub did not say */
  mine?: boolean
}

/** What the list of a branch's Pull Requests shows: state, checks, reviews, who is asked. */
const BRANCH_PR_FIELDS = `number title url state merged isDraft baseRefName mergeStateStatus author { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  latestOpinionatedReviews(first: 30) { nodes { state } }
  reviewRequests(first: 30) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }`

/** One GraphQL node as a Pull Request of a branch. */
export function toBranchPr(n: Obj): BranchPrStatus {
  const reviews = (n.latestOpinionatedReviews?.nodes ?? []) as Obj[]
  const rollup = n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state as string | undefined
  return {
    number: n.number,
    title: n.title,
    url: n.url,
    state: n.merged ? 'merged' : n.state === 'CLOSED' ? 'closed' : 'open',
    draft: !!n.isDraft,
    author: n.author?.login,
    base: n.baseRefName ?? '',
    ci: rollup ? (CI[rollup] ?? 'pending') : 'none',
    approvals: reviews.filter((r) => r.state === 'APPROVED').length,
    changesRequested: reviews.filter((r) => r.state === 'CHANGES_REQUESTED').length,
    pending: ((n.reviewRequests?.nodes ?? []) as Obj[]).map((r) => r.requestedReviewer?.login ?? r.requestedReviewer?.name).filter((x): x is string => !!x),
    mergeable: String(n.mergeStateStatus ?? 'unknown').toLowerCase() as Mergeable
  }
}

/** A Pull Request of the user's with its state, as one GraphQL node tells it. */
export interface OpenPr {
  id: string
  title: string
  url: string
  /** owner/name */
  repo: string
  head: string
  state: PrTodoState
}

const CI: Record<string, CiState> = { SUCCESS: 'success', FAILURE: 'failure', ERROR: 'failure', PENDING: 'pending', EXPECTED: 'pending' }

/** One GraphQL Pull Request node as the state the readiness rule works on. */
export function toOpenPr(n: Obj, me: string, now: number): OpenPr {
  const reviews = ((n.latestOpinionatedReviews?.nodes ?? []) as Obj[]).filter((r) => ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state))
  const mine = reviews.find((r) => r.author?.login === me)
  const rollup = n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state as string | undefined
  const [owner, name] = String(n.repository?.nameWithOwner ?? '/').split('/')
  return {
    id: prId(owner, name, n.number),
    title: n.title,
    url: n.url,
    repo: n.repository?.nameWithOwner,
    head: n.headRefName,
    state: {
      state: n.merged ? 'merged' : n.state === 'CLOSED' ? 'closed' : 'open',
      draft: !!n.isDraft,
      ci: rollup ? (CI[rollup] ?? 'pending') : 'none',
      myReview: mine?.state === 'APPROVED' || mine?.state === 'CHANGES_REQUESTED' ? mine.state : undefined,
      approvals: reviews.filter((r) => r.state === 'APPROVED').length,
      changesRequested: reviews.filter((r) => r.state === 'CHANGES_REQUESTED').length,
      // GitHub's own words (CLEAN, DIRTY, BEHIND, BLOCKED, UNSTABLE, DRAFT, HAS_HOOKS, UNKNOWN) are the REST `mergeable_state`
      mergeable: String(n.mergeStateStatus ?? 'unknown').toLowerCase() as Mergeable,
      title: n.title,
      url: n.url,
      base: n.baseRefName ?? '',
      head: n.headRefName,
      fetchedAt: now
    }
  }
}

/**
 * Most authors never click "re-request review", so it is told from the threads: after the user's review, every thread they started is
 * resolved or the last word is somebody else's, and the author did something (a reply, or new commits). Approved is done, not open.
 */
function answeredSince(n: Obj, me: string, last: Obj | undefined): boolean {
  if (!last || last.state === 'APPROVED' || !last.submittedAt) return false
  const mine = ((n.reviewThreads?.nodes ?? []) as Obj[]).filter((t) => (t.comments?.nodes?.[0] as Obj | undefined)?.author?.login === me)
  const lastWord = (t: Obj): Obj | undefined => (t.comments?.nodes ?? []).at(-1)
  const open = mine.filter((t) => !t.isResolved)
  if (open.some((t) => lastWord(t)?.author?.login === me)) return false
  const replied = mine.some((t) => ((t.comments?.nodes ?? []) as Obj[]).some((c) => c.author?.login !== me && c.createdAt > last.submittedAt))
  const moved = !!n.headRefOid && !!last.commit?.oid && n.headRefOid !== last.commit.oid
  return mine.length > 0 && (replied || (moved && open.length === 0))
}

/** The parts of a Pull Request a review reacts to (who is asked, my review, comments by others), from a GraphQL node. */
export function toSnapshot(n: Obj, me: string): PrSnapshot {
  const state = toOpenPr(n, me, 0).state
  const mine = ((n.reviews?.nodes ?? []) as Obj[]).filter((r) => r.author?.login === me && r.state !== 'PENDING')
  const last = mine[mine.length - 1]
  // comments of other people, not of bots (CI, coverage): those are no news
  const others = (c: Obj) => c.author?.login !== me && c.author?.__typename !== 'Bot'
  const inline = ((n.reviewThreads?.nodes ?? []) as Obj[]).flatMap((t) => (t.comments?.nodes ?? []) as Obj[])
  return {
    state: state.state,
    headSha: n.headRefOid ?? '',
    answered: answeredSince(n, me, last),
    reviewRequested: ((n.reviewRequests?.nodes ?? []) as Obj[]).some((r) => r.requestedReviewer?.login === me),
    myReview: last ? { state: last.state, commitId: last.commit?.oid ?? '' } : undefined,
    commentCount: inline.filter(others).length + ((n.comments?.nodes ?? []) as Obj[]).filter(others).length,
    ci: state.ci,
    changesBy: ((n.latestOpinionatedReviews?.nodes ?? []) as Obj[]).filter((r) => r.state === 'CHANGES_REQUESTED').map((r) => String(r.author?.login ?? '')),
    requested: ((n.reviewRequests?.nodes ?? []) as Obj[]).map((r) => String(r.requestedReviewer?.login ?? r.requestedReviewer?.name ?? '')).filter(Boolean)
  }
}

/** The own Pull Requests that need work: changes requested, failing checks or conflicts; drafts are left alone. */
export function needingWork(prs: readonly OpenPr[]): Candidate[] {
  const out: Candidate[] = []
  for (const p of prs) {
    if (p.state.draft) continue
    const readiness = prReadiness(p.state)
    if (readiness !== 'changes-requested' && readiness !== 'conflicts' && readiness !== 'ci-failed') continue
    out.push({ id: p.id, title: p.title, name: p.title, url: p.url, subtitle: p.repo, hint: READINESS_LABEL[readiness], branch: p.head })
  }
  return out
}

/** Thin wrapper over the REST endpoints the tool needs. */
export class GithubApi {
  constructor(
    private readonly get: Transport,
    private readonly graphql?: Graphql
  ) {}

  async me(): Promise<string> {
    return ((await this.get('/user')) as Obj).login
  }

  /** Is there a branch of this name on GitHub? (Read through the API: no SSH login needed, and no stale local note of it.) */
  async branchExists(owner: string, repo: string, branch: string): Promise<boolean> {
    try {
      await this.get(`/repos/${owner}/${repo}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`)
      return true
    } catch (err) {
      if (/\b404\b|not found/i.test((err as Error).message)) return false
      throw err
    }
  }

  /** open Pull Requests where the user is asked for a review */
  async reviewRequested(): Promise<Candidate[]> {
    const res = (await this.get('/search/issues?q=' + encodeURIComponent('is:pr is:open review-requested:@me archived:false') + '&per_page=50')) as Obj
    return (res.items as Obj[]).map((i) => {
      const [owner, repo] = new URL(i.repository_url).pathname.split('/').slice(-2)
      return {
        id: prId(owner, repo, i.number),
        title: i.title,
        name: i.title,
        url: i.html_url,
        subtitle: `${owner}/${repo} · ${i.user?.login ?? '?'}`,
        dependencyUpdate: isDepUpdate({ title: i.title }),
        draft: !!i.draft
      }
    })
  }

  /**
   * The user's own open Pull Requests with everything the readiness rule needs (reviews, checks, mergeability), in one
   * GraphQL request. Replaces a request per Pull Request and per kind of fact.
   */
  async myOpenPrs(me: string, now: number): Promise<OpenPr[]> {
    if (!this.graphql) throw new Error('GraphQL is not available for this login')
    const data = (await this.graphql(`query($q: String!) { search(query: $q, type: ISSUE, first: 50) { nodes { ... on PullRequest { ${PR_FIELDS} } } } }`, {
      q: 'is:pr is:open author:@me archived:false'
    })) as Obj
    return (data.search.nodes as Obj[]).filter((n) => n?.number).map((n) => toOpenPr(n, me, now))
  }

  /** One Pull Request as the readiness rule sees it, in one GraphQL request (REST needs three). */
  async prDetails(owner: string, repo: string, number: number, me: string, now: number): Promise<PrTodoState> {
    if (!this.graphql) return this.prTodoState(owner, repo, number, me, now)
    const data = (await this.graphql(`query($o: String!, $r: String!, $n: Int!) { repository(owner: $o, name: $r) { pullRequest(number: $n) { ${PR_FIELDS} } } }`, {
      o: owner,
      r: repo,
      n: number
    })) as Obj
    const node = data.repository?.pullRequest
    if (!node) throw new Error(`Pull Request ${owner}/${repo}#${number} not found`)
    return toOpenPr(node, me, now).state
  }

  /**
   * Many Pull Requests at once: one GraphQL request with an alias per Pull Request (twenty to a request), instead of
   * four REST requests for each. A Pull Request that cannot be read (gone, no access) is left out of the answer.
   */
  async prBatch(ids: readonly string[], me: string, now: number): Promise<Map<string, WatchedPrState>> {
    if (!this.graphql) throw new Error('GraphQL is not available for this login')
    const out = new Map<string, WatchedPrState>()
    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20)
      const parts = chunk.map((id, k) => {
        const { owner, repo, number } = parsePrId(id)
        if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) throw new Error(`Not a usable Pull Request id: ${id}`)
        return `a${k}: repository(owner: "${owner}", name: "${repo}") { pullRequest(number: ${number}) { ...W } }`
      })
      const data = (await this.graphql(`query { ${parts.join('\n')} } fragment W on PullRequest { ${WATCH_FIELDS} }`)) as Obj
      chunk.forEach((id, k) => {
        const node = data[`a${k}`]?.pullRequest
        if (node) out.set(id, { state: toOpenPr(node, me, now).state, snapshot: toSnapshot(node, me), ...(node.author?.login ? { mine: node.author.login === me } : {}) })
      })
    }
    return out
  }

  /** the user's own open Pull Requests that need work: changes requested, failing checks or conflicts */
  async myPrsNeedingWork(me: string, now: number): Promise<Candidate[]> {
    return needingWork(await this.myOpenPrs(me, now))
  }

  /** True when GraphQL can be used, which reads many Pull Requests in one request. */
  get hasGraphql(): boolean {
    return !!this.graphql
  }

  /** The open Pull Requests of a repository with the user's review state: one request, where REST needs one per Pull Request. */
  private async openPrsGraphql(owner: string, repo: string, me: string): Promise<PrItem[]> {
    const data = (await this.graphql!(
      `query($o: String!, $r: String!) { repository(owner: $o, name: $r) { pullRequests(states: OPEN, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes {
        number title url isDraft headRefName author { login }
        reviewRequests(first: 30) { nodes { requestedReviewer { ... on User { login } } } }
        reviews(last: 50) { nodes { state author { login } } }
      } } } }`,
      { o: owner, r: repo }
    )) as Obj
    return ((data.repository?.pullRequests?.nodes ?? []) as Obj[]).map((p): PrItem => {
      const mine = p.author?.login === me
      const own = ((p.reviews?.nodes ?? []) as Obj[]).filter((r) => r.author?.login === me && r.state !== 'PENDING' && r.state !== 'DISMISSED')
      return {
        id: prId(owner, repo, p.number),
        owner,
        repo,
        number: p.number,
        title: p.title,
        url: p.url,
        author: p.author?.login ?? '?',
        draft: !!p.isDraft,
        head: p.headRefName,
        reviewState: deriveReviewState({
          mine,
          requested: ((p.reviewRequests?.nodes ?? []) as Obj[]).some((r) => r.requestedReviewer?.login === me),
          myReview: mine ? undefined : own[own.length - 1]?.state
        })
      }
    })
  }

  /**
   * The Pull Requests of several branches (of any repositories) in ONE request: an alias per branch, up to three
   * Pull Requests each, newest first. One list per branch asked, in the order asked.
   */
  async branchPrsBatch(branches: readonly { owner: string; repo: string; branch: string }[]): Promise<BranchPrStatus[][]> {
    if (!this.graphql) throw new Error('GraphQL is not available for this login')
    if (branches.length === 0) return []
    const q = (v: string) => JSON.stringify(v)
    const aliases = branches.map((b, i) => `a${i}: repository(owner: ${q(b.owner)}, name: ${q(b.repo)}) { pullRequests(headRefName: ${q(b.branch)}, states: [OPEN, MERGED, CLOSED], first: 3, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { ...B } } }`)
    const data = (await this.graphql(`query { ${aliases.join('\n')} } fragment B on PullRequest { ${BRANCH_PR_FIELDS} }`)) as Obj
    return branches.map((_, i) => ((data[`a${i}`]?.pullRequests?.nodes ?? []) as Obj[]).map(toBranchPr))
  }

  /** Open Pull Requests of a repository with the user's review state. */
  async openPrs(owner: string, repo: string, me: string): Promise<PrItem[]> {
    if (this.graphql) return this.openPrsGraphql(owner, repo, me)
    const pulls = (await this.get(`/repos/${owner}/${repo}/pulls?state=open&per_page=100&sort=updated&direction=desc`)) as Obj[]
    const items: PrItem[] = new Array(pulls.length)
    let next = 0
    // reviews need one request per Pull Request; a few at a time
    const worker = async () => {
      for (let i = next++; i < pulls.length; i = next++) {
        const p = pulls[i]
        const mine = p.user?.login === me
        let myReview: string | undefined
        if (!mine) {
          const reviews = (await this.get(`/repos/${owner}/${repo}/pulls/${p.number}/reviews?per_page=100`)) as Obj[]
          const own = reviews.filter((r) => r.user?.login === me && r.state !== 'PENDING' && r.state !== 'DISMISSED')
          myReview = own[own.length - 1]?.state
        }
        items[i] = {
          id: prId(owner, repo, p.number),
          owner,
          repo,
          number: p.number,
          title: p.title,
          url: p.html_url,
          author: p.user?.login ?? '?',
          draft: !!p.draft,
          head: p.head?.ref,
          reviewState: deriveReviewState({ mine, requested: ((p.requested_reviewers ?? []) as Obj[]).some((r) => r.login === me), myReview })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(5, pulls.length) }, worker))
    return items
  }

  /** The Pull Requests whose head is `branch` of this repository (newest first, at most three). */
  async branchPrs(owner: string, repo: string, branch: string): Promise<BranchPrStatus[]> {
    const head = encodeURIComponent(`${owner}:${branch}`)
    const pulls = (await this.get(`/repos/${owner}/${repo}/pulls?head=${head}&state=all&per_page=5&sort=updated&direction=desc`)) as Obj[]
    return Promise.all(
      pulls.slice(0, 3).map(async (p): Promise<BranchPrStatus> => {
        // the list has no merge state: the single Pull Request does
        const [detail, reviews, checks] = (await Promise.all([
          this.get(`/repos/${owner}/${repo}/pulls/${p.number}`),
          this.get(`/repos/${owner}/${repo}/pulls/${p.number}/reviews?per_page=100`),
          this.get(`/repos/${owner}/${repo}/commits/${p.head.sha}/check-runs?per_page=100`)
        ])) as [Obj, Obj[], Obj]
        return {
          mergeable: (detail.mergeable_state ?? 'unknown') as Mergeable,
          number: p.number,
          title: p.title,
          url: p.html_url,
          state: p.merged_at ? 'merged' : p.state === 'closed' ? 'closed' : 'open',
          draft: !!p.draft,
          author: p.user?.login,
          base: p.base?.ref ?? '',
          ci: ciState(checks.check_runs ?? []),
          ...reviewVerdicts(reviews.map((r) => ({ user: r.user?.login, state: r.state }))),
          pending: [...((p.requested_reviewers ?? []) as Obj[]).map((u) => u.login), ...((p.requested_teams ?? []) as Obj[]).map((t) => t.name)]
        }
      })
    )
  }

  /** The live state of one Pull Request, for a review Todo: my verdict, checks, and whether it can be merged. */
  async prTodoState(owner: string, repo: string, number: number, me: string, now: number): Promise<PrTodoState> {
    const base = `/repos/${owner}/${repo}`
    const pr = (await this.get(`${base}/pulls/${number}`)) as Obj
    const [reviews, checks] = (await Promise.all([
      this.get(`${base}/pulls/${number}/reviews?per_page=100`),
      this.get(`${base}/commits/${pr.head.sha}/check-runs?per_page=100`)
    ])) as [Obj[], Obj]
    const verdicts = reviewVerdicts(reviews.map((r) => ({ user: r.user?.login, state: r.state })))
    const mine = reviews.filter((r) => r.user?.login === me && ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'].includes(r.state))
    // an approval or a change request counts over a later comment
    const decisive = [...mine].reverse().find((r) => r.state !== 'COMMENTED') ?? mine[mine.length - 1]
    return {
      state: pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : 'open',
      draft: !!pr.draft,
      ci: ciState(checks.check_runs ?? []),
      myReview: decisive?.state,
      ...verdicts,
      mergeable: (pr.mergeable_state ?? 'unknown') as Mergeable,
      title: pr.title,
      url: pr.html_url,
      base: pr.base?.ref ?? '',
      head: pr.head?.ref,
      fetchedAt: now
    }
  }

  async prInfo(owner: string, repo: string, number: number): Promise<PrInfo> {
    const pr = (await this.get(`/repos/${owner}/${repo}/pulls/${number}`)) as Obj
    return {
      owner,
      repo,
      number,
      title: pr.title,
      url: pr.html_url,
      headRef: pr.head.ref,
      fromFork: !pr.head.repo || pr.head.repo.full_name !== pr.base.repo.full_name,
      cloneUrl: pr.base.repo.clone_url
    }
  }

  async snapshot(owner: string, repo: string, number: number, me: string): Promise<PrSnapshot> {
    const base = `/repos/${owner}/${repo}`
    const pr = (await this.get(`${base}/pulls/${number}`)) as Obj
    const [reviews, reviewComments, issueComments, checks] = (await Promise.all([
      this.get(`${base}/pulls/${number}/reviews?per_page=100`),
      this.get(`${base}/pulls/${number}/comments?per_page=100`),
      this.get(`${base}/issues/${number}/comments?per_page=100`),
      this.get(`${base}/commits/${pr.head.sha}/check-runs?per_page=100`)
    ])) as [Obj[], Obj[], Obj[], Obj]
    const mine = reviews.filter((r) => r.user?.login === me && r.state !== 'PENDING')
    const last = mine[mine.length - 1]
    const others = (c: Obj) => c.user?.login !== me
    return {
      state: pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : 'open',
      headSha: pr.head.sha,
      reviewRequested: (pr.requested_reviewers as Obj[]).some((r) => r.login === me),
      myReview: last ? { state: last.state, commitId: last.commit_id } : undefined,
      commentCount: reviewComments.filter(others).length + issueComments.filter(others).length,
      ci: ciState(checks.check_runs ?? [])
    }
  }
}
