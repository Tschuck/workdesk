import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { forgetDay, forgetOlderThan, forgetVisit, listHistory, recordTitle, recordVisit, searchHistory, type HistoryEntry } from './domain/history'

/**
 * The pages visited in the browser panes and on the Browser page, kept on this machine only (never in the Status Repo):
 * for the suggestions of the address bar and the new tab picker. Written a few seconds after a change.
 */
export class HistoryService {
  private readonly entries = new Map<string, HistoryEntry>()
  private timer?: ReturnType<typeof setTimeout>
  /** history is kept (the setting is read now and then, so it can be switched off while the app runs) */
  enabled: () => boolean = () => true

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
    private readonly delayMs = 5000
  ) {}

  async load(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8')) as { entries?: HistoryEntry[] }
      for (const e of data.entries ?? []) {
        if (e && typeof e.url === 'string') recordVisit(this.entries, e.url, e.title, e.last)
        const kept = this.entries.get(e.url)
        if (kept) Object.assign(kept, { visits: Number(e.visits) || 1, last: Number(e.last) || this.now(), title: String(e.title ?? '') })
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err
    }
  }

  visit(url: string, title?: string): void {
    if (!this.enabled()) return
    recordVisit(this.entries, url, title, this.now())
    this.later()
  }

  titled(url: string, title: string): void {
    if (!this.enabled()) return
    recordTitle(this.entries, url, title)
    this.later()
  }

  search(query: string, limit = 8): HistoryEntry[] {
    return searchHistory(this.entries.values(), query, this.now(), limit)
  }

  /** the overview: newest first, optionally narrowed by what was typed */
  list(query = '', limit = 500): HistoryEntry[] {
    return listHistory(this.entries.values(), query, limit)
  }

  async forget(url: string): Promise<void> {
    if (forgetVisit(this.entries, url)) this.later()
  }

  /** forgets what was last visited on one day (its local midnight) */
  async forgetDay(dayStart: number): Promise<void> {
    if (forgetDay(this.entries, dayStart) > 0) this.later()
  }

  /** forgets pages not visited for `days` days; 0 keeps everything */
  async prune(days: number): Promise<void> {
    if (forgetOlderThan(this.entries, days, this.now()) > 0) this.later()
  }

  count(): number {
    return this.entries.size
  }

  async clear(): Promise<void> {
    this.entries.clear()
    await this.flush()
  }

  /** writes at once (when the app quits) */
  async flush(): Promise<void> {
    clearTimeout(this.timer)
    this.timer = undefined
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify({ entries: [...this.entries.values()] }) + '\n')
  }

  private later(): void {
    if (this.timer) return
    this.timer = setTimeout(() => void this.flush().catch(() => undefined), this.delayMs)
  }
}
