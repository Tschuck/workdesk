import { describe, expect, it } from 'vitest'
import { CREDENTIAL_KEYS, LEGACY_SECRET_KEYS, clearProfileToken, credentialsOf, forgetCredentials, setProfileToken } from './profiles-ipc'
import { migrateLegacySecrets, profileKey, profileSecrets, viewSecrets } from './profile-secrets'
import { MemorySecrets } from './secrets'
import { SourceStore } from './sources/store'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('credentials per Profile', () => {
  it('keeps the credentials of two Profiles apart', async () => {
    const base = new MemorySecrets()
    await profileSecrets(base, 'a').set('github-token', 'tok-a')
    await profileSecrets(base, 'b').set('github-token', 'tok-b')
    expect(await profileSecrets(base, 'a').get('github-token')).toBe('tok-a')
    expect(await profileSecrets(base, 'b').get('github-token')).toBe('tok-b')
    expect(await base.get('github-token')).toBeUndefined()
    expect(await base.get(profileKey('a', 'github-token'))).toBe('tok-a')
    await profileSecrets(base, 'a').delete('github-token')
    expect(await profileSecrets(base, 'b').get('github-token')).toBe('tok-b')
  })

  it('the view follows the Profile in view at each call', async () => {
    const base = new MemorySecrets()
    let view = 'a'
    const s = viewSecrets(base, () => view)
    await s.set('k', 'va')
    view = 'b'
    expect(await s.get('k')).toBeUndefined()
    await s.set('k', 'vb')
    view = 'a'
    expect(await s.get('k')).toBe('va')
  })

  it('moves the single credentials from before Profiles into Profile #1 without losing them', async () => {
    const base = new MemorySecrets()
    await base.set(CREDENTIAL_KEYS.github, 'old-gh')
    await base.set(CREDENTIAL_KEYS.jira, 'old-jira')
    const copied = await migrateLegacySecrets(base, 'default', LEGACY_SECRET_KEYS)
    expect(copied.sort()).toEqual([CREDENTIAL_KEYS.github, CREDENTIAL_KEYS.jira].sort())
    expect(await profileSecrets(base, 'default').get(CREDENTIAL_KEYS.github)).toBe('old-gh')
    expect(await profileSecrets(base, 'default').get(CREDENTIAL_KEYS.jira)).toBe('old-jira')
    // the old items stay, so an older version still finds them
    expect(await base.get(CREDENTIAL_KEYS.github)).toBe('old-gh')
    expect(await credentialsOf(base, 'default')).toEqual({ github: true, notion: false, gitlab: false, jira: true })
    expect(await credentialsOf(base, 'other')).toEqual({ github: false, notion: false, gitlab: false, jira: false })
  })

  it('a second run never overwrites what the Profile has since set itself', async () => {
    const base = new MemorySecrets()
    await base.set(CREDENTIAL_KEYS.github, 'old')
    await profileSecrets(base, 'default').set(CREDENTIAL_KEYS.github, 'newer')
    expect(await migrateLegacySecrets(base, 'default', LEGACY_SECRET_KEYS)).toEqual([])
    expect(await profileSecrets(base, 'default').get(CREDENTIAL_KEYS.github)).toBe('newer')
  })

  it('sets, clears and forgets tokens of a Profile; Notion needs its own page', async () => {
    const base = new MemorySecrets()
    await setProfileToken(base, 'b', 'gitlab', ' glpat ')
    expect(await profileSecrets(base, 'b').get(CREDENTIAL_KEYS.gitlab)).toBe('glpat')
    await expect(setProfileToken(base, 'b', 'github', '  ')).rejects.toThrow(/empty/)
    await expect(setProfileToken(base, 'b', 'notion', 'x')).rejects.toThrow(/Notion/)
    await clearProfileToken(base, 'b', 'gitlab')
    expect((await credentialsOf(base, 'b')).gitlab).toBe(false)
    await setProfileToken(base, 'b', 'github', 't')
    await forgetCredentials(base, 'b')
    expect(await credentialsOf(base, 'b')).toEqual({ github: false, notion: false, gitlab: false, jira: false })
  })
})

describe('Source settings per Profile', () => {
  it('Profile #1 keeps the original files, another Profile has its own', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'workdesk-ss-'))
    let view = 'default'
    const store = new SourceStore(dir, undefined, () => view)
    await store.markSkipped('github-prs', 'a#1')
    view = 'b'
    expect(await store.skipped('github-prs')).toEqual([])
    await store.markSkipped('github-prs', 'b#2')
    expect(await readdir(join(dir, 'sources', 'github-prs'))).toEqual(['profile-b', 'skipped.json'])
    view = 'default'
    expect(await store.skipped('github-prs')).toEqual(['a#1'])
  })
})
