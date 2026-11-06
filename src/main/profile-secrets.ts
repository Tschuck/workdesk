import type { SecretStore } from './secrets'

/** Keychain item of a Profile's credential: `workdesk-profile-<profile id>-<key>`. */
export const profileKey = (profileId: string, key: string): string => `profile-${profileId}-${key}`

/** The credentials of one Profile. Nothing of another Profile (nor of the single-credential layout from before Profiles) is visible through it. */
export function profileSecrets(base: SecretStore, profileId: string): SecretStore {
  return {
    get: (key) => base.get(profileKey(profileId, key)),
    set: (key, value) => base.set(profileKey(profileId, key), value),
    delete: (key) => base.delete(profileKey(profileId, key))
  }
}

/** The credentials of whichever Profile `profile()` names at the time of each call (the one in view), so the pages follow the selector. */
export function viewSecrets(base: SecretStore, profile: () => string): SecretStore {
  return {
    get: (key) => base.get(profileKey(profile(), key)),
    set: (key, value) => base.set(profileKey(profile(), key), value),
    delete: (key) => base.delete(profileKey(profile(), key))
  }
}

/**
 * The credentials of earlier versions (one set, un-namespaced) are copied into the Profile's own keys when it has none.
 * The old items are left where they are, so nothing is lost when an older version is started again. Returns the keys copied.
 * Never reads a value out to anywhere but the keychain.
 */
export async function migrateLegacySecrets(base: SecretStore, profileId: string, keys: readonly string[]): Promise<string[]> {
  const copied: string[] = []
  for (const key of keys) {
    if (await base.get(profileKey(profileId, key))) continue
    const old = await base.get(key)
    if (!old) continue
    await base.set(profileKey(profileId, key), old)
    copied.push(key)
  }
  return copied
}
