import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  addProfile, addRepo, defaultConfig, forgetRepo, parseConfig, removeProfile, renameProfile, setActive, setProfileClaudeAccount, setProfileColor, setProfileRepo,
  type ProfilesConfig, type RepoRef
} from './domain/profiles'

/** What the rest of the main process needs of the Profiles: the current configuration. */
export interface ProfilesHost {
  config(): ProfilesConfig
}

/** The Profiles and the Status Repos they use: `profiles.json` in the app's user data (repo folders are specific to this machine). */
export class ProfilesService implements ProfilesHost {
  private cfg: ProfilesConfig = defaultConfig()
  onChange: (cfg: ProfilesConfig) => void = () => undefined

  constructor(
    private readonly file: string,
    private readonly newId: () => string = randomUUID
  ) {}

  /** A missing or unreadable file is the single Default Profile on the home Status Repo: how every earlier version looked. */
  async load(): Promise<void> {
    try {
      this.cfg = parseConfig(JSON.parse(await readFile(this.file, 'utf8')))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err
      this.cfg = defaultConfig()
    }
  }

  config(): ProfilesConfig {
    return this.cfg
  }

  private async update(fn: (cfg: ProfilesConfig) => ProfilesConfig): Promise<ProfilesConfig> {
    const next = fn(this.cfg)
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(next, null, 2) + '\n')
    this.cfg = next
    this.onChange(next)
    return next
  }

  save(): Promise<ProfilesConfig> {
    return this.update((c) => c)
  }

  add(name: string, repoId?: string): Promise<ProfilesConfig> {
    return this.update((c) => addProfile(c, this.newId(), name, repoId))
  }
  rename(id: string, name: string): Promise<ProfilesConfig> {
    return this.update((c) => renameProfile(c, id, name))
  }
  setColor(id: string, color: string): Promise<ProfilesConfig> {
    return this.update((c) => setProfileColor(c, id, color))
  }
  setRepo(id: string, repoId: string): Promise<ProfilesConfig> {
    return this.update((c) => setProfileRepo(c, id, repoId))
  }
  setClaudeAccount(id: string, accountId: string | null): Promise<ProfilesConfig> {
    return this.update((c) => setProfileClaudeAccount(c, id, accountId))
  }
  remove(id: string): Promise<ProfilesConfig> {
    return this.update((c) => removeProfile(c, id))
  }
  setActive(view: string): Promise<ProfilesConfig> {
    return this.update((c) => setActive(c, view))
  }
  addRepo(path: string, label?: string): Promise<{ cfg: ProfilesConfig; repo: RepoRef }> {
    const repo: RepoRef = { id: this.newId(), label: label?.trim() || path.replace(/\/+$/, '').split('/').pop() || path, path }
    return this.update((c) => addRepo(c, repo)).then((cfg) => ({ cfg, repo }))
  }
  forgetRepo(id: string): Promise<ProfilesConfig> {
    return this.update((c) => forgetRepo(c, id))
  }
  markSecretsMigrated(): Promise<ProfilesConfig> {
    return this.update((c) => ({ ...c, secretsMigrated: true }))
  }
}
