import { execFile } from 'node:child_process'
import { copyFile, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { parseChromiumBookmarks, treeFromFirefoxRows, type FirefoxRow, type ImportNode } from './domain/bookmark-import'

const run = promisify(execFile)

/** A browser profile that has bookmarks to take over. */
export interface ImportSource {
  id: string
  browser: 'vivaldi' | 'firefox'
  /** e.g. "Vivaldi: Work" */
  label: string
}

const exists = (p: string): Promise<boolean> => stat(p).then(() => true, () => false)
const dirs = async (p: string): Promise<string[]> => readdir(p, { withFileTypes: true }).then((l) => l.filter((d) => d.isDirectory()).map((d) => d.name), () => [])

/** Where the browsers keep their profiles (under the user's Library/Application Support on a Mac). */
export class BookmarkImport {
  constructor(private readonly support: string) {}

  private get vivaldi(): string {
    return join(this.support, 'Vivaldi')
  }
  private get firefox(): string {
    return join(this.support, 'Firefox', 'Profiles')
  }

  /** The name a Vivaldi profile was given, or its folder name. */
  private async vivaldiName(dir: string): Promise<string> {
    try {
      const prefs = JSON.parse(await readFile(join(this.vivaldi, dir, 'Preferences'), 'utf8')) as { profile?: { name?: string } }
      return prefs.profile?.name || dir
    } catch {
      return dir
    }
  }

  async sources(): Promise<ImportSource[]> {
    const out: ImportSource[] = []
    for (const d of await dirs(this.vivaldi)) {
      if (await exists(join(this.vivaldi, d, 'Bookmarks'))) out.push({ id: `vivaldi:${d}`, browser: 'vivaldi', label: `Vivaldi: ${await this.vivaldiName(d)}${d === 'Default' ? '' : ` (${d})`}` })
    }
    for (const d of await dirs(this.firefox)) {
      if (await exists(join(this.firefox, d, 'places.sqlite'))) out.push({ id: `firefox:${d}`, browser: 'firefox', label: `Firefox: ${d.replace(/^[a-z0-9]+\./, '')}` })
    }
    return out
  }

  /** The bookmarks of a source from `sources()`; an id that is not one of them is refused (it names a folder). */
  async read(id: string): Promise<ImportNode[]> {
    const known = (await this.sources()).find((s) => s.id === id)
    if (!known) throw new Error('Unknown bookmark source')
    const dir = id.slice(id.indexOf(':') + 1)
    if (known.browser === 'vivaldi') return parseChromiumBookmarks(JSON.parse(await readFile(join(this.vivaldi, dir, 'Bookmarks'), 'utf8')))
    return this.readFirefox(join(this.firefox, dir))
  }

  /** Firefox keeps its places database locked and half in a write-ahead log while it runs: read a copy of both. */
  private async readFirefox(profile: string): Promise<ImportNode[]> {
    const tmp = await mkdtemp(join(tmpdir(), 'workdesk-ff-'))
    try {
      for (const f of ['places.sqlite', 'places.sqlite-wal']) if (await exists(join(profile, f))) await copyFile(join(profile, f), join(tmp, f))
      const sql = 'select b.id as id, b.type as type, b.parent as parent, b.title as title, p.url as url from moz_bookmarks b left join moz_places p on p.id = b.fk order by b.parent, b.position'
      const { stdout } = await run('sqlite3', ['-readonly', '-json', join(tmp, 'places.sqlite'), sql], { maxBuffer: 64 * 1024 * 1024 })
      return treeFromFirefoxRows(stdout.trim() ? (JSON.parse(stdout) as FirefoxRow[]) : [])
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }
}
