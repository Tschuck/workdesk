import { existsSync } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { basename, isAbsolute, join, normalize } from 'node:path'
import { DEFAULT_PROFILE_ID, HOME_REPO_ID, profileIdOf } from './domain/profiles'
import { credentialsOf, forgetCredentials, type ProfilesState, type RepoInfo } from './profiles-ipc'
import type { ProfilesService } from './profiles-service'
import type { ProjectRegistry } from './projects/projects'
import type { SecretStore } from './secrets'
import type { WorkDeskService } from './service'
import type { Git } from './status/git'
import { slugify } from './projects/layout'

export interface NewRepoInput {
  /** `point`: a folder (made and `git init`ed when it is new, used as it is when it is a Status Repo already); `clone`: a remote cloned into a new folder */
  mode: 'point' | 'clone'
  path?: string
  url?: string
  label?: string
}

export interface ProfileChanges {
  name?: string
  color?: string
  repoId?: string
  claudeAccountId?: string | null
}

/** Settings → Profiles: everything that changes Profiles, their Status Repos, their credentials and what carries their tag. */
export class ProfilesManager {
  constructor(
    private readonly d: {
      profiles: ProfilesService
      service: WorkDeskService
      registry: ProjectRegistry
      git: Git
      secrets: SecretStore
      root: string
    }
  ) {}

  async state(): Promise<ProfilesState> {
    const { profiles, service, registry, git, secrets } = this.d
    const config = profiles.config()
    const repos: RepoInfo[] = await Promise.all(
      config.repos.map(async (ref): Promise<RepoInfo> => {
        const available = service.status.isLoaded(ref.id)
        const usage = service.status.usage(ref.id)
        return {
          id: ref.id,
          label: ref.label,
          path: ref.id === HOME_REPO_ID ? service.status.dir : (ref.path ?? ''),
          remote: available ? ((await git.remoteUrl(service.status.dirOf(ref.id)).catch(() => undefined)) ?? null) : null,
          available,
          error: service.status.unavailable.get(ref.id),
          ...usage,
          profileIds: config.profiles.filter((p) => p.repoId === ref.id).map((p) => p.id)
        }
      })
    )
    const credentials = Object.fromEntries(await Promise.all(config.profiles.map(async (p) => [p.id, await credentialsOf(secrets, p.id)] as const)))
    const projects: Record<string, number> = {}
    const all = await registry.list()
    for (const p of all) projects[profileIdOf(p, config)] = (projects[profileIdOf(p, config)] ?? 0) + 1
    return { config, repos, credentials, projects, projectList: all.map((p) => ({ name: p.name, profileId: profileIdOf(p, config) })) }
  }

  async add(name: string, repoId?: string): Promise<ProfilesState> {
    await this.d.profiles.add(name, repoId)
    await this.d.service.attachRepos()
    return this.state()
  }

  async update(id: string, changes: ProfileChanges): Promise<ProfilesState> {
    const { profiles, service } = this.d
    if (changes.name !== undefined) await profiles.rename(id, changes.name)
    if (changes.color !== undefined) await profiles.setColor(id, changes.color)
    if (changes.claudeAccountId !== undefined) await profiles.setClaudeAccount(id, changes.claudeAccountId)
    if (changes.repoId !== undefined) {
      await profiles.setRepo(id, changes.repoId)
      // nothing is moved: what the Profile has stays in its repo; new things go to the new one
      await service.attachRepos()
    }
    return this.state()
  }

  /**
   * Remove a Profile. Its Todos and WorkDesks, Projects and sources are not deleted: they go to the Default Profile (so the
   * caller asks first). Its credentials are removed from the keychain. Status Repos stay registered.
   */
  async remove(id: string): Promise<ProfilesState> {
    const { profiles, service, registry, secrets } = this.d
    if (id === DEFAULT_PROFILE_ID) throw new Error('The Default Profile cannot be removed')
    if (!profiles.config().profiles.some((p) => p.id === id)) throw new Error(`Unknown Profile ${id}`)
    await service.retagProfile(id, DEFAULT_PROFILE_ID)
    for (const p of await registry.list()) if (p.profileId === id) await registry.setProfile(p.name, undefined)
    await profiles.remove(id)
    await forgetCredentials(secrets, id)
    return this.state()
  }

  /** Register a Status Repo: a folder to point to (or make), or a remote to clone. A repo with Todos and WorkDesks in it is loaded at once. */
  async addRepo(input: NewRepoInput): Promise<ProfilesState> {
    const { profiles, service, git, root } = this.d
    let path = input.path?.trim() ?? ''
    if (input.mode === 'clone') {
      const url = input.url?.trim() ?? ''
      if (!url || url.startsWith('-')) throw new Error('That is not a repository URL.')
      if (!path) path = join(root, `status-${slugify(input.label || basename(url).replace(/\.git$/, '') || 'repo')}`)
      path = normalize(path)
      if (!isAbsolute(path)) throw new Error('The folder must be an absolute path')
      if (existsSync(path) && (await readdir(path)).length > 0) throw new Error(`${path} exists and is not empty`)
      await mkdir(join(path, '..'), { recursive: true })
      await git.clone(url, path)
    } else {
      path = normalize(path)
      if (!path || !isAbsolute(path)) throw new Error('The folder must be an absolute path')
      if (path === normalize(service.status.dir)) throw new Error('That is the home Status Repo already')
    }
    await profiles.addRepo(path.replace(/\/+$/, ''), input.label)
    const ref = profiles.config().repos.at(-1)!
    await service.attachRepos()
    if (!service.status.isLoaded(ref.id)) {
      const why = service.status.unavailable.get(ref.id) ?? 'unknown reason'
      await profiles.forgetRepo(ref.id)
      throw new Error(`That folder cannot be used as a Status Repo: ${why}`)
    }
    return this.state()
  }

  /** Unregister a Status Repo that no Profile writes to and nothing lives in. The folder is never touched. */
  async forgetRepo(id: string): Promise<ProfilesState> {
    const usage = this.d.service.status.usage(id)
    if (usage.todos + usage.desks > 0) throw new Error(`${usage.todos} Todos and ${usage.desks} WorkDesks live in that Status Repo: it stays registered`)
    await this.d.profiles.forgetRepo(id)
    return this.state()
  }

  /** List a Project under a Profile (null: the Default one). */
  async setProjectProfile(name: string, profileId: string | null): Promise<ProfilesState> {
    const cfg = this.d.profiles.config()
    if (profileId && !cfg.profiles.some((p) => p.id === profileId)) throw new Error(`Unknown Profile ${profileId}`)
    await this.d.registry.setProfile(name, profileId && profileId !== DEFAULT_PROFILE_ID ? profileId : undefined)
    return this.state()
  }
}
