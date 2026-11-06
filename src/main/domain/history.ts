/** A page that was visited in the browser: how often and when last. */
export interface HistoryEntry {
  url: string
  title: string
  visits: number
  /** ms since 1970 */
  last: number
}

export const MAX_HISTORY = 20_000
const DAY = 86_400_000

/** Only pages a browser pane can show and that say something: no blank page, no scripts. */
export const isHistoryUrl = (url: string): boolean => /^https?:\/\/\S+$/i.test(url)

/** The address without what makes the same page look different: a fragment, a trailing slash. */
export const historyKey = (url: string): string => url.replace(/#.*$/, '').replace(/(?<=[^/:])\/+$/, '')

/** A visit: the page's entry is counted and moved to now, or made. Over the limit the least recently visited ones go. */
export function recordVisit(entries: Map<string, HistoryEntry>, url: string, title: string | undefined, now: number): void {
  if (!isHistoryUrl(url)) return
  const key = historyKey(url)
  const known = entries.get(key)
  entries.set(key, { url: known?.url ?? url, title: title?.trim() || known?.title || '', visits: (known?.visits ?? 0) + 1, last: now })
  if (entries.size > MAX_HISTORY) {
    const oldest = [...entries.values()].sort((a, b) => a.last - b.last).slice(0, entries.size - MAX_HISTORY + 500)
    for (const e of oldest) entries.delete(historyKey(e.url))
  }
}

/** A page told its title (after the visit was recorded). */
export function recordTitle(entries: Map<string, HistoryEntry>, url: string, title: string): void {
  const known = entries.get(historyKey(url))
  if (known && title.trim()) known.title = title.trim()
}

/** The visited pages for an overview: the newest visit first, narrowed to the ones that have every typed word in the title or the address. */
export function listHistory(entries: Iterable<HistoryEntry>, query: string, limit = 500): HistoryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return [...entries]
    .filter((e) => words.every((w) => e.title.toLowerCase().includes(w) || e.url.toLowerCase().includes(w)))
    .sort((a, b) => b.last - a.last)
    .slice(0, limit)
}

/** Takes one page out of the history; false when it was not there. */
export const forgetVisit = (entries: Map<string, HistoryEntry>, url: string): boolean => entries.delete(historyKey(url))

/** Takes out the pages whose last visit was on the day that starts at `dayStart` (local midnight); returns how many. */
export function forgetDay(entries: Map<string, HistoryEntry>, dayStart: number): number {
  const end = new Date(dayStart).setDate(new Date(dayStart).getDate() + 1)
  let n = 0
  for (const [key, e] of entries) if (e.last >= dayStart && e.last < end) (entries.delete(key), n++)
  return n
}

/** Takes out the pages not visited for `days` days (local midnight of that day and older); 0 keeps everything. Returns how many. */
export function forgetOlderThan(entries: Map<string, HistoryEntry>, days: number, now: number): number {
  if (!(days > 0)) return 0
  const cutoff = new Date(now).setHours(0, 0, 0, 0) - (days - 1) * DAY
  let n = 0
  for (const [key, e] of entries) if (e.last < cutoff) (entries.delete(key), n++)
  return n
}

/** The local midnight that starts the day of a visit. */
export const dayStart = (at: number): number => new Date(at).setHours(0, 0, 0, 0)

/** The day a visit belongs to, for the headings of an overview: Today, Yesterday, or the date. */
export function dayLabel(at: number, now: number): string {
  const start = (t: number): number => new Date(new Date(t).setHours(0, 0, 0, 0)).getTime()
  const days = Math.round((start(now) - start(at)) / DAY)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return new Date(at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: new Date(at).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' })
}

/**
 * The visited pages that fit what was typed (every word in the title or the address), best first: a word at the start of the
 * title or of the host counts most, then how often and how recently the page was visited.
 */
export function searchHistory(entries: Iterable<HistoryEntry>, query: string, now: number, limit = 8): HistoryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const scored: { e: HistoryEntry; s: number }[] = []
  for (const e of entries) {
    const title = e.title.toLowerCase()
    const url = e.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '')
    if (!words.every((w) => title.includes(w) || url.includes(w))) continue
    let s = 0
    for (const w of words) s += title.startsWith(w) || url.startsWith(w) ? 4 : title.split(/[^\\p{L}\\p{N}]+/u).some((t) => t.startsWith(w)) ? 3 : title.includes(w) ? 2 : 1
    // used often and lately: logarithmic in visits, fading over weeks
    s += Math.log2(e.visits + 1) * 1.5 + 3 / (1 + Math.max(0, now - e.last) / (7 * DAY))
    scored.push({ e, s })
  }
  return scored.sort((a, b) => b.s - a.s || b.e.last - a.e.last).slice(0, limit).map((x) => x.e)
}
