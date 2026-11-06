import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE_ID, HOME_REPO_ID } from './domain/profiles'
import { profileSecrets } from './profile-secrets'
import { ProfilesManager } from './profiles-manager'
import { ProfilesService } from './profiles-service'
import { ProjectRegistry } from './projects/projects'
import type { RepoGit } from './projects/repo-git'
import { MemorySecrets } from './secrets'
import { WorkDeskService } from './service'
import { FakeGit } from './status/fake-git'

let tmp: string
let root: string
let git: FakeGit
let profiles: ProfilesService
let service: WorkDeskService
let registry: ProjectRegistry
let secrets: MemorySecrets
let manager: ProfilesManager

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'workdesk-pm-'))
  root = join(tmp, 'root')
  git = new FakeGit()
  let n = 0
  profiles = new ProfilesService(join(tmp, 'profiles.json'), () => `id${++n}`)
  await profiles.load()
  service = new WorkDeskService(root, git, Date.now, profiles)
  await service.load()
  registry = new ProjectRegistry(join(service.status.dir, 'projects.json'), { fetch: async () => undefined } as unknown as RepoGit, root, () => {
    const a = profiles.config().active
    return a === DEFAULT_PROFILE_ID || a === 'all' ? undefined : a
  })
  secrets = new MemorySecrets()
  manager = new ProfilesManager({ profiles, service, registry, git, secrets, root })
})
afterEach(async () => {
  service.status.autoCommit.dispose()
  await rm(tmp, { recursive: true, force: true })
})

describe('Settings → Profiles', () => {
  it('starts with the Default Profile on the home repo', async () => {
    const s = await manager.state()
    expect(s.config.profiles.map((p) => p.name)).toEqual(['Default'])
    expect(s.repos).toMatchObject([{ id: HOME_REPO_ID, available: true, todos: 0, desks: 0, profileIds: [DEFAULT_PROFILE_ID] }])
    expect(s.credentials[DEFAULT_PROFILE_ID]).toEqual({ github: false, notion: false, gitlab: false, jira: false })
  })

  it('points to a new folder, makes the repo there and lets a Profile use it', async () => {
    const dir = join(tmp, 'b-status')
    let s = await manager.addRepo({ mode: 'point', path: dir, label: 'B repo' })
    const repo = s.repos.find((r) => r.label === 'B repo')!
    expect(repo).toMatchObject({ path: dir, available: true })
    expect(git.calls).toContain('init')
    s = await manager.add('B', repo.id)
    expect(s.repos.find((r) => r.id === repo.id)?.profileIds).toEqual([s.config.profiles[1].id])
    await expect(manager.addRepo({ mode: 'point', path: dir })).rejects.toThrow(/already/)
    await expect(manager.addRepo({ mode: 'point', path: 'relative/dir' })).rejects.toThrow(/absolute/)
    await expect(manager.addRepo({ mode: 'point', path: service.status.dir })).rejects.toThrow(/home/)
  })

  it('clones a remote into a folder that is new or empty, never into one with files', async () => {
    const dir = join(tmp, 'cloned')
    const s = await manager.addRepo({ mode: 'clone', url: 'git@example.com:me/status-b.git', path: dir })
    expect(git.calls).toContain(`clone:git@example.com:me/status-b.git:${dir}`)
    expect(s.repos.some((r) => r.path === dir)).toBe(true)
    const full = join(tmp, 'full')
    await mkdir(full)
    await writeFile(join(full, 'x.txt'), 'x')
    await expect(manager.addRepo({ mode: 'clone', url: 'git@example.com:me/y.git', path: full })).rejects.toThrow(/not empty/)
    await expect(manager.addRepo({ mode: 'clone', url: '--upload-pack=evil', path: join(tmp, 'z') })).rejects.toThrow(/URL/)
  })

  it('forgets only a repo nobody uses and nothing lives in', async () => {
    let s = await manager.addRepo({ mode: 'point', path: join(tmp, 'r1') })
    const id = s.repos[1].id
    s = await manager.add('B', id)
    await expect(manager.forgetRepo(id)).rejects.toThrow(/still uses/)
    const b = s.config.profiles[1].id
    await profiles.setActive(b)
    await service.addTodo({ title: 'in b repo', topics: [], list: 'today' })
    await manager.update(b, { repoId: HOME_REPO_ID })
    await expect(manager.forgetRepo(id)).rejects.toThrow(/live in that Status Repo/)
  })

  it('removes a Profile: its things go to Default, its credentials are deleted, its repo stays registered', async () => {
    const dir = join(tmp, 'r2')
    let s = await manager.addRepo({ mode: 'point', path: dir })
    s = await manager.add('B', s.repos[1].id)
    const b = s.config.profiles[1].id
    await profiles.setActive(b)
    const t = (await service.addTodo({ title: 'B thing', topics: [], list: 'today' })).todos[0]
    await service.startPlainDesk([t.id], '')
    await registry.addExisting('app-b', join(tmp, 'clone-b'))
    expect((await registry.list())[0].profileId).toBe(b)
    await profileSecrets(secrets, b).set('github-token', 'secret-b')
    expect((await manager.state()).credentials[b].github).toBe(true)

    s = await manager.remove(b)
    expect(s.config.profiles.map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID])
    expect(s.config.active).toBe(DEFAULT_PROFILE_ID)
    expect(service.state().todos[0]).not.toHaveProperty('profileId')
    expect(service.state().desks[0]).not.toHaveProperty('profileId')
    expect((await registry.list())[0]).not.toHaveProperty('profileId')
    expect(await profileSecrets(secrets, b).get('github-token')).toBeUndefined()
    expect(s.repos.some((r) => r.path === dir)).toBe(true)
    // the stuff is still in the repo it was made in, and still shown
    expect(s.repos.find((r) => r.path === dir)).toMatchObject({ todos: 1, desks: 1 })
    await expect(manager.remove(DEFAULT_PROFILE_ID)).rejects.toThrow(/Default/)
  })

  it('lists a Project under another Profile and counts them', async () => {
    let s = await manager.add('B')
    const b = s.config.profiles[1].id
    await registry.addExisting('app', join(tmp, 'clone'))
    s = await manager.setProjectProfile('app', b)
    expect(s.projects).toEqual({ [b]: 1 })
    s = await manager.setProjectProfile('app', null)
    expect(s.projects).toEqual({ [DEFAULT_PROFILE_ID]: 1 })
    registry.visible = (p) => (p.profileId ?? DEFAULT_PROFILE_ID) === b
    expect(await registry.listVisible()).toEqual([])
    expect((await registry.list()).length).toBe(1)
  })
})
