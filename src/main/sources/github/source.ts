import type { Source } from '../source'
import type { GithubApi } from './api'

export const GITHUB_SOURCE_ID = 'github-prs'

/** Pull Requests waiting for the user's review. */
export const githubSource = (api: () => Promise<GithubApi>): Source => ({
  id: GITHUB_SOURCE_ID,
  name: 'GitHub Pull Requests',
  fetchCandidates: async () => (await api()).reviewRequested()
})
