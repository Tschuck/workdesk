import type { LayoutNode, PaneNode, Tab } from './layout'

/**
 * Automatic hibernation of pages: a browser Tab that has been out of sight for a while is unloaded (a loaded page costs
 * about 70 to 80 MB even when blank) and loads again, on its address, when it is shown. Terminals are never touched.
 */
export interface AutoHibernate {
  enabled: boolean
  /** how long a Tab must stay out of sight */
  delayMinutes: number
  /** hosts that are never unloaded ("meet.google.com"; "*.slack.com" or "slack.com" also match subdomains) */
  exclude: string[]
}

export const DEFAULT_AUTO_HIBERNATE: AutoHibernate = { enabled: true, delayMinutes: 30, exclude: [] }
export const MIN_DELAY_MINUTES = 1
export const MAX_DELAY_MINUTES = 24 * 60

export function parseAutoHibernate(raw: unknown): AutoHibernate {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AutoHibernate>
  const delay = Number(r.delayMinutes)
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_AUTO_HIBERNATE.enabled,
    delayMinutes: Number.isFinite(delay) ? Math.min(MAX_DELAY_MINUTES, Math.max(MIN_DELAY_MINUTES, Math.round(delay))) : DEFAULT_AUTO_HIBERNATE.delayMinutes,
    exclude: Array.isArray(r.exclude) ? parseExclude(r.exclude.filter((x): x is string => typeof x === 'string').join('\n')) : []
  }
}

/** One host per line (or comma): lower case, without scheme, path or a leading `*.`; empty lines and doubles are dropped. */
export function parseExclude(text: string): string[] {
  const hosts = text
    .split(/[\n,]+/)
    .map((l) => l.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\*\./, '').replace(/[/?#].*$/, ''))
    .filter(Boolean)
  return [...new Set(hosts)]
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** Does the address belong to one of the excluded hosts (the host itself or any subdomain of it)? */
export function isExcluded(url: string, exclude: readonly string[]): boolean {
  const host = hostOf(url)
  return !!host && exclude.some((e) => host === e || host.endsWith('.' + e))
}

function pages(node: LayoutNode): PaneNode[] {
  return node.type === 'pane' ? (node.kind === 'browser' ? [node] : []) : node.children.flatMap(pages)
}

/** The addresses of the pages of a Tab. */
export const pageUrls = (tab: Tab): string[] => (tab.kind === 'panes' ? pages(tab.layout).map((p) => (p as { url: string }).url) : [])

export interface HiddenTabs {
  /** when each Tab went out of sight (ms); a Tab that is not listed is in sight */
  since: ReadonlyMap<string, number>
  now: number
}

/**
 * The Tabs to unload now: they have loaded pages, are not pinned, no page is on an excluded host, and they have been
 * out of sight for the delay. `busy` says which Tabs must stay (a page that plays sound, a Tab being dragged).
 */
export function tabsToHibernate(tabs: readonly Tab[], hidden: HiddenTabs, settings: AutoHibernate, busy: (tabId: string) => boolean = () => false): string[] {
  if (!settings.enabled) return []
  const delay = settings.delayMinutes * 60_000
  return tabs
    .filter((t): t is Extract<Tab, { kind: 'panes' }> => t.kind === 'panes')
    .filter((t) => {
      if (t.pinned) return false
      const urls = pageUrls(t)
      if (urls.length === 0) return false
      // every page already unloaded: nothing to do
      if (pages(t.layout).every((p) => (p as { hibernated?: boolean }).hibernated)) return false
      if (urls.some((u) => isExcluded(u, settings.exclude))) return false
      const since = hidden.since.get(t.id)
      return since !== undefined && hidden.now - since >= delay && !busy(t.id)
    })
    .map((t) => t.id)
}

/**
 * Keeps the time each Tab went out of sight. `update` is called whenever the Tabs or what is shown change (and on every
 * tick): a Tab that is shown, or that no longer exists, is forgotten; a hidden one keeps the time it first went out of sight.
 */
export function trackHidden(previous: ReadonlyMap<string, number>, tabIds: readonly string[], shownTabId: string | undefined, now: number): Map<string, number> {
  const next = new Map<string, number>()
  for (const id of tabIds) if (id !== shownTabId) next.set(id, previous.get(id) ?? now)
  return next
}

const hasTerminal = (node: LayoutNode): boolean => (node.type === 'pane' ? node.kind === 'terminal' : node.children.some(hasTerminal))

/**
 * Is the Tab built only when it is first shown? Pages and editors are (a page costs ~75 MB, an editor a Monaco instance);
 * a Tab with a terminal is built at once, because the program that starts in it (Claude, a dev server) must run
 * whether or not the Tab is looked at.
 */
export const buildsOnFirstShow = (tab: Tab): boolean => tab.kind === 'panes' && !hasTerminal(tab.layout)

/** A rough "freed about 80 MB" for a tooltip. */
export function memoryLabel(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}
