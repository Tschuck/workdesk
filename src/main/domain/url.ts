/** Search engines a typed term can go to; Startpage is the default. */
export const SEARCH_ENGINES = [
  { id: 'startpage', name: 'Startpage', url: 'https://www.startpage.com/do/search?q=' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=' },
  { id: 'brave', name: 'Brave Search', url: 'https://search.brave.com/search?q=' },
  { id: 'ecosia', name: 'Ecosia', url: 'https://www.ecosia.org/search?q=' },
  { id: 'qwant', name: 'Qwant', url: 'https://www.qwant.com/?q=' }
] as const

export type SearchEngineId = (typeof SEARCH_ENGINES)[number]['id']
export const DEFAULT_SEARCH_ENGINE: SearchEngineId = 'startpage'

/** The engine with this id; the default for anything unknown. */
export const searchEngine = (id?: string): (typeof SEARCH_ENGINES)[number] => SEARCH_ENGINES.find((e) => e.id === id) ?? SEARCH_ENGINES[0]

/** Is it the same page, whatever a fragment or a trailing slash say? */
export const samePage = (a: string, b: string): boolean => {
  const key = (u: string): string => u.trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase()
  return key(a) === key(b)
}

/** The engines in the order the user keeps them (the first is the default); ids that are unknown are dropped, engines that are missing come last. */
export function orderEngines(order?: readonly string[]): (typeof SEARCH_ENGINES)[number][] {
  const known = [...new Set(order ?? [])].flatMap((id) => SEARCH_ENGINES.filter((e) => e.id === id))
  return [...known, ...SEARCH_ENGINES.filter((e) => !known.includes(e))]
}

/** `id` moved to place `to` (0 is the first) of the order. */
export function moveEngine(order: readonly SearchEngineId[], id: SearchEngineId, to: number): SearchEngineId[] {
  const rest = order.filter((x) => x !== id)
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, id)
  return rest
}

/** Is the text an address (a URL, localhost, a host name) rather than words to search for? */
export function isAddress(input: string): boolean {
  const text = input.trim()
  return /^(https?|file|about):/i.test(text) || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(text) || (!/\s/.test(text) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(text))
}

/** What the user typed in a Browser Pane's address bar, as a URL to load: an address as it is, anything else a search with `engine`. */
export function normalizeUrl(input: string, engine?: string): string {
  const text = input.trim()
  if (!text) return 'about:blank'
  if (/^(https?|file|about):/i.test(text)) return text
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(text)) return `http://${text}`
  if (isAddress(text)) return `https://${text}`
  return searchEngine(engine).url + encodeURIComponent(text)
}
