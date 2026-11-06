import { deriveReviewState, isDepUpdate, type BranchPrStatus, type Mergeable, type PrItem, type PrTodoState } from '../../domain/prs'
import type { CiState } from '../../domain/types'
import type { ChangeRequestProvider, CiCheck, Provider } from '../provider'
import type { Candidate } from '../source'
import { cleanBaseUrl, jsonCall, type FetchFn } from './http'

interface Obj { [k: string]: any }

export const GITLAB_TOKEN_KEY = 'provider-gitlab-token'
export const GITLAB_DEFAULT_URL = 'https://gitlab.com'

/** GitLab pipeline status → the app's CI state. `manual` waits for a person, which is not a failure. */
export function gitlabCi(status: string | undefined): CiState {
  if (!status) return 'none'
  if (status === 'success') return 'success'
  if (status === 'failed' || status === 'canceled') return 'failure'
  if (status === 'skipped') return 'none'
  return 'pending'
}

/** `detailed_merge_status` of a merge request in the words of GitHub's `mergeable_state`, which the readiness rule uses. */
export function gitlabMergeable(mr: Obj): Mergeable {
  if (mr.draft || mr.work_in_progress) return 'draft'
  switch (mr.detailed_merge_status ?? mr.merge_status) {
    case 'mergeable':
    case 'can_be_merged':
      return 'clean'
    case 'conflict':
    case 'cannot_be_merged':
      return 'dirty'
    case 'need_rebase':
      return 'behind'
    case 'ci_must_pass':
      return 'unstable'
    case 'checking':
    case 'unchecked':
    case undefined:
      return 'unknown'
    default:
      // not_approved, requested_changes, discussions_not_resolved, ci_still_running, external_status_checks, …
      return 'blocked'
  }
}

const state = (mr: Obj): 'open' | 'merged' | 'closed' => (mr.state === 'merged' ? 'merged' : mr.state === 'closed' ? 'closed' : 'open')
const encode = (path: string): string => encodeURIComponent(path)
const split = (path: string): { owner: string; repo: string } => {
  const i = path.lastIndexOf('/')
  return { owner: path.slice(0, i), repo: path.slice(i + 1) }
}
const isDraft = (mr: Obj): boolean => !!(mr.draft || mr.work_in_progress)

/** `group/sub/project!12`, the id of a merge request (GitLab's own reference form). */
export const mrId = (path: string, iid: number): string => `${path}!${iid}`

function jobState(status: string): CiCheck['state'] {
  const ci = gitlabCi(status)
  return ci === 'none' ? 'skipped' : ci
}

/**
 * GitLab merge requests over REST v4 with a personal access token (scope `read_api`). `baseUrl` is the instance, so a
 * self-hosted GitLab works. Built from the documented API and fixtures; not yet confirmed against a real account.
 */
