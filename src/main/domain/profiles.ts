import { openSignals } from './signal'
import type { Todo, WorkDesk } from './types'

/** Profile #1. It owns everything that carries no tag (data from before Profiles existed) and cannot be removed. */
export const DEFAULT_PROFILE_ID = 'default'
/** The view that does not filter. Only offered when there is more than one Profile. */
export const ALL_PROFILES = 'all'
/** The Status Repo inside the WorkDesk root (`<root>/workdesk-status`); it also holds the settings shared by all Profiles. */
export const HOME_REPO_ID = 'home'

/** The colour of the Default Profile: it follows the theme's main (yellow) colour until it is changed by hand. */
export const THEME_COLOR = 'theme'
/** A colour of a Profile as CSS. */
export const cssColor = (c: string): string => (c === THEME_COLOR ? 'var(--yellow)' : c)

export const PROFILE_COLORS = ['#4f9cf9', '#e5833f', '#5fbf7a', '#c76fd6', '#e0b13a', '#e05d6f', '#3fb8c4', '#8c8cf0'] as const

/** A Status Repo the app knows. The home one has no `path` (it is `<root>/workdesk-status`). */
export interface RepoRef {
  id: string
  label: string
  /** absolute folder of the git repository; empty for the home repo */
  path?: string
}

export interface Profile {
  id: string
  name: string
  color: string
  /** the Status Repo new Todos and WorkDesks of this Profile are written to */
  repoId: string
  /** the Claude Account used by WorkDesks of this Profile that have none of their own */
  claudeAccountId?: string
}

export interface ProfilesConfig {
  version: 1
  profiles: Profile[]
  repos: RepoRef[]
  /** the Profile the views show, or ALL_PROFILES */
  active: string
  /** the credentials from before Profiles were copied into the Default Profile's keychain keys */
  secretsMigrated?: boolean
}

export type ProfileView = string

export function defaultConfig(): ProfilesConfig {
  return {
    version: 1,
    profiles: [{ id: DEFAULT_PROFILE_ID, name: 'Default', color: THEME_COLOR, repoId: HOME_REPO_ID }],
    repos: [{ id: HOME_REPO_ID, label: 'workdesk-status' }],
    active: DEFAULT_PROFILE_ID
  }
}

/** Read a stored config and repair it: the Default Profile and the home repo always exist, dangling references fall back. */
export function parseConfig(raw: unknown): ProfilesConfig {
  const base = defaultConfig()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<ProfilesConfig>
  const repos: RepoRef[] = [base.repos[0]]
  for (const x of Array.isArray(r.repos) ? r.repos : []) {
    if (x && typeof x.id === 'string' && typeof x.path === 'string' && x.path && !repos.some((o) => o.id === x.id)) repos.push({ id: x.id, label: String(x.label || x.path), path: x.path })
  }
  const profiles: Profile[] = []
  for (const p of Array.isArray(r.profiles) ? r.profiles : []) {
    if (!p || typeof p.id !== 'string' || profiles.some((o) => o.id === p.id)) continue
    profiles.push({
      id: p.id,
      name: String(p.name || p.id),
      // the Default Profile was blue before it followed the theme: an untouched blue becomes the theme's colour
      color: p.id === DEFAULT_PROFILE_ID && (p.color === '#4f9cf9' || typeof p.color !== 'string') ? THEME_COLOR : typeof p.color === 'string' ? p.color : PROFILE_COLORS[profiles.length % PROFILE_COLORS.length],
      repoId: repos.some((o) => o.id === p.repoId) ? p.repoId : HOME_REPO_ID,
      ...(typeof p.claudeAccountId === 'string' && p.claudeAccountId ? { claudeAccountId: p.claudeAccountId } : {})
    })
  }
  if (!profiles.some((p) => p.id === DEFAULT_PROFILE_ID)) profiles.unshift(base.profiles[0])
  // the Default Profile is always first
  profiles.sort((a, b) => Number(b.id === DEFAULT_PROFILE_ID) - Number(a.id === DEFAULT_PROFILE_ID))
  // always one Profile in view: an "all" saved by an older version becomes the Default Profile
  const active = profiles.some((p) => p.id === r.active) ? (r.active as string) : DEFAULT_PROFILE_ID
  return { version: 1, profiles, repos, active, ...(r.secretsMigrated ? { secretsMigrated: true } : {}) }
}

