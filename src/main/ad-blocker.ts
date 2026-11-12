import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FiltersEngine, Request } from '@ghostery/adblocker'
import { blockLevelForHost, NO_SESSIONS, type BlockLevel, type BrowserSessionsConfig } from './domain/browser-sessions'

/** Filter lists per level; ads include the tracker lists. */
export const LISTS: Record<Exclude<BlockLevel, 'off'>, string[]> = {
  trackers: ['https://easylist.to/easylist/easyprivacy.txt'],
  ads: [
    'https://easylist.to/easylist/easylist.txt',
    'https://easylist.to/easylist/easyprivacy.txt',
    'https://secure.fanboy.co.nz/fanboy-annoyance.txt',
    'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext'
  ]
}

const MAX_AGE_MS = 7 * 24 * 3600 * 1000

export interface BlockDetails {
  url: string
  resourceType?: string
  referrer?: string
  webContents?: { getURL(): string } | null
}

/** The host of the page a request is for (its web contents, else the referrer): its site may have a level of its own. */
export function pageHostOf(details: BlockDetails): string {
  try {
    return new URL(details.webContents?.getURL() || details.referrer || '').hostname
  } catch {
    return ''
  }
}

/** Should this request be cancelled? Pure on top of an engine, so it can be tested with a fake one. */
export function shouldBlock(engine: Pick<FiltersEngine, 'match'> | undefined, details: BlockDetails): boolean {
  if (!engine || !/^(https?|wss?):/i.test(details.url) || details.resourceType === 'mainFrame') return false
  const sourceUrl = details.webContents?.getURL() || details.referrer || undefined
  const request = Request.fromRawDetails({ url: details.url, sourceUrl, type: (details.resourceType ?? 'other') as never })
  return engine.match(request).match
}

/**
 * Blocks requests of pages to known trackers and ads before they are sent (like Vivaldi's blocker): the lists are
 * downloaded once a week, kept compiled on disk, and checked in `onBeforeRequest` of every page session.
 */
export class AdBlocker {
  private config: BrowserSessionsConfig = NO_SESSIONS
  private readonly engines = new Map<BlockLevel, FiltersEngine>()
  private readonly loading = new Map<BlockLevel, Promise<void>>()
  private readonly sessions = new Set<Electron.Session>()
  /** asked for every request of a page's main frame first: true cancels it (the page is blocked, and has been told so) */
  guard?: (details: Electron.OnBeforeRequestListenerDetails) => boolean

  constructor(
    private readonly cacheDir: string,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  /** The level of all pages and the ones sites have of their own (Settings → Browser, and a page's Site settings). */
  setConfig(config: BrowserSessionsConfig): void {
    this.config = config
    const levels = new Set([config.blocking ?? 'off', ...Object.values(config.siteBlocking ?? {})])
    for (const level of levels) if (level !== 'off') void this.ensure(level).catch((err) => console.error('tracker lists unavailable:', err))
  }

  /** Check every request of this session. */
  attach(sess: Electron.Session): void {
    if (this.sessions.has(sess)) return
    this.sessions.add(sess)
    sess.webRequest.onBeforeRequest((details, callback) => {
      if (details.resourceType === 'mainFrame' && this.guard) {
        try {
          if (this.guard(details)) return callback({ cancel: true })
        } catch {
          // a guard that fails lets the page through
        }
      }
      let cancel = false
      try {
        const level = blockLevelForHost(this.config, pageHostOf(details))
        cancel = level !== 'off' && shouldBlock(this.engines.get(level), details)
      } catch {
        // a request the engine cannot read is let through
      }
      callback({ cancel })
    })
  }

  private ensure(level: Exclude<BlockLevel, 'off'>): Promise<void> {
    if (this.engines.has(level)) return Promise.resolve()
    let p = this.loading.get(level)
    if (!p) {
      p = this.load(level).finally(() => this.loading.delete(level))
      this.loading.set(level, p)
    }
    return p
  }

  private async load(level: Exclude<BlockLevel, 'off'>): Promise<void> {
    const file = join(this.cacheDir, `${level}.bin`)
    let fresh = false
    try {
      this.engines.set(level, FiltersEngine.deserialize(new Uint8Array(await readFile(file))))
      fresh = Date.now() - (await stat(file)).mtimeMs < MAX_AGE_MS
    } catch {
      // not downloaded yet, or unreadable: download
    }
    if (fresh) return
    try {
      const engine = await FiltersEngine.fromLists(this.fetchFn, LISTS[level])
      this.engines.set(level, engine)
      await mkdir(this.cacheDir, { recursive: true })
      await writeFile(file, engine.serialize())
    } catch (err) {
      if (!this.engines.has(level)) throw err
    }
  }
}
