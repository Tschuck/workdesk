import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectRegistry } from '../projects/projects'
import type { RepoGit } from '../projects/repo-git'
import { WorkDeskService } from '../service'
import { FakeGit } from '../status/fake-git'
import { GithubApi } from './github/api'
import { PrsService } from './prs-service'
import { SourceStore } from './store'

let tmp: string
let service: WorkDeskService
let prs: PrsService
let calls: string[]
let failRepo: string | undefined

const pull = (n: number, user: string, extra: object = {}) => ({ number: n, title: `Title ${n}`, html_url: `https://github.com/o/app/pull/${n}`, user: { login: user }, draft: false, requested_reviewers: [], ...extra })

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'workdesk-prs-'))
  const root = join(tmp, 'root')
  service = new WorkDeskService(root, new FakeGit())
  await service.load()
  await mkdir(service.status.dir, { recursive: true })
  await writeFile(join(service.status.dir, 'projects.json'), JSON.stringify([
    { name: 'backend', gitDir: '/g/backend.git', origin: 'bare-clone' },
    { name: 'frontend', gitDir: '/g/frontend.git', origin: 'bare-clone' }
  ]))
  const urls: Record<string, string> = { '/g/backend.git': 'git@github.com:o/app.git', '/g/frontend.git': 'https://github.com/o/other.git' }
  const git = { remoteUrl: async (d: string) => urls[d] } as unknown as RepoGit
  calls = []
  failRepo = undefined
  const api = new GithubApi(async (p) => {
    calls.push(p)
    const repo = /repos\/o\/([^/]+)/.exec(p)?.[1]
    if (repo === failRepo) throw new Error('GitHub 404')
    if (p.includes('/pulls?')) {
      return repo === 'app' ? [pull(1, 'dev'), pull(2, 'me'), pull(3, 'dev', { requested_reviewers: [{ login: 'me' }] }), pull(4, 'dev', { draft: true })] : [pull(9, 'dev')]
    }
    if (p.includes('/pulls/1/reviews')) return [{ user: { login: 'me' }, state: 'APPROVED' }]
    return []
  })
  prs = new PrsService({
    service,
    store: new SourceStore(service.status.dir),
    registry: new ProjectRegistry(join(service.status.dir, 'projects.json'), git, root),
    github: async () => ({ api, me: 'me' }),
    now: () => 1234
  })
})
afterEach(async () => {
  service.status.autoCommit.dispose()
  await rm(tmp, { recursive: true, force: true })
})

describe('PR page', () => {
  it('groups Pull Requests under the Projects, in Project order, with review state', async () => {
    const before = await prs.state()
    expect(before.repos.map((r) => [r.repo, r.project, r.fetched])).toEqual([['o/app', 'backend', false], ['o/other', 'frontend', false]])

    const s = await prs.refresh(false)
    expect(s.fetchedAt).toBe(1234)
    expect(s.repos[0].items.map((p) => [p.number, p.reviewState])).toEqual([[1, 'approved'], [2, 'mine'], [3, 'requested'], [4, 'none']])
    expect(s.repos[0].items[3].draft).toBe(true)
    expect(s.repos[1].items.map((p) => p.number)).toEqual([9])
    expect(calls.some((c) => c.includes('/pulls/2/reviews'))).toBe(false)

    calls = []
    await prs.refresh(false)
    expect(calls).toEqual([])
    await prs.refresh(true)
    expect(calls.length).toBeGreaterThan(0)
  })

  it('keeps a repository error to that repository', async () => {
    failRepo = 'other'
    const s = await prs.refresh(true)
    expect(s.repos[0].error).toBeUndefined()
    expect(s.repos[1]).toMatchObject({ error: 'GitHub 404', items: [] })
  })

  it('watches extra repositories by hand and forgets them again', async () => {
    await expect(prs.addRepo('not a repo')).rejects.toThrow(/owner\/name/)
    const s = await prs.addRepo('o/extra')
    expect(s.repos.map((r) => [r.repo, r.manual])).toEqual([['o/app', false], ['o/other', false], ['o/extra', true]])
    expect((await prs.addRepo('O/APP')).repos).toHaveLength(3)
    expect((await prs.removeRepo('o/extra')).repos).toHaveLength(2)
  })

  it('skips and unskips', async () => {
    expect((await prs.skip('o/app#4', true)).skipped).toEqual(['o/app#4'])
    expect((await prs.skip('o/app#4', false)).skipped).toEqual([])
  })
})
