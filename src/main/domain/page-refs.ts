import type { Todo } from './types'

/** A web page kept with a WorkDesk or a Todo (a pull request, a ticket, a CI run, any page), so it can be opened again. */
export interface PageRef {
  id: string
  url: string
  title: string
  /** the page's icon as an address or data: address; left out when none is known */
  favicon?: string
  /** epoch ms */
  addedAt: number
}

export interface PageRefInput {
  url: string
  title?: string
  favicon?: string
}

const MAX_FAVICON = 4000

/** The host of an address (without `www.`), or an empty string. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** What a reference is called: its title, else the host, else the address. */
export function refLabel(ref: { url: string; title?: string }): string {
  return ref.title?.replace(/\s+/g, ' ').trim() || hostOf(ref.url) || ref.url
}

/** `[title](url)`: brackets of the title are escaped, parentheses and spaces of the address are encoded so the link does not break. Without a title the host is used. */
export function markdownLink(url: string, title?: string): string {
  const text = refLabel({ url, title }).replace(/([\\[\]])/g, '\\$1')
  const target = url.trim().replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
  return `[${text}](${target})`
}

/** Checks what came in from the UI: only http(s) pages can be attached. Throws otherwise. */
export function cleanRefInput(input: unknown): PageRefInput {
  const i = (input ?? {}) as { url?: unknown; title?: unknown; favicon?: unknown }
  const url = typeof i.url === 'string' ? i.url.trim() : ''
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error('Only web pages (http or https) can be attached')
  const title = typeof i.title === 'string' ? i.title.replace(/\s+/g, ' ').trim().slice(0, 300) : ''
  const favicon = typeof i.favicon === 'string' && i.favicon && i.favicon.length <= MAX_FAVICON ? i.favicon : undefined
  return { url, title: title || undefined, favicon }
}

/** The same page whatever a fragment or a trailing slash say. */
const key = (url: string): string => url.trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase()

/** Adds a page; one that is attached already is refreshed (title, icon) and stays where it is. */
export function addRef(refs: readonly PageRef[] | undefined, input: PageRefInput, id: string, now: number): PageRef[] {
  const list = refs ?? []
  const known = list.find((r) => key(r.url) === key(input.url))
  if (known) return list.map((r) => (r === known ? { ...r, title: input.title || r.title, favicon: input.favicon ?? r.favicon } : r))
  return [...list, { id, url: input.url, title: input.title ?? '', favicon: input.favicon, addedAt: now }]
}

export const removeRef = (refs: readonly PageRef[] | undefined, id: string): PageRef[] => (refs ?? []).filter((r) => r.id !== id)

/** Is this page attached already? */
export const hasRef = (refs: readonly PageRef[] | undefined, url: string): boolean => (refs ?? []).some((r) => key(r.url) === key(url))

/** The Todos a page can be attached to, open ones only: those of the WorkDesk first, then loose ones of Today, then the other loose ones. */
export function attachableTodos(todos: readonly Todo[], deskId: string | undefined): Todo[] {
  const open = todos.filter((t) => !t.resolved)
  const rank = (t: Todo): number => (deskId && t.deskId === deskId ? 0 : !t.deskId && t.list === 'today' ? 1 : !t.deskId ? 2 : 3)
  return open.filter((t) => rank(t) < 3).map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map((x) => x.t)
}

/** The Todos whose title has every typed word. */
export function filterTodos(todos: readonly Todo[], query: string): Todo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return todos.filter((t) => words.every((w) => t.title.toLowerCase().includes(w)))
}