const profileOf = (cfg: ProfilesConfig, id: string): Profile => {
  const p = cfg.profiles.find((x) => x.id === id)
  if (!p) throw new Error(`Unknown Profile ${id}`)
  return p
}

function cleanName(cfg: ProfilesConfig, name: string, except?: string): string {
  const n = name.trim()
  if (!n) throw new Error('A Profile needs a name')
  if (cfg.profiles.some((p) => p.id !== except && p.name.toLowerCase() === n.toLowerCase())) throw new Error(`There is a Profile called "${n}" already`)
  return n
}

export const nextColor = (cfg: ProfilesConfig): string =>
  PROFILE_COLORS.find((c) => !cfg.profiles.some((p) => p.color === c)) ?? PROFILE_COLORS[cfg.profiles.length % PROFILE_COLORS.length]

export function addProfile(cfg: ProfilesConfig, id: string, name: string, repoId = HOME_REPO_ID, color?: string): ProfilesConfig {
  const n = cleanName(cfg, name)
  if (!cfg.repos.some((r) => r.id === repoId)) throw new Error(`Unknown Status Repo ${repoId}`)
  return { ...cfg, profiles: [...cfg.profiles, { id, name: n, color: color ?? nextColor(cfg), repoId }] }
}

const patchProfile = (cfg: ProfilesConfig, id: string, patch: Partial<Profile>): ProfilesConfig => {
  profileOf(cfg, id)
  return { ...cfg, profiles: cfg.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) }
}

export const renameProfile = (cfg: ProfilesConfig, id: string, name: string): ProfilesConfig => patchProfile(cfg, id, { name: cleanName(cfg, name, id) })

export function setProfileColor(cfg: ProfilesConfig, id: string, color: string): ProfilesConfig {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('A colour looks like #4f9cf9')
  return patchProfile(cfg, id, { color })
}

export function setProfileRepo(cfg: ProfilesConfig, id: string, repoId: string): ProfilesConfig {
  if (!cfg.repos.some((r) => r.id === repoId)) throw new Error(`Unknown Status Repo ${repoId}`)
  return patchProfile(cfg, id, { repoId })
}

export function setProfileClaudeAccount(cfg: ProfilesConfig, id: string, accountId: string | null): ProfilesConfig {
  const { claudeAccountId: _, ...rest } = profileOf(cfg, id)
  return { ...cfg, profiles: cfg.profiles.map((p) => (p.id === id ? { ...rest, ...(accountId ? { claudeAccountId: accountId } : {}) } : p)) }
}

/** Removing a Profile: the Default one stays. What carried its tag is the caller's to re-tag (`retag`). */
export function removeProfile(cfg: ProfilesConfig, id: string): ProfilesConfig {
  if (id === DEFAULT_PROFILE_ID) throw new Error('The Default Profile cannot be removed')
  profileOf(cfg, id)
  const profiles = cfg.profiles.filter((p) => p.id !== id)
  const active = cfg.active === id || (cfg.active === ALL_PROFILES && profiles.length < 2) ? DEFAULT_PROFILE_ID : cfg.active
  return { ...cfg, profiles, active }
}

export function addRepo(cfg: ProfilesConfig, repo: RepoRef): ProfilesConfig {
  if (!repo.path) throw new Error('A Status Repo needs a folder')
  const same = cfg.repos.find((r) => r.path === repo.path)
  if (same) throw new Error(`That folder is the Status Repo "${same.label}" already`)
  if (cfg.repos.some((r) => r.id === repo.id)) throw new Error(`Status Repo ${repo.id} exists`)
  return { ...cfg, repos: [...cfg.repos, repo] }
}

