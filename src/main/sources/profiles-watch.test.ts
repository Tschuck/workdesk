import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE_ID } from '../domain/profiles'
import { ProfilesService } from '../profiles-service'
import { ProjectRegistry } from '../projects/projects'
import type { RepoGit } from '../projects/repo-git'
import { RemoteCache } from '../remote-cache'
import { WorkDeskService } from '../service'
import { FakeGit } from '../status/fake-git'
import type { GithubApi } from './github/api'
import { SourcesService } from './sources-service'
import { SourceStore } from './store'

describe('background watching reads each Pull Request with the login of its WorkDesk\'s Profile', () => {
  let tmp: string
  let service: WorkDeskService
  let profiles: ProfilesService

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'workdesk-pw-'))
    profiles = new ProfilesService(join(tmp, 'profiles.json'), () => 'pb')
    await profiles.load()
    await profiles.add('B')
    service = new WorkDeskService(join(tmp, 'root'), new FakeGit(), Date.now, profiles)
    await service.load()
  })
  afterEach(async () => {
    service.status.autoCommit.dispose()
    await rm(tmp, { recursive: true, force: true })
  })

  it('asks once per Profile, with that Profile\'s client, whichever Profile is in view', async () => {
    await profiles.setActive(DEFAULT_PROFILE_ID)
    let st = await service.addTodo({ title: 'A', topics: [], list: 'today' })
    st = await service.startPlainDesk([st.todos[0].id], 'A desk')
    await service.addDeskItem('a-desk', { kind: 'pr', id: 'org-a/app#1', title: 'one' })
    await profiles.setActive('pb')
    st = await service.addTodo({ title: 'B', topics: [], list: 'today' })
    st = await service.startPlainDesk([st.todos.find((t) => t.title === 'B')!.id], 'B desk')
    await service.addDeskItem('b-desk', { kind: 'pr', id: 'org-b/app#2', title: 'two' })
    await profiles.setActive(DEFAULT_PROFILE_ID)

    const asked: { profile: string | undefined; ids: string[] }[] = []
    const apiFor = (profile: string | undefined) => ({
      prBatch: async (ids: string[]) => (asked.push({ profile, ids }), new Map(ids.map((id) => [id, { state: { state: 'open' }, snapshot: {} }])))
    }) as unknown as GithubApi
    const git = { remoteUrl: async () => undefined } as unknown as RepoGit
    const sources = new SourcesService({
      service,
      sources: [],
      store: new SourceStore(service.status.dir),
      registry: new ProjectRegistry(join(service.status.dir, 'projects.json'), git, service.root),
      repoGit: git,
      github: async (profile) => ({ api: apiFor(profile), me: 'me' }),
      remote: new RemoteCache()
    })

    const read = await sources.watched()
    expect([...read.keys()].sort()).toEqual(['org-a/app#1', 'org-b/app#2'])
    expect(asked.sort((x, y) => x.ids[0].localeCompare(y.ids[0]))).toEqual([
      { profile: DEFAULT_PROFILE_ID, ids: ['org-a/app#1'] },
      { profile: 'pb', ids: ['org-b/app#2'] }
    ])
  })

  it('one Profile\'s login failing does not stop the others', async () => {
    let st = await service.addTodo({ title: 'A', topics: [], list: 'today' })
    st = await service.startPlainDesk([st.todos[0].id], 'A desk')
    await service.addDeskItem('a-desk', { kind: 'pr', id: 'org-a/app#1', title: 'one' })
    await profiles.setActive('pb')
    st = await service.addTodo({ title: 'B', topics: [], list: 'today' })
    st = await service.startPlainDesk([st.todos.find((t) => t.title === 'B')!.id], 'B desk')
    await service.addDeskItem('b-desk', { kind: 'pr', id: 'org-b/app#2', title: 'two' })
    const git = { remoteUrl: async () => undefined } as unknown as RepoGit
    const sources = new SourcesService({
      service, sources: [], store: new SourceStore(service.status.dir),
      registry: new ProjectRegistry(join(service.status.dir, 'projects.json'), git, service.root), repoGit: git,
      github: async (profile) => {
        if (profile === DEFAULT_PROFILE_ID) throw new Error('GitHub is not connected')
        return { api: { prBatch: async (ids: string[]) => new Map(ids.map((id) => [id, { state: { state: 'open' }, snapshot: {} }])) } as unknown as GithubApi, me: 'me' }
      },
      remote: new RemoteCache()
    })
    expect([...(await sources.watched()).keys()]).toEqual(['org-b/app#2'])
  })
})