export function gitlabChangeRequests(baseUrl: string, token: string, fetchFn: FetchFn = fetch): ChangeRequestProvider {
  const root = cleanBaseUrl(baseUrl)
  const get = (path: string) => jsonCall(fetchFn, 'GitLab', `${root}/api/v4${path}`, { headers: { 'PRIVATE-TOKEN': token } }) as Promise<any>
  const project = (repo: string) => `/projects/${encode(repo)}`

  const pipelines = async (repo: string, iid: number): Promise<Obj[]> => (await get(`${project(repo)}/merge_requests/${iid}/pipelines`)) as Obj[]
  const approvedBy = async (repo: string, iid: number): Promise<string[]> => {
    const a = (await get(`${project(repo)}/merge_requests/${iid}/approvals`)) as Obj
    return ((a.approved_by ?? []) as Obj[]).map((x) => x.user?.username).filter((x): x is string => !!x)
  }
  const ciOf = (mr: Obj, pipes?: Obj[]): CiState => gitlabCi(mr.head_pipeline?.status ?? pipes?.[0]?.status)

  return {
    async me() {
      return ((await get('/user')) as Obj).username
    },

    async openChangeRequests(repo, me) {
      const { owner, repo: name } = split(repo)
      const list = (await get(`${project(repo)}/merge_requests?state=opened&per_page=100&order_by=updated_at&sort=desc`)) as Obj[]
      return Promise.all(
        list.map(async (mr): Promise<PrItem> => {
          const mine = mr.author?.username === me
          const requested = ((mr.reviewers ?? []) as Obj[]).some((r) => r.username === me)
          const approved = mine ? [] : await approvedBy(repo, mr.iid)
          return {
            id: mrId(repo, mr.iid),
            owner,
            repo: name,
            number: mr.iid,
            title: mr.title,
            url: mr.web_url,
            author: mr.author?.username ?? '?',
            draft: isDraft(mr),
            head: mr.source_branch,
            reviewState: deriveReviewState({ mine, requested, myReview: approved.includes(me) ? 'APPROVED' : undefined })
          }
        })
      )
    },

    async branchChangeRequests(repo, branch) {
      const list = (await get(`${project(repo)}/merge_requests?source_branch=${encode(branch)}&state=all&per_page=3&order_by=created_at&sort=desc`)) as Obj[]
      return Promise.all(
        list.slice(0, 3).map(async (mr): Promise<BranchPrStatus> => {
          const [approved, pipes] = await Promise.all([approvedBy(repo, mr.iid), mr.head_pipeline ? undefined : pipelines(repo, mr.iid)])
          return {
            number: mr.iid,
            title: mr.title,
            url: mr.web_url,
            state: state(mr),
            draft: isDraft(mr),
            base: mr.target_branch ?? '',
            ci: ciOf(mr, pipes),
            approvals: approved.length,
            changesRequested: mr.detailed_merge_status === 'requested_changes' ? 1 : 0,
            pending: ((mr.reviewers ?? []) as Obj[]).map((r) => r.username).filter((x) => x && !approved.includes(x)),
            mergeable: gitlabMergeable(mr)
          }
        })
      )
    },

    async changeRequestState(repo, number, me, now): Promise<PrTodoState> {
      const mr = (await get(`${project(repo)}/merge_requests/${number}`)) as Obj
      const [approved, pipes] = await Promise.all([approvedBy(repo, number), mr.head_pipeline ? undefined : pipelines(repo, number)])
      return {
        state: state(mr),
        draft: isDraft(mr),
        ci: ciOf(mr, pipes),
        // GitLab has approvals; one person's "request changes" verdict is not in REST v4
        myReview: approved.includes(me) ? 'APPROVED' : undefined,
        approvals: approved.length,
        changesRequested: mr.detailed_merge_status === 'requested_changes' ? 1 : 0,
        mergeable: gitlabMergeable(mr),
        title: mr.title,
        url: mr.web_url,
        base: mr.target_branch ?? '',
        head: mr.source_branch,
        fetchedAt: now
      }
    },

    async ciChecks(repo, number): Promise<CiCheck[]> {
      const mr = (await get(`${project(repo)}/merge_requests/${number}`)) as Obj
      const pipeId = mr.head_pipeline?.id ?? (await pipelines(repo, number))[0]?.id
      if (!pipeId) return []
      const jobs = (await get(`${project(repo)}/pipelines/${pipeId}/jobs?per_page=100`)) as Obj[]
      return jobs.map((j) => ({ name: j.name, state: jobState(j.status), url: j.web_url }))
    },

    async reviewRequested(): Promise<Candidate[]> {
      const me = ((await get('/user')) as Obj).username
      const list = (await get(`/merge_requests?scope=all&state=opened&reviewer_username=${encode(me)}&per_page=50`)) as Obj[]
      return list.map((mr) => {
        const path = String(mr.references?.full ?? `${mr.project_id}!${mr.iid}`).replace(/!\d+$/, '')
        return {
          id: mrId(path, mr.iid),
          title: mr.title,
          name: mr.title,
          url: mr.web_url,
          subtitle: `${path} · ${mr.author?.username ?? '?'}`,
          dependencyUpdate: isDepUpdate({ title: mr.title }),
          draft: isDraft(mr),
          branch: mr.source_branch
        }
      })
    }
  }
}

export function gitlabProvider(baseUrl: string, token: string, fetchFn: FetchFn = fetch): Provider {
  const changeRequests = gitlabChangeRequests(baseUrl, token, fetchFn)
  return { kind: 'gitlab', name: 'GitLab', untested: true, changeRequests, testConnection: () => changeRequests.me() }
}
