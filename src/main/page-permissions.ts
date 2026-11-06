import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export { askableOrigin, mayAsk, PERMISSION_LABEL, wanted, type Grant, type PagePermission } from './domain/page-origin'
import { askableOrigin, type Grant, type PagePermission } from './domain/page-origin'

/** Answers kept for the next visit: only "allow" is kept, a refusal is asked again. */
export interface GrantStore {
  load(): Promise<Grant[]>
  save(grants: Grant[]): Promise<void>
}

export class FileGrantStore implements GrantStore {
  constructor(private readonly file: string) {}
  async load(): Promise<Grant[]> {
    try {
      const j = JSON.parse(await readFile(this.file, 'utf8'))
      return Array.isArray(j) ? j.filter((g): g is Grant => typeof g?.origin === 'string' && ['camera', 'microphone', 'screen'].includes(g?.permission)) : []
    } catch {
      return []
    }
  }
  async save(grants: Grant[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(grants, null, 2) + '\n')
  }
}

export class PagePermissions {
  private grants: Grant[] = []
  /** one question at a time per page, however many requests the page makes */
  private asking = new Map<string, Promise<boolean>>()

  constructor(
    private readonly store: GrantStore,
    /** asks the user; true allows and remembers */
    private readonly ask: (origin: string, what: PagePermission[]) => Promise<boolean>
  ) {}

  async load(): Promise<void> {
    this.grants = await this.store.load()
  }

  list(): Grant[] {
    return [...this.grants].sort((a, b) => a.origin.localeCompare(b.origin) || a.permission.localeCompare(b.permission))
  }

  has(origin: string, permission: PagePermission): boolean {
    return this.grants.some((g) => g.origin === origin && g.permission === permission)
  }

  /** For checks that must not ask (is the camera usable at all?). */
  isAllowed(originOrUrl: string, what: PagePermission[]): boolean {
    const origin = askableOrigin(originOrUrl)
    return !!origin && what.length > 0 && what.every((p) => this.has(origin, p))
  }

  /** Allow without asking, when the user sets it in the page's site settings. */
  async allow(origin: string, permission: PagePermission): Promise<Grant[]> {
    const o = askableOrigin(origin)
    if (o && !this.has(o, permission)) {
      this.grants.push({ origin: o, permission })
      await this.store.save(this.grants)
    }
    return this.list()
  }

  async revoke(origin: string, permission: PagePermission): Promise<Grant[]> {
    this.grants = this.grants.filter((g) => !(g.origin === origin && g.permission === permission))
    await this.store.save(this.grants)
    return this.list()
  }

  /** Allowed if it was before; otherwise the user is asked, once at a time. */
  request(originOrUrl: string, what: PagePermission[]): Promise<boolean> {
    const origin = askableOrigin(originOrUrl)
    if (!origin || what.length === 0) return Promise.resolve(false)
    if (what.every((p) => this.has(origin, p))) return Promise.resolve(true)
    const key = origin + '|' + what.join(',')
    const open = this.asking.get(key)
    if (open) return open
    const answer = this.ask(origin, what).then(async (yes) => {
      if (yes) {
        for (const p of what) if (!this.has(origin, p)) this.grants.push({ origin, permission: p })
        await this.store.save(this.grants)
      }
      return yes
    })
    const done = answer.finally(() => this.asking.delete(key))
    this.asking.set(key, done)
    return done
  }
}
