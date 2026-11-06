import type { SecretStore } from '../../secrets'
import type { Provider, ProviderKind, RepoRef } from '../provider'
import type { SourceStore } from '../store'
import { GITLAB_DEFAULT_URL, GITLAB_TOKEN_KEY, gitlabProvider } from './gitlab'
import { cleanBaseUrl, type FetchFn } from './http'
import { JIRA_TOKEN_KEY, jiraProvider } from './jira'

export const PROVIDERS_CONFIG_ID = 'providers'

/** The host and path of a git remote in https, ssh:// or scp form (`git@host:group/project.git`). */
export function parseRemote(url: string): RepoRef | undefined {
  const trimmed = url.trim()
  const clean = (p: string) => p.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '')
  const scp = /^(?:[\w.-]+@)?([\w.-]+):(?!\/\/)(.+)$/.exec(trimmed)
  if (scp && !/^[a-z]+:\/\//i.test(trimmed)) return { host: scp[1].toLowerCase(), path: clean(scp[2]) }
  try {
    const u = new URL(trimmed)
    return u.hostname ? { host: u.hostname.toLowerCase(), path: clean(u.pathname) } : undefined
  } catch {
    return undefined
  }
}

/** Which provider a git host belongs to, by its name. Self-hosted instances with other names need an override. */
export function detectKind(host: string): ProviderKind | undefined {
  const h = host.toLowerCase()
  if (h === 'github.com' || h === 'www.github.com') return 'github'
  if (h === 'bitbucket.org') return 'bitbucket'
  if (h === 'dev.azure.com' || h === 'ssh.dev.azure.com' || h.endsWith('.visualstudio.com')) return 'azure-devops'
  if (h === 'gitlab.com' || h.startsWith('gitlab.')) return 'gitlab'
  return undefined
}

export interface ProviderSettings {
  /** forced for a host, e.g. a self-hosted GitLab at git.example.com */
  hosts: Record<string, ProviderKind>
  /** forced for one repository, keyed `host/path` */
  repos: Record<string, ProviderKind>
  gitlab?: { baseUrl: string }
  jira?: { baseUrl: string; email: string }
}

export interface ProviderStatus {
  kind: ProviderKind
  name: string
  untested: boolean
  hasToken: boolean
  baseUrl: string
  email?: string
}

export interface Resolution {
  repo: RepoRef
  kind?: ProviderKind
  /** why this kind: the repository setting, the host setting, the host's name, or nothing matched */
  by: 'repo' | 'host' | 'detected' | 'none'
}

const EMPTY: ProviderSettings = { hosts: {}, repos: {} }

export interface RegistryDeps {
  store: SourceStore
  secrets: SecretStore
  /** the GitHub provider is built by the existing GitHub login (gh CLI or token) */
  github?: () => Promise<Provider>
  fetch?: FetchFn
}

/** Which provider serves a repository, and the connections to them. */
export class ProviderRegistry {
  constructor(private readonly d: RegistryDeps) {}

  settings(): Promise<ProviderSettings> {
    return this.d.store.config<ProviderSettings>(PROVIDERS_CONFIG_ID, EMPTY).then((s) => ({ ...EMPTY, ...s }))
  }

  async update(change: (s: ProviderSettings) => ProviderSettings): Promise<ProviderSettings> {
    const next = change(await this.settings())
    await this.d.store.setConfig(PROVIDERS_CONFIG_ID, next)
    return next
  }

  /** Repository setting first, then the host setting, then the host's name (and the configured GitLab instance). */
  async resolve(remoteUrl: string): Promise<Resolution | undefined> {
    const repo = parseRemote(remoteUrl)
    if (!repo) return undefined
    const s = await this.settings()
    const forRepo = s.repos[`${repo.host}/${repo.path}`.toLowerCase()]
    if (forRepo) return { repo, kind: forRepo, by: 'repo' }
    const forHost = s.hosts[repo.host]
    if (forHost) return { repo, kind: forHost, by: 'host' }
    const detected = detectKind(repo.host)
    if (detected) return { repo, kind: detected, by: 'detected' }
    if (s.gitlab && safeHost(s.gitlab.baseUrl) === repo.host) return { repo, kind: 'gitlab', by: 'detected' }
    return { repo, by: 'none' }
  }