/** Unregister a Status Repo nobody uses. The folder is never touched. */
export function forgetRepo(cfg: ProfilesConfig, id: string): ProfilesConfig {
  if (id === HOME_REPO_ID) throw new Error('The home Status Repo cannot be forgotten')
  if (cfg.profiles.some((p) => p.repoId === id)) throw new Error('A Profile still uses that Status Repo')
  return { ...cfg, repos: cfg.repos.filter((r) => r.id !== id) }
}

export function setActive(cfg: ProfilesConfig, view: ProfileView): ProfilesConfig {
  // one Profile is in view, never all of them (that mixed the Projects and logins of several): "all" changes nothing
  if (view === ALL_PROFILES) return cfg
  profileOf(cfg, view)
  return { ...cfg, active: view }
}

type Tagged = { profileId?: string }

/** The Profile something belongs to: its tag, and Profile #1 for no tag (or a tag whose Profile is gone). */
export function profileIdOf(item: Tagged, cfg: Pick<ProfilesConfig, 'profiles'>): string {
  return item.profileId && cfg.profiles.some((p) => p.id === item.profileId) ? item.profileId : DEFAULT_PROFILE_ID
}

export const inView = (item: Tagged, view: ProfileView, cfg: Pick<ProfilesConfig, 'profiles'>): boolean => view === ALL_PROFILES || profileIdOf(item, cfg) === view

export const filterByView = <T extends Tagged>(items: readonly T[], view: ProfileView, cfg: Pick<ProfilesConfig, 'profiles'>): T[] =>
  view === ALL_PROFILES ? [...items] : items.filter((i) => profileIdOf(i, cfg) === view)

/** What the sidebar, Dashboard, Work items, palette and search show. Nothing is changed or dropped from the stored data. */
export function filterState<S extends { todos: Todo[]; desks: WorkDesk[] }>(state: S, view: ProfileView, cfg: Pick<ProfilesConfig, 'profiles'>): S {
  return view === ALL_PROFILES ? state : { ...state, todos: filterByView(state.todos, view, cfg), desks: filterByView(state.desks, view, cfg) }
}

/** The Profile new Todos and WorkDesks are made for: the one in view, the Default one while all are in view. */
export const creationProfileId = (cfg: Pick<ProfilesConfig, 'active'>): string => (cfg.active === ALL_PROFILES ? DEFAULT_PROFILE_ID : cfg.active)

/** The Claude Account of a WorkDesk: its own, else its Profile's, else (undefined) the default Account. */
export function effectiveClaudeAccountId(desk: Pick<WorkDesk, 'claudeAccountId' | 'profileId'>, cfg: Pick<ProfilesConfig, 'profiles'>): string | undefined {
  return desk.claudeAccountId ?? cfg.profiles.find((p) => p.id === profileIdOf(desk, cfg))?.claudeAccountId
}

/** Open Signals per Profile, for the small badge on the selector. */
export function signalCounts(desks: readonly WorkDesk[], cfg: Pick<ProfilesConfig, 'profiles'>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const d of desks) {
    const n = openSignals(d).length
    if (n > 0) counts[profileIdOf(d, cfg)] = (counts[profileIdOf(d, cfg)] ?? 0) + n
  }
  return counts
}

/** Give everything tagged `from` the tag `to` (removing a Profile). Untagged things stay untagged. */
export const retag = <T extends Tagged>(items: readonly T[], from: string, to: string): T[] => items.map((i) => (i.profileId === from ? (to === DEFAULT_PROFILE_ID ? withoutTag(i) : { ...i, profileId: to }) : i))

function withoutTag<T extends Tagged>(item: T): T {
  const { profileId: _, ...rest } = item
  return rest as T
}

/** A new thing gets the tag of the Profile it is made for; the Default Profile's things stay untagged (the old layout, byte for byte). */
export const stampNew = <T extends Tagged>(item: T, profileId: string): T => (item.profileId || profileId === DEFAULT_PROFILE_ID ? item : { ...item, profileId })
