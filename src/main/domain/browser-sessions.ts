/** The shared session: every page that no rule names. Its name is kept so earlier logins stay. */
export const ROOT_PARTITION = 'persist:workdesk-browser'

/** Pages of these domains get a session (cookies, logins, storage) of their own. */
export interface BrowserSession {
  id: string
  name: string
  /** `github.com` is exactly that host; `*.google.com` is google.com and everything below it */
  domains: string[]
}

/** What pages may load: everything, no trackers, or neither trackers nor ads. */
export type BlockLevel = 'off' | 'trackers' | 'ads'
export const BLOCK_LEVELS: readonly BlockLevel[] = ['off', 'trackers', 'ads']

export interface BrowserSessionsConfig {
  sessions: BrowserSession[]
  /** applies to every session; missing means off */
  blocking?: BlockLevel
  /** every domain that no rule names has a session of its own; missing means on, `false` puts them all in the shared session */
  perDomain?: boolean
}

export const NO_SESSIONS: BrowserSessionsConfig = { sessions: [] }

export const blockLevelOf = (config?: Partial<BrowserSessionsConfig> | null): BlockLevel => (BLOCK_LEVELS.includes(config?.blocking as BlockLevel) ? config!.blocking! : 'off')

/** Does every domain without a rule get a session of its own? The default. */
export const perDomainOf = (config?: Partial<BrowserSessionsConfig> | null): boolean => config?.perDomain !== false

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac'])

/** The site of a host, which is what has a session: `gist.github.com` is `github.com`, `www.bbc.co.uk` is `bbc.co.uk`; an address or `localhost` stays as it is. */
export function siteOf(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (/^[\d.]+$/.test(h) || h.includes(':')) return h
  const parts = h.split('.')
  if (parts.length <= 2) return h
  const keep = parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2
  return parts.slice(-keep).join('.')
}

/** The partition of a domain's own session, which no rule names. `@` cannot be part of a rule's id. */
export const SITE_PARTITION = `${ROOT_PARTITION}@`
export const sitePartition = (site: string): string => `${SITE_PARTITION}${site}`
export const isSitePartition = (partition: string): boolean => partition.startsWith(SITE_PARTITION) && /^[a-z0-9.:-]{1,253}$/.test(partition.slice(SITE_PARTITION.length))

export const partitionFor = (id?: string): string => (id ? `${ROOT_PARTITION}-${id}` : ROOT_PARTITION)

/** A domain rule as typed: a host or `*.host`, no scheme, port or path. */
export function normalizeDomain(input: string): string | undefined {
  let text = input.trim().toLowerCase()
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '')
  return /^(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+$/.test(text) ? text : undefined
}

export function matchesDomain(rule: string, host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  return rule.startsWith('*.') ? h === rule.slice(2) || h.endsWith(rule.slice(1)) : h === rule
}

/** The session a page belongs to; undefined is the shared one. The first rule that matches wins. */
export function sessionIdFor(config: BrowserSessionsConfig, url: string): string | undefined {
  let host: string
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined
    host = u.hostname
  } catch {
    return undefined
  }
  return config.sessions.find((s) => s.domains.some((d) => matchesDomain(d, host)))?.id
}

/** Every session whose rules name the address: a domain may be in several (a private and a work login of the same site). */
export function sessionsFor(config: BrowserSessionsConfig, url: string): BrowserSession[] {
  let host: string
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return []
    host = u.hostname
  } catch {
    return []
  }
  return config.sessions.filter((s) => s.domains.some((d) => matchesDomain(d, host)))
}

/** Is the page on a domain that several sessions name, and in one of them (`inPartition` says whether the page runs in a partition)? Such a page was put in its session by a choice. */
export function isPinnedSession(config: BrowserSessionsConfig, url: string, inPartition: (partition: string) => boolean): boolean {
  const named = sessionsFor(config, url)
  return named.length > 1 && named.some((s) => inPartition(partitionFor(s.id)))
}

/** The partitions a page may stay in when it goes to the address: the sessions that name it, or the one the other rules give. */
export function partitionsFor(config: BrowserSessionsConfig, url: string): string[] {
  const named = sessionsFor(config, url)
  return named.length > 0 ? named.map((s) => partitionFor(s.id)) : [partitionForUrl(config, url)]
}

/** Where a page goes for an address: the partition, or the sessions to ask about when several name it and the page is in none of them. */
export type PartitionChoice = { partition: string } | { ask: BrowserSession[] }

export function resolvePartition(config: BrowserSessionsConfig, url: string, current?: string): PartitionChoice {
  const named = sessionsFor(config, url)
  if (named.length > 1) return current && named.some((s) => partitionFor(s.id) === current) ? { partition: current } : { ask: named }
  return { partition: partitionForUrl(config, url) }
}

/** What to show of the session a page runs in: its name (a configured session, the site of its own, or the shared one). */
export function describePartition(config: BrowserSessionsConfig, partition: string): { name: string; kind: 'session' | 'site' | 'shared' } {
  const s = config.sessions.find((x) => partitionFor(x.id) === partition)
  if (s) return { name: s.name, kind: 'session' }
  if (isSitePartition(partition)) return { name: partition.slice(SITE_PARTITION.length), kind: 'site' }
  return { name: 'Shared', kind: 'shared' }
}

export function partitionForUrl(config: BrowserSessionsConfig, url: string): string {
  const id = sessionIdFor(config, url)
  if (id) return partitionFor(id)
  if (!perDomainOf(config)) return ROOT_PARTITION
  try {
    const u = new URL(url)
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname ? sitePartition(siteOf(u.hostname)) : ROOT_PARTITION
  } catch {
    return ROOT_PARTITION
  }
}

/** Only the shared partition, those of configured sessions and (when on) those of single domains may hold a page. */
export const isKnownPartition = (config: BrowserSessionsConfig, partition: string): boolean =>
  partition === ROOT_PARTITION || (perDomainOf(config) && isSitePartition(partition)) || config.sessions.some((s) => partitionFor(s.id) === partition)

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'session'

/** What is saved: names trimmed, domains normalized and unique, ids safe and unique, empty sessions kept (they are being set up). */
export function cleanConfig(input: unknown): BrowserSessionsConfig {
  const list = Array.isArray((input as BrowserSessionsConfig | undefined)?.sessions) ? (input as BrowserSessionsConfig).sessions : []
  const taken = new Set<string>()
  const sessions: BrowserSession[] = []
  for (const s of list) {
    if (!s || typeof s !== 'object') continue
    const name = String(s.name ?? '').trim() || 'Session'
    let id = typeof s.id === 'string' && /^[a-z0-9-]{1,30}$/.test(s.id) ? s.id : slug(name)
    for (let n = 2; taken.has(id); n++) id = `${slug(name).slice(0, 26)}-${n}`
    taken.add(id)
    const domains = [...new Set((Array.isArray(s.domains) ? s.domains : []).map((d) => normalizeDomain(String(d))).filter((d): d is string => !!d))]
    sessions.push({ id, name, domains })
  }
  const blocking = blockLevelOf(input as Partial<BrowserSessionsConfig> | null)
  const perDomain = perDomainOf(input as Partial<BrowserSessionsConfig> | null)
  return { sessions, ...(blocking === 'off' ? {} : { blocking }), ...(perDomain ? {} : { perDomain: false }) }
}
