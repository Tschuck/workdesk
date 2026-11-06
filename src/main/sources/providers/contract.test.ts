import { describe, expect, it } from 'vitest'
import { prReadiness } from '../../domain/prs'
import { GithubApi, type Transport } from '../github/api'
import { githubProvider } from '../github/provider'
import type { Provider } from '../provider'
import { fixtureFetch, githubRoutes, gitlabRoutes, jiraRoutes } from './fixtures'
import { gitlabProvider } from './gitlab'
import { jiraProvider } from './jira'

/**
 * The contract every adapter has to pass. One suite, parametrised over adapters; each adapter is built on top of
 * fixtures that tell the same story (see fixtures.ts), so a new adapter only has to add an entry here and its fixtures.
 * No network: fetch and transports answer from tables.
 */

const githubTransport: Transport = async (path) => {
  if (!(path in githubRoutes)) throw new Error(`no fixture for ${path}`)
  return githubRoutes[path]
}

interface ChangeRequestCase {
  name: string
  make: () => Provider
  repo: string
  /** a repository path that only exists as a URL part, for the id format */
  idOf: (number: number) => string
}

const changeRequestAdapters: ChangeRequestCase[] = [
  { name: 'GitHub', make: () => githubProvider(new GithubApi(githubTransport), githubTransport), repo: 'acme/app', idOf: (n) => `acme/app#${n}` },
  { name: 'GitLab', make: () => gitlabProvider('https://gitlab.example.com', 'glpat-x', fixtureFetch(gitlabRoutes)), repo: 'acme/tools/app', idOf: (n) => `acme/tools/app!${n}` }
]

describe.each(changeRequestAdapters)('change request contract: $name', ({ make, repo, idOf }) => {
  const cr = () => make().changeRequests!

  it('identifies itself and says whether it is confirmed against a real account', () => {
    const p = make()
    expect(p.name).toBeTruthy()
    expect(typeof p.untested).toBe('boolean')
  })

  it('tests the connection with the user name', async () => {
    expect(await make().testConnection()).toBe('tobi')
  })

  it('lists open change requests with the user review state', async () => {
    const items = await cr().openChangeRequests(repo, 'tobi')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: idOf(7), number: 7, title: 'Add export', author: 'alice', draft: false, head: 'feat/export', reviewState: 'requested' })
    expect(items[0].url).toMatch(/^https:\/\//)
  })

  it('shows a change request of the same author as the user own', async () => {
    const items = await cr().openChangeRequests(repo, 'alice')
    expect(items[0].reviewState).toBe('mine')
  })

  it('reads the change requests of a branch: state, base, approvals, checks, mergeability', async () => {
    const [pr] = await cr().branchChangeRequests(repo, 'feat/export')
    expect(pr).toMatchObject({ number: 7, state: 'open', draft: false, base: 'main', ci: 'success', approvals: 1, changesRequested: 0, mergeable: 'clean' })
  })

  it('returns an empty list for a branch without change requests', async () => {
    expect(await cr().branchChangeRequests(repo, 'nope')).toEqual([])
  })

  it('reads one change request in the form the readiness rule needs', async () => {
    const s = await cr().changeRequestState(repo, 7, 'tobi', 1234)
    expect(s).toMatchObject({ state: 'open', draft: false, ci: 'success', approvals: 1, changesRequested: 0, mergeable: 'clean', base: 'main', head: 'feat/export', fetchedAt: 1234 })
    expect(prReadiness(s)).toBe('ready')
  })

  it('lists the checks of a change request', async () => {
    const checks = await cr().ciChecks(repo, 7)
    expect(checks.length).toBeGreaterThan(0)
    for (const c of checks) {
      expect(c.name).toBeTruthy()
      expect(['pending', 'success', 'failure', 'skipped']).toContain(c.state)
    }
    expect(checks.find((c) => c.name === 'build')?.state).toBe('success')
  })

  it('offers the change requests the user is asked to review as candidates', async () => {
    const [c] = await cr().reviewRequested()
    expect(c).toMatchObject({ id: idOf(7), title: 'Add export', draft: false })
    expect(c.url).toMatch(/^https:\/\//)
  })

  it('works without a ticket part: a change request provider does not need tickets', () => {
    expect(make().changeRequests).toBeDefined()
  })
})

interface TicketCase {
  name: string
  make: () => { provider: Provider; log: { method: string; url: string; body?: unknown }[] }
}

const ticketAdapters: TicketCase[] = [
  {
    name: 'Jira',
    make: () => {
      const log: { method: string; url: string; body?: unknown }[] = []
      return { provider: jiraProvider('https://acme.atlassian.net/', 'tobi@example.com', 'tok', fixtureFetch(jiraRoutes, log)), log }
    }
  }
]

describe.each(ticketAdapters)('ticket contract: $name', ({ make }) => {
  it('tests the connection', async () => {
    expect(await make().provider.testConnection()).toBeTruthy()
  })

  it('reads a ticket: key, title, link, status and its coarse category', async () => {
    const t = await make().provider.tickets!.ticket('ENG-5')
    expect(t).toMatchObject({ key: 'ENG-5', title: 'Export as CSV', status: 'In Review', category: 'doing' })
    expect(t.url).toMatch(/^https:\/\/.+\/ENG-5$/)
  })

  it('lists the transitions of a ticket', async () => {
    const ts = await make().provider.tickets!.transitions('ENG-5')
    expect(ts).toContainEqual({ id: '31', name: 'Done', to: 'Done' })
  })

  it('moves a ticket along a listed transition', async () => {
    const { provider, log } = make()
    await provider.tickets!.transition('ENG-5', '31')
    expect(log.find((l) => l.method === 'POST')?.body).toEqual({ transition: { id: '31' } })
  })

  it('refuses a transition the ticket does not offer, without changing anything', async () => {
    const { provider, log } = make()
    await expect(provider.tickets!.transition('ENG-5', '999')).rejects.toThrow(/no transition/)
    expect(log.some((l) => l.method === 'POST')).toBe(false)
  })

  it('refuses text that is not a ticket key before it reaches a URL', async () => {
    await expect(make().provider.tickets!.ticket('ENG-5/../../x')).rejects.toThrow(/Not a/)
  })

  it('offers the tickets assigned to the user as candidates carrying their key', async () => {
    const [c] = await make().provider.tickets!.assigned()
    expect(c).toMatchObject({ id: 'ENG-5', ticketKey: 'ENG-5' })
  })

  it('finds a ticket key in a branch name, and none where there is none', () => {
    const { keyIn } = make().provider.tickets!
    expect(keyIn('feat/ENG-5-export')).toBe('ENG-5')
    expect(keyIn('main')).toBeUndefined()
  })
})
