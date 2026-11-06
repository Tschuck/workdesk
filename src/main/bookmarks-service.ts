import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseGroupSettings, renameInSettings, type GroupSettings } from './domain/bookmark-groups'
import { importBookmarks, type ImportItem } from './domain/bookmark-import'
import { addBookmark, findBookmark, parseBookmarks, removeBookmark, renameBookmark, renameGroup, setBookmarkGroup, setBookmarkIcon, setBookmarkUrl, type Bookmark } from './domain/bookmarks'

/** Bookmarks of the browser Tabs, in `bookmarks.json` of the Status Repo: the same ones in every WorkDesk and on the Browser page. */
export class BookmarksService {
  constructor(
    private readonly statusDir: string,
    private readonly onWrite: () => void = () => undefined,
    /** turns the address of an icon into a data: address that can be kept; undefined when it cannot be read */
    private readonly cacheIcon: (src: string) => Promise<string | undefined> = async (src) => (src.startsWith('data:') ? src : undefined)
  ) {}

  private get file(): string {
    return join(this.statusDir, 'bookmarks.json')
  }

  private get groupsFile(): string {
    return join(this.statusDir, 'bookmark-groups.json')
  }

  /** The order of the groups and which ones are closed; kept beside the bookmarks. */
  async groupSettings(): Promise<GroupSettings> {
    try {
      return parseGroupSettings(JSON.parse(await readFile(this.groupsFile, 'utf8')))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' || err instanceof SyntaxError) return parseGroupSettings(undefined)
      throw err
    }
  }

  async setGroupSettings(s: GroupSettings): Promise<GroupSettings> {
    const clean = parseGroupSettings(s)
    await mkdir(this.statusDir, { recursive: true })
    await writeFile(this.groupsFile, JSON.stringify(clean, null, 2) + '\n')
    this.onWrite()
    return clean
  }

  async list(): Promise<Bookmark[]> {
    try {
      return parseBookmarks(JSON.parse(await readFile(this.file, 'utf8')))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' || err instanceof SyntaxError) return []
      throw err
    }
  }

  private async save(list: Bookmark[]): Promise<Bookmark[]> {
    await mkdir(this.statusDir, { recursive: true })
    await writeFile(this.file, JSON.stringify(list, null, 2) + '\n')
    this.onWrite()
    return list
  }

  async add(title: string, url: string, favicon?: string): Promise<Bookmark[]> {
    const icon = favicon ? await this.cacheIcon(favicon).catch(() => undefined) : undefined
    return this.save(addBookmark(await this.list(), title, url, randomUUID(), icon))
  }

  /** A bookmarked page told its icon: kept when the bookmark has none yet. */
  async icon(url: string, favicon: string): Promise<Bookmark[]> {
    const list = await this.list()
    const known = findBookmark(list, url)
    if (!known || known.favicon) return list
    const icon = await this.cacheIcon(favicon).catch(() => undefined)
    return icon ? this.save(setBookmarkIcon(await this.list(), url, icon)) : list
  }

  async remove(id: string): Promise<Bookmark[]> {
    return this.save(removeBookmark(await this.list(), id))
  }

  async group(id: string, group: string): Promise<Bookmark[]> {
    return this.save(setBookmarkGroup(await this.list(), id, group))
  }

  /** Pages taken over from another browser; the ones that are favorites already stay as they are. */
  async importItems(items: ImportItem[]): Promise<{ list: Bookmark[]; added: number; skipped: number }> {
    const r = importBookmarks(await this.list(), items, randomUUID)
    if (r.added > 0) await this.save(r.list)
    return r
  }

  /** A group gets another name, in the bookmarks and in the order / closed state of the groups. */
  async renameGroup(from: string, to: string): Promise<Bookmark[]> {
    const name = to.trim()
    if (!from || !name || name === from) return this.list()
    const list = await this.save(renameGroup(await this.list(), from, name))
    await this.setGroupSettings(renameInSettings(await this.groupSettings(), from, name))
    return list
  }

  async setUrl(id: string, url: string): Promise<Bookmark[]> {
    return this.save(setBookmarkUrl(await this.list(), id, url))
  }

  async rename(id: string, title: string): Promise<Bookmark[]> {
    return this.save(renameBookmark(await this.list(), id, title))
  }
}
