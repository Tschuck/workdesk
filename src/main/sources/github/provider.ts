import type { GithubApi, Transport } from './api'
import type { ChangeRequestProvider, CiCheck, Provider } from '../provider'

interface Obj { [k: string]: any }

const CHECK_STATE = (c: Obj): CiCheck['state'] =>
  c.status !== 'completed' ? 'pending' : ['failure', 'timed_out', 'cancelled', 'action_required'].includes(c.conclusion) ? 'failure' : c.conclusion === 'skipped' || c.conclusion === 'neutral' ? 'skipped' : 'success'

const split = (repo: string): [string, string] => {
  const [owner, name] = repo.split('/')
  return [owner, name]
}

/** The GitHub code behind the provider interface: every call delegates to GithubApi, nothing is reinterpreted. */
export function githubChangeRequests(api: GithubApi, get: Transport): ChangeRequestProvider {
  return {
    me: () => api.me(),
    openChangeRequests: (repo, me) => api.openPrs(...split(repo), me),
    branchChangeRequests: (repo, branch) => api.branchPrs(...split(repo), branch),
    changeRequestState: (repo, number, me, now) => api.prTodoState(...split(repo), number, me, now),
    reviewRequested: () => api.reviewRequested(),
    async ciChecks(repo, number) {
      const [owner, name] = split(repo)
      const pr = (await get(`/repos/${owner}/${name}/pulls/${number}`)) as Obj
      const runs = (await get(`/repos/${owner}/${name}/commits/${pr.head.sha}/check-runs?per_page=100`)) as Obj
      return ((runs.check_runs ?? []) as Obj[]).map((c) => ({ name: c.name, state: CHECK_STATE(c), url: c.html_url }))
    }
  }
}

export function githubProvider(api: GithubApi, get: Transport): Provider {
  return {
    kind: 'github',
    name: 'GitHub',
    untested: false,
    changeRequests: githubChangeRequests(api, get),
    testConnection: () => api.me()
  }
}
