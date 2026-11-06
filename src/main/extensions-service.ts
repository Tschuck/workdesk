import { app, session as electronSession } from 'electron'
import { join } from 'node:path'
import { installExtension, loadAllExtensions, uninstallExtension, updateExtensions } from 'electron-chrome-web-store'
import { ROOT_PARTITION } from './domain/browser-sessions'
import { parseExtensionId, type InstalledExtension } from './domain/extensions'

/**
 * Chrome extensions from the Chrome Web Store for the browser Tabs. They are installed once and loaded into
 * every browser session (the shared one, those of the domain rules and those of single sites), so they work wherever a page is.
 */
export class ExtensionsService {
  private readonly path = join(app.getPath('userData'), 'Extensions')

  /** `prepare` runs for a session before extensions are loaded into it (the Chrome API of the extensions is set up there) */
  constructor(
    private readonly sessions: () => Electron.Session[],
    private readonly prepare: (s: Electron.Session) => void = () => undefined
  ) {}

  private get root(): Electron.Session {
    return electronSession.fromPartition(ROOT_PARTITION)
  }

  /** the sessions of single domains, which come into being when a page first opens there */
  private readonly late = new Set<Electron.Session>()
  private queue: Promise<void> = Promise.resolve()
  private readonly loaded = new Set<Electron.Session>()

  private all(): Electron.Session[] {
    return [...this.sessions(), ...this.late]
  }

  private others(): Electron.Session[] {
    return this.all().filter((s) => s !== this.root)
  }

  /** One session after the other: an extension's worker that starts in two sessions at once can fail to start. */
  private loadInto(s: Electron.Session): Promise<void> {
    this.prepare(s)
    this.queue = this.queue
      .then(() => loadAllExtensions(s, this.path))
      .then(
        () => void this.loaded.add(s),
        (err) => console.error('extensions:', err)
      )
    return this.queue
  }

  /** A session that is new gets the installed extensions too. */
  async ensure(s: Electron.Session): Promise<void> {
    if (this.late.has(s) || this.sessions().includes(s)) return
    this.late.add(s)
    await this.loadInto(s)
  }

  /** Load what was installed before, into the sessions that do not have it yet. */
  async load(): Promise<void> {
    for (const s of this.all()) if (!this.loaded.has(s) && !this.late.has(s)) await this.loadInto(s)
  }

  list(): InstalledExtension[] {
    return this.root.extensions
      .getAllExtensions()
      .map((e) => ({ id: e.id, name: e.name, version: e.version }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async install(input: string): Promise<InstalledExtension[]> {
    const id = parseExtensionId(input)
    if (!id) throw new Error('Paste the address of the extension in the Chrome Web Store, or its 32-letter id')
    await installExtension(id, { session: this.root, extensionsPath: this.path })
    for (const s of this.others()) await this.loadInto(s)
    return this.list()
  }

  async remove(id: string): Promise<InstalledExtension[]> {
    await uninstallExtension(id, { session: this.root, extensionsPath: this.path })
    for (const s of this.others()) {
      try {
        s.extensions.removeExtension(id)
      } catch {
        // it was not loaded there
      }
    }
    return this.list()
  }

  /** Updates reach the other sessions at the next start. */
  async update(): Promise<InstalledExtension[]> {
    await updateExtensions(this.root)
    return this.list()
  }
}