  setRepoKind(repo: RepoRef, kind: ProviderKind | undefined): Promise<ProviderSettings> {
    const key = `${repo.host}/${repo.path}`.toLowerCase()
    return this.update((s) => ({ ...s, repos: withKey(s.repos, key, kind) }))
  }

  setHostKind(host: string, kind: ProviderKind | undefined): Promise<ProviderSettings> {
    return this.update((s) => ({ ...s, hosts: withKey(s.hosts, host.toLowerCase(), kind) }))
  }

  /** Force (or, with undefined, un-force) the provider of one repository or of its whole host; returns the new resolution. */
  async force(remoteUrl: string, scope: 'repo' | 'host', kind: ProviderKind | undefined): Promise<Resolution | undefined> {
    const repo = parseRemote(remoteUrl)
    if (!repo) throw new Error('Not a git remote URL')
    await (scope === 'repo' ? this.setRepoKind(repo, kind) : this.setHostKind(repo.host, kind))
    return this.resolve(remoteUrl)
  }

  /** The connected provider of a kind, or undefined when it has no credentials (or is not built yet). */
  async connect(kind: ProviderKind): Promise<Provider | undefined> {
    const s = await this.settings()
    if (kind === 'github') return this.d.github?.()
    if (kind === 'gitlab') {
      const token = await this.d.secrets.get(GITLAB_TOKEN_KEY)
      return token ? gitlabProvider(s.gitlab?.baseUrl ?? GITLAB_DEFAULT_URL, token, this.d.fetch) : undefined
    }
    if (kind === 'jira') {
      const token = await this.d.secrets.get(JIRA_TOKEN_KEY)
      return token && s.jira ? jiraProvider(s.jira.baseUrl, s.jira.email, token, this.d.fetch) : undefined
    }
    return undefined
  }

  /** What the settings page shows of each provider that is entered by hand. The token itself never leaves the keychain. */
  async status(): Promise<ProviderStatus[]> {
    const s = await this.settings()
    return [
      { kind: 'gitlab', name: 'GitLab', untested: true, hasToken: !!(await this.d.secrets.get(GITLAB_TOKEN_KEY)), baseUrl: s.gitlab?.baseUrl ?? GITLAB_DEFAULT_URL },
      { kind: 'jira', name: 'Jira Cloud', untested: true, hasToken: !!(await this.d.secrets.get(JIRA_TOKEN_KEY)), baseUrl: s.jira?.baseUrl ?? '', email: s.jira?.email ?? '' }
    ]
  }

  /** Store the connection of a provider; an empty token keeps the stored one. */
  async save(kind: ProviderKind, input: { baseUrl?: string; email?: string; token?: string }): Promise<ProviderStatus[]> {
    if (kind !== 'gitlab' && kind !== 'jira') throw new Error(`${kind} cannot be set up here`)
    const baseUrl = input.baseUrl?.trim() ? cleanBaseUrl(input.baseUrl) : kind === 'gitlab' ? GITLAB_DEFAULT_URL : ''
    if (kind === 'jira' && (!baseUrl || !input.email?.trim())) throw new Error('Jira needs the site URL and the account email')
    await this.update((s) => (kind === 'gitlab' ? { ...s, gitlab: { baseUrl } } : { ...s, jira: { baseUrl, email: input.email!.trim() } }))
    if (input.token?.trim()) await this.d.secrets.set(kind === 'gitlab' ? GITLAB_TOKEN_KEY : JIRA_TOKEN_KEY, input.token.trim())
    return this.status()
  }

  async clear(kind: ProviderKind): Promise<ProviderStatus[]> {
    if (kind === 'gitlab') await this.d.secrets.delete(GITLAB_TOKEN_KEY)
    if (kind === 'jira') await this.d.secrets.delete(JIRA_TOKEN_KEY)
    return this.status()
  }

  /** A cheap authenticated call, reported as text for the settings page. Never throws. */
  async test(kind: ProviderKind): Promise<{ ok: boolean; message: string }> {
    try {
      const p = await this.connect(kind)
      if (!p) return { ok: false, message: 'Not configured: store the credentials first' }
      return { ok: true, message: `Connected as ${await p.testConnection()}` }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  }
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

function withKey<T extends string>(map: Record<string, T>, key: string, value: T | undefined): Record<string, T> {
  const { [key]: _drop, ...rest } = map
  return value ? { ...rest, [key]: value } : rest
}
