import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { blockedBy, cleanRule, matchRule, Passes } from './domain/site-block'

/** The sites that cannot be loaded (kept in the Status Repo, so they follow you) and the passes for single pages (kept in memory only). */
export class SiteBlockService {
  private sites: string[] = []
  private readonly passes = new Passes()

  constructor(
    private readonly dir: string,
    private readonly onWrite: () => void = () => undefined,
    private readonly now: () => number = Date.now
  ) {}

  private get file(): string {
    return join(this.dir, 'site-block.json')
  }

  list(): string[] {
    return this.sites
  }

  async load(): Promise<string[]> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as { sites?: unknown }
      this.sites = Array.isArray(raw.sites) ? [...new Set(raw.sites.filter((x): x is string => typeof x === 'string').map(cleanRule).filter((x): x is string => !!x))] : []
    } catch {
      this.sites = []
    }
    return this.sites
  }

  private async save(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify({ sites: this.sites }, null, 2) + '\n')
    await rename(tmp, this.file)
    this.onWrite()
  }

  async add(input: string): Promise<string[]> {
    const rule = cleanRule(input)
    if (!rule) throw new Error('That is not a site: type a domain such as reddit.com, or reddit.com/r/all')
    if (!this.sites.includes(rule)) this.sites = [...this.sites, rule].sort()
    await this.save()
    return this.sites
  }

  async remove(rule: string): Promise<string[]> {
    this.sites = this.sites.filter((s) => s !== rule)
    await this.save()
    return this.sites
  }

  /** the rule that stops this page now, if one does (no pass for it) */
  check(url: string): string | undefined {
    return blockedBy(url, this.sites, this.passes, this.now())
  }

  /** a pass for this one page, for a while; only for a page that is blocked */
  pass(url: string): void {
    if (matchRule(url, this.sites)) this.passes.grant(url, this.now())
  }
}
