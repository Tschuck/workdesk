/**
 * Handwritten answers in the shape of the documented APIs (GitHub REST, GitLab REST v4, Jira Cloud REST v3).
 * They tell one story: the user `tobi` is asked to review change request 7 "Add export" of alice, from `feat/export`
 * into `main`; bob approved, the checks passed, nothing blocks the merge.
 */
import type { FetchFn } from './http'

type Json = unknown

/** A fetch that answers from a table of `"METHOD /path?query"` → JSON, and fails loudly on anything else. */
export function fixtureFetch(routes: Record<string, Json>, log: { method: string; url: string; body?: unknown }[] = []): FetchFn {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input))
    const method = init?.method ?? 'GET'
    log.push({ method, url: u.pathname + u.search, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const hit = routes[`${method} ${u.pathname}${u.search}`]
    if (hit === undefined && !(`${method} ${u.pathname}${u.search}` in routes)) return new Response(JSON.stringify({ message: 'no fixture' }), { status: 404 })
    if (hit === null) return new Response(null, { status: 204 })
    return new Response(JSON.stringify(hit), { status: 200 })
  }) as FetchFn
}

// --- GitHub REST (no GraphQL: the plain path) ---------------------------------------------------------------------
const GH_PR = {
  number: 7,
  title: 'Add export',
  html_url: 'https://github.com/acme/app/pull/7',
  state: 'open',
  merged: false,
  merged_at: null,
  draft: false,
  user: { login: 'alice' },
  head: { ref: 'feat/export', sha: 'abc123' },
  base: { ref: 'main' },
  requested_reviewers: [{ login: 'tobi' }],
  requested_teams: [],
  mergeable_state: 'clean'
}

export const githubRoutes: Record<string, Json> = {
  '/user': { login: 'tobi' },
  '/repos/acme/app/pulls?state=open&per_page=100&sort=updated&direction=desc': [GH_PR],
  '/repos/acme/app/pulls/7/reviews?per_page=100': [{ user: { login: 'bob' }, state: 'APPROVED' }],
  '/repos/acme/app/pulls?head=acme%3Afeat%2Fexport&state=all&per_page=5&sort=updated&direction=desc': [GH_PR],
  '/repos/acme/app/pulls?head=acme%3Anope&state=all&per_page=5&sort=updated&direction=desc': [],
  '/repos/acme/app/pulls/7': GH_PR,
  '/repos/acme/app/commits/abc123/check-runs?per_page=100': {
    check_runs: [
      { name: 'build', status: 'completed', conclusion: 'success', html_url: 'https://github.com/acme/app/runs/1' },
      { name: 'lint', status: 'completed', conclusion: 'skipped', html_url: 'https://github.com/acme/app/runs/2' }
    ]
  },
  ['/search/issues?q=' + encodeURIComponent('is:pr is:open review-requested:@me archived:false') + '&per_page=50']: {
    items: [{ number: 7, title: 'Add export', html_url: GH_PR.html_url, repository_url: 'https://api.github.com/repos/acme/app', user: { login: 'alice' }, draft: false }]
  }
}

// --- GitLab REST v4 ----------------------------------------------------------------------------------------------
const GL_MR = {
  iid: 7,
  project_id: 42,
  title: 'Add export',
  web_url: 'https://gitlab.example.com/acme/tools/app/-/merge_requests/7',
  state: 'opened',
  draft: false,
  author: { username: 'alice' },
  source_branch: 'feat/export',
  target_branch: 'main',
  reviewers: [{ username: 'tobi' }, { username: 'bob' }],
  detailed_merge_status: 'mergeable',
  head_pipeline: { id: 900, status: 'success' },
  references: { full: 'acme/tools/app!7' }
}
const P = '/api/v4/projects/acme%2Ftools%2Fapp'

export const gitlabRoutes: Record<string, Json> = {
  'GET /api/v4/user': { username: 'tobi' },
  [`GET ${P}/merge_requests?state=opened&per_page=100&order_by=updated_at&sort=desc`]: [GL_MR],
  [`GET ${P}/merge_requests/7/approvals`]: { approved_by: [{ user: { username: 'bob' } }] },
  [`GET ${P}/merge_requests?source_branch=feat%2Fexport&state=all&per_page=3&order_by=created_at&sort=desc`]: [GL_MR],
  [`GET ${P}/merge_requests?source_branch=nope&state=all&per_page=3&order_by=created_at&sort=desc`]: [],
  [`GET ${P}/merge_requests/7`]: GL_MR,
  [`GET ${P}/pipelines/900/jobs?per_page=100`]: [
    { name: 'build', status: 'success', web_url: 'https://gitlab.example.com/acme/tools/app/-/jobs/1' },
    { name: 'deploy', status: 'skipped', web_url: 'https://gitlab.example.com/acme/tools/app/-/jobs/2' }
  ],
  'GET /api/v4/merge_requests?scope=all&state=opened&reviewer_username=tobi&per_page=50': [GL_MR]
}

// --- Jira Cloud REST v3 ------------------------------------------------------------------------------------------
const JIRA_ISSUE = { key: 'ENG-5', fields: { summary: 'Export as CSV', status: { name: 'In Review', statusCategory: { key: 'indeterminate' } }, assignee: { displayName: 'Tobi' } } }
const JQL = encodeURIComponent('assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC')

export const jiraRoutes: Record<string, Json> = {
  'GET /rest/api/3/myself': { displayName: 'Tobi', emailAddress: 'tobi@example.com', accountId: 'abc' },
  'GET /rest/api/3/issue/ENG-5?fields=summary,status,assignee': JIRA_ISSUE,
  'GET /rest/api/3/issue/ENG-5/transitions': {
    transitions: [
      { id: '31', name: 'Done', to: { name: 'Done', statusCategory: { key: 'done' } } },
      { id: '21', name: 'Back to progress', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } }
    ]
  },
  'POST /rest/api/3/issue/ENG-5/transitions': null,
  [`GET /rest/api/3/search/jql?jql=${JQL}&fields=summary,status,assignee&maxResults=50`]: { issues: [JIRA_ISSUE] }
}
