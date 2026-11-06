import type { ProfilesConfig } from './domain/profiles'
import { profileSecrets } from './profile-secrets'
import type { SecretStore } from './secrets'
import { GITHUB_TOKEN_KEY } from './sources/github/transport'
import { NOTION_CREDS_KEY } from './sources/notion/oauth'
import { GITLAB_TOKEN_KEY } from './sources/providers/gitlab'
import { JIRA_TOKEN_KEY } from './sources/providers/jira'

/** Which credentials a Profile has. Only whether they exist: a value never leaves the keychain. */
export interface ProfileCredentials {
  github: boolean
  notion: boolean
  gitlab: boolean
  jira: boolean
}

export type CredentialKind = keyof ProfileCredentials

/** The keychain keys of the credentials, by kind (also the ones of the single-credential layout from before Profiles). */
export const CREDENTIAL_KEYS: Record<CredentialKind, string> = {
  github: GITHUB_TOKEN_KEY,
  notion: NOTION_CREDS_KEY,
  gitlab: GITLAB_TOKEN_KEY,
  jira: JIRA_TOKEN_KEY
}

export const LEGACY_SECRET_KEYS: string[] = Object.values(CREDENTIAL_KEYS)

export async function credentialsOf(base: SecretStore, profileId: string): Promise<ProfileCredentials> {
  const s = profileSecrets(base, profileId)
  const has = async (k: CredentialKind) => !!(await s.get(CREDENTIAL_KEYS[k]))
  return { github: await has('github'), notion: await has('notion'), gitlab: await has('gitlab'), jira: await has('jira') }
}

/** Remove every credential of a Profile (when the Profile is removed). */
export async function forgetCredentials(base: SecretStore, profileId: string): Promise<void> {
  const s = profileSecrets(base, profileId)
  for (const k of LEGACY_SECRET_KEYS) await s.delete(k)
}

/** Store a token for one Profile; GitHub, GitLab and Jira take a plain token (Notion connects through its own OAuth page). */
export async function setProfileToken(base: SecretStore, profileId: string, kind: CredentialKind, token: string): Promise<void> {
  if (kind === 'notion') throw new Error('Notion is connected on its own page while this Profile is selected')
  if (!token.trim()) throw new Error('The token is empty')
  await profileSecrets(base, profileId).set(CREDENTIAL_KEYS[kind], token.trim())
}

export async function clearProfileToken(base: SecretStore, profileId: string, kind: CredentialKind): Promise<void> {
  await profileSecrets(base, profileId).delete(CREDENTIAL_KEYS[kind])
}

/** A Status Repo as the Settings page shows it. */
export interface RepoInfo {
  id: string
  label: string
  path: string
  remote: string | null
  available: boolean
  error?: string
  /** how many Todos and WorkDesks live in it */
  todos: number
  desks: number
  /** the Profiles that write their new things to it */
  profileIds: string[]
}

/** What the Settings → Profiles page shows. */
export interface ProfilesState {
  config: ProfilesConfig
  repos: RepoInfo[]
  credentials: Record<string, ProfileCredentials>
  /** how many Projects are listed under each Profile */
  projects: Record<string, number>
  /** every registered Project and the Profile it is listed under */
  projectList: { name: string; profileId: string }[]
}
