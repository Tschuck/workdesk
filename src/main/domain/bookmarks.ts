export interface Bookmark {
  id: string
  title: string
  url: string
  /** the page's icon, kept here (a data: address) so favorites show it without loading the page */
  favicon?: string
  /** the group it is listed under; none: the ungrouped favorites */
  group?: string
}

/** Only pages a browser Tab can show; no javascript:, file: or app URLs. */
export const isBookmarkable = (url: string): boolean => /^https?:\/\/\S+$/i.test(url)

/** Where a bookmark with this URL is, regardless of a trailing slash or fragment. */
const key = (url: string): string => url.replace(/#.*$/, '').replace(/\/+$/, '')

export const findBookmark = (list: readonly Bookmark[], url: string): Bookmark | undefined => list.find((b) => key(b.url) === key(url))

/** Adds a page; one that is already there only gets the new title. */
export function addBookmark(list: readonly Bookmark[], title: string, url: string, id: string, favicon?: string): Bookmark[] {
  if (!isBookmarkable(url)) throw new Error('Only http and https pages can be bookmarked')
  const name = title.trim() || url
  const known = findBookmark(list, url)
  if (known) return list.map((b) => (b === known ? { ...b, title: name, ...(favicon ? { favicon } : {}) } : b))
  return [...list, { id, title: name, url, ...(favicon ? { favicon } : {}) }]
}

export const removeBookmark = (list: readonly Bookmark[], id: string): Bookmark[] => list.filter((b) => b.id !== id)

export function renameBookmark(list: readonly Bookmark[], id: string, title: string): Bookmark[] {
  const name = title.trim()
  if (!name) throw new Error('A bookmark needs a name')
  return list.map((b) => (b.id === id ? { ...b, title: name } : b))
}

/** Points a bookmark at another address (https is assumed for a bare one). The icon goes when the host changes, the page tells its own again. */
export function setBookmarkUrl(list: readonly Bookmark[], id: string, address: string): Bookmark[] {
  const raw = address.trim()
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^(javascript|data|file|about|blob):/i.test(raw) ? raw : `https://${raw}`
  if (!isBookmarkable(url)) throw new Error('Only http and https pages can be bookmarked')
  const other = findBookmark(list, url)
  if (other && other.id !== id) throw new Error(`Already a favorite: ${other.title}`)
  const host = (u: string): string => u.replace(/^https?:\/\//i, '').split(/[/?#]/)[0].toLowerCase()
  return list.map((b) => {
    if (b.id !== id) return b
    const { favicon, ...rest } = b
    return { ...rest, url, ...(favicon && host(b.url) === host(url) ? { favicon } : {}) }
  })
}

/** Lists a bookmark under a group (an empty name takes it out of its group). */
export function setBookmarkGroup(list: readonly Bookmark[], id: string, group: string): Bookmark[] {
  const name = group.trim()
  return list.map((b) => {
    if (b.id !== id) return b
    const { group: _old, ...rest } = b
    return name ? { ...rest, group: name } : rest
  })
}

/** Gives every bookmark of a group another group name; a name that exists already merges the two. An empty name ungroups them. */
export function renameGroup(list: readonly Bookmark[], from: string, to: string): Bookmark[] {
  return list.map((b) => (b.group === from ? setBookmarkGroup([b], b.id, to)[0] : b))
}

/** The bookmarks that match what was typed (title, address or group, every word), in the order given. */
export function filterBookmarks(list: readonly Bookmark[], query: string): Bookmark[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return list.filter((b) => {
    const text = `${b.title} ${b.url} ${b.group ?? ''}`.toLowerCase()
    return words.every((w) => text.includes(w))
  })
}

const tokens = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/**
 * The favorites that fit what was typed, best first. A word that is (the start of) a word of a group's name makes that
 * **category** a match: the whole category is shown, ahead of everything else. In order:
 * 1. entries of a matching category that fit every word ("acme portal": `portal demo` of the group `acme`),
 * 2. the other entries of that category,
 * 3. entries that fit every word through their title, address or group without being in a matching category.
 * Inside a step a word at the start of the title ranks above one inside it, above one only in the address; ties keep the list's order.
 */
export function rankBookmarks(list: readonly Bookmark[], query: string): Bookmark[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...list]
  const ranked: { b: Bookmark; step: number; score: number; at: number }[] = []
  list.forEach((b, at) => {
    const title = b.title.toLowerCase()
    const url = b.url.toLowerCase()
    const group = (b.group ?? '').toLowerCase()
    const groupWords = tokens(group)
    const inCategory = words.some((w) => w.length >= 2 && groupWords.some((g) => g.startsWith(w)))
    const fits = words.every((w) => title.includes(w) || url.includes(w) || group.includes(w))
    if (!fits && !inCategory) return
    const titleWords = tokens(title)
    let score = 0
    for (const w of words) score += title.startsWith(w) ? 4 : titleWords.some((t) => t.startsWith(w)) ? 3 : title.includes(w) ? 2 : url.includes(w) ? 1 : 0
    ranked.push({ b, step: inCategory ? (fits ? 0 : 1) : 2, score, at })
  })
  return ranked.sort((x, y) => x.step - y.step || y.score - x.score || x.at - y.at).map((r) => r.b)
}

/** Sections by group in the order the first of their entries comes (ungrouped last, under ''), for a list that is already ranked. */
export function sectionsInOrder(list: readonly Bookmark[]): { group: string; items: Bookmark[] }[] {
  const sections: { group: string; items: Bookmark[] }[] = []
  for (const b of list) {
    const group = b.group ?? ''
    const section = sections.find((s) => s.group === group)
    if (section) section.items.push(b)
    else sections.push({ group, items: [b] })
  }
  return [...sections.filter((s) => s.group !== ''), ...sections.filter((s) => s.group === '')]
}

/** The bookmarks as sections: named groups by name, then the ungrouped ones (group ''). Empty groups do not appear. */
export function groupBookmarks(list: readonly Bookmark[]): { group: string; items: Bookmark[] }[] {
  const names = [...new Set(list.map((b) => b.group ?? ''))].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
  return names.map((group) => ({ group, items: list.filter((b) => (b.group ?? '') === group) }))
}

/** The icon of a bookmarked page, when it has none yet (a kept icon is not replaced by every visit). */
export const setBookmarkIcon = (list: readonly Bookmark[], url: string, favicon: string): Bookmark[] => {
  const known = findBookmark(list, url)
  return known && !known.favicon ? list.map((b) => (b === known ? { ...b, favicon } : b)) : [...list]
}

/** What is read from bookmarks.json: anything unusable is left out. */
export function parseBookmarks(data: unknown): Bookmark[] {
  if (!Array.isArray(data)) return []
  return data
    .filter((b): b is Bookmark => !!b && typeof b.id === 'string' && typeof b.title === 'string' && typeof b.url === 'string' && isBookmarkable(b.url))
    .map((b) => ({ id: b.id, title: b.title, url: b.url, ...(typeof b.favicon === 'string' && b.favicon ? { favicon: b.favicon } : {}), ...(typeof b.group === 'string' && b.group.trim() ? { group: b.group.trim() } : {}) }))
}
