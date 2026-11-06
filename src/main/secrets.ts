import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Secrets (Notion/GitHub tokens) live in the macOS Keychain, never in the Status Repo. */
export interface SecretStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

const SERVICE_PREFIX = 'workdesk-'

export const keychain: SecretStore = {
  async get(key) {
    try {
      const { stdout } = await run('security', ['find-generic-password', '-s', SERVICE_PREFIX + key, '-w'])
      return stdout.replace(/\n$/, '') || undefined
    } catch {
      return undefined
    }
  },
  async set(key, value) {
    await run('security', ['add-generic-password', '-U', '-a', 'workdesk', '-s', SERVICE_PREFIX + key, '-w', value])
  },
  async delete(key) {
    await run('security', ['delete-generic-password', '-s', SERVICE_PREFIX + key]).catch(() => undefined)
  }
}

export class MemorySecrets implements SecretStore {
  private readonly map = new Map<string, string>()
  async get(key: string) {
    return this.map.get(key)
  }
  async set(key: string, value: string) {
    this.map.set(key, value)
  }
  async delete(key: string) {
    this.map.delete(key)
  }
}
