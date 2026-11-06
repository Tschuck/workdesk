/** Pages that cannot be loaded: a list of sites (`reddit.com`, `reddit.com/r/all`), with a pass for one page at a time. */

/** how long a pass for one page lasts */
export const PASS_MS = 10 * 60_000

/** What was typed as a site, as a rule: `reddit.com`, `old.reddit.com/r/all`; undefined when it is not a site. */
export function cleanRule(input: string): string | undefined {
  let s = input.trim().toLowerCase()
  if (!s) return undefined
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[?#].*$/, '').replace(/^www\./, '').replace(/\/+$/, '')
  const [host, ...path] = s.split('/')
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return undefined
  return path.length > 0 ? `${host}/${path.join('/')}` : host
}

/** The rule that blocks this address (the first), or undefined. Only http(s) pages; a rule covers the site and its subdomains, and with a path only that part of it. */
export function matchRule(url: string, rules: readonly string[]): string | undefined {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return undefined
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  const path = u.pathname.toLowerCase().replace(/\/+$/, '')
  return rules.find((rule) => {
    const [d, ...p] = rule.split('/')
    if (host !== d && !host.endsWith(`.${d}`)) return false
    if (p.length === 0) return true
    const prefix = `/${p.join('/')}`
    return path === prefix || path.startsWith(`${prefix}/`)
  })
}

/** The identity of a page for a pass: its site and path, not the query or the part after `#`. */
export function passKey(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, '').toLowerCase()}`
  } catch {
    return url
  }
}

/** Passes for single pages, each for a while. */
export class Passes {
  private readonly until = new Map<string, number>()

  grant(url: string, now: number): void {
    this.until.set(passKey(url), now + PASS_MS)
  }

  has(url: string, now: number): boolean {
    const at = this.until.get(passKey(url))
    if (at === undefined) return false
    if (at <= now) {
      this.until.delete(passKey(url))
      return false
    }
    return true
  }
}

/** The rule that stops this page now: blocked by a rule, and no pass for it. */
export function blockedBy(url: string, rules: readonly string[], passes: Passes, now: number): string | undefined {
  const rule = matchRule(url, rules)
  return rule && !passes.has(url, now) ? rule : undefined
}
