/**
 * Claude Accounts: the logins WorkDesk knows about. Each has a name and (optionally) a CLAUDE_CONFIG_DIR; an empty
 * folder means the default login of Claude Code. One of them is the default account, used by every WorkDesk that
 * does not choose another.
 */
export interface ClaudeAccount {
  /** lower case letters and digits; part of a tmux session name, so nothing else is allowed */
  id: string
  name: string
  /** CLAUDE_CONFIG_DIR; empty = the default login */
  configDir?: string
}

export interface AccountsConfig {
  /** show and read the usage at all */
  enabled: boolean
  /** minutes between two readings of the usage */
  intervalMin: number
  defaultId: string
  accounts: ClaudeAccount[]
}

export const DEFAULT_INTERVAL_MIN = 5
export const MIN_INTERVAL_MIN = 1
export const MAX_INTERVAL_MIN = 60

const ID = /^[a-z0-9]{1,24}$/

/** The single-account settings (`claude-usage.json`) as they were before there were several accounts. */
export interface LegacyUsageConfig {
  enabled?: boolean
  configDir?: string
}

const clean = (dir: string | undefined): string | undefined => {
  const d = dir?.trim().replace(/\/+$/, '')
  return d ? d : undefined
}

/** Compares two config folders ("/a/b/" and "/a/b" are the same, so are two empty ones). */
export const sameConfigDir = (a: string | undefined, b: string | undefined): boolean => (clean(a) ?? '') === (clean(b) ?? '')

const nameOfDir = (dir: string | undefined): string => {
  const base = clean(dir)?.split('/').pop()?.replace(/^\./, '')
  return base || 'Default'
}

/** The first account carries over what the single-account settings had: the folder and whether the usage is shown. */
export function migrateAccounts(legacy: LegacyUsageConfig | undefined, id = 'main'): AccountsConfig {
  const configDir = clean(legacy?.configDir)
  return {
    enabled: legacy?.enabled ?? true,
    intervalMin: DEFAULT_INTERVAL_MIN,
    defaultId: id,
    accounts: [{ id, name: nameOfDir(configDir), ...(configDir ? { configDir } : {}) }]
  }
}

/** Reads the saved settings; anything that is not usable is dropped, and there is always at least one account. */
export function parseAccounts(raw: unknown): AccountsConfig | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r['accounts'])) return undefined
  const seen = new Set<string>()
  const accounts: ClaudeAccount[] = []
  for (const a of r['accounts'] as unknown[]) {
    if (typeof a !== 'object' || a === null) continue
    const o = a as Record<string, unknown>
    if (typeof o['id'] !== 'string' || !ID.test(o['id']) || seen.has(o['id'])) continue
    seen.add(o['id'])
    const configDir = typeof o['configDir'] === 'string' ? clean(o['configDir']) : undefined
    const name = typeof o['name'] === 'string' && o['name'].trim() ? o['name'].trim() : nameOfDir(configDir)
    accounts.push({ id: o['id'], name, ...(configDir ? { configDir } : {}) })
  }
  if (accounts.length === 0) return undefined
  const interval = Number(r['intervalMin'])
  return {
    enabled: r['enabled'] !== false,
    intervalMin: Number.isFinite(interval) ? Math.min(MAX_INTERVAL_MIN, Math.max(MIN_INTERVAL_MIN, Math.round(interval))) : DEFAULT_INTERVAL_MIN,
    defaultId: typeof r['defaultId'] === 'string' && seen.has(r['defaultId']) ? r['defaultId'] : accounts[0].id,
    accounts
  }
}

/** A name nobody uses yet: "Work", "Work 2", … */
export function uniqueName(cfg: AccountsConfig, wanted: string): string {
  const base = wanted.trim() || 'Account'
  const used = new Set(cfg.accounts.map((a) => a.name.toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`
}

export function addAccount(cfg: AccountsConfig, id: string, name: string, configDir?: string): AccountsConfig {
  if (!ID.test(id) || cfg.accounts.some((a) => a.id === id)) throw new Error(`Account id ${id} is not usable`)
  const dir = clean(configDir)
  const account: ClaudeAccount = { id, name: uniqueName(cfg, name || nameOfDir(dir)), ...(dir ? { configDir: dir } : {}) }
  return { ...cfg, accounts: [...cfg.accounts, account] }
}

const update = (cfg: AccountsConfig, id: string, fn: (a: ClaudeAccount) => ClaudeAccount): AccountsConfig => {
  if (!cfg.accounts.some((a) => a.id === id)) throw new Error(`Unknown Account ${id}`)
  return { ...cfg, accounts: cfg.accounts.map((a) => (a.id === id ? fn(a) : a)) }
}

export function renameAccount(cfg: AccountsConfig, id: string, name: string): AccountsConfig {
  const wanted = name.trim()
  if (!wanted) throw new Error('An Account needs a name')
  if (cfg.accounts.some((a) => a.id !== id && a.name.toLowerCase() === wanted.toLowerCase())) throw new Error(`There is already an Account named ${wanted}`)
  return update(cfg, id, (a) => ({ ...a, name: wanted }))
}

export function setAccountDir(cfg: AccountsConfig, id: string, configDir: string | undefined): AccountsConfig {
  const dir = clean(configDir)
  return update(cfg, id, ({ configDir: _, ...a }) => (dir ? { ...a, configDir: dir } : a))
}

export function setDefaultAccount(cfg: AccountsConfig, id: string): AccountsConfig {
  update(cfg, id, (a) => a)
  return { ...cfg, defaultId: id }
}

/** The last Account cannot be removed. Removing the default makes the first remaining one the default. */
export function removeAccount(cfg: AccountsConfig, id: string): AccountsConfig {
  if (!cfg.accounts.some((a) => a.id === id)) throw new Error(`Unknown Account ${id}`)
  if (cfg.accounts.length === 1) throw new Error('The last Account cannot be removed')
  const accounts = cfg.accounts.filter((a) => a.id !== id)
  return { ...cfg, accounts, defaultId: cfg.defaultId === id ? accounts[0].id : cfg.defaultId }
}

export const defaultAccount = (cfg: AccountsConfig): ClaudeAccount => cfg.accounts.find((a) => a.id === cfg.defaultId) ?? cfg.accounts[0]

/** The Account a WorkDesk (or Tab) runs Claude under: its own choice if that Account still exists, else the default. */
export function resolveAccount(cfg: AccountsConfig, chosen?: string): ClaudeAccount {
  return (chosen ? cfg.accounts.find((a) => a.id === chosen) : undefined) ?? defaultAccount(cfg)
}

/** The Account that owns a config folder (as a Claude session reports it); the empty folder is the one without a folder. */
export function accountOfConfigDir(cfg: AccountsConfig, configDir: string | undefined): ClaudeAccount | undefined {
  return cfg.accounts.find((a) => sameConfigDir(a.configDir, configDir))
}

/** What a new terminal of an Account gets in its environment so that `claude` runs under it. */
export function accountEnv(account: ClaudeAccount): Record<string, string> {
  return account.configDir ? { CLAUDE_CONFIG_DIR: account.configDir } : {}
}

/** tmux session of the hidden reading of an Account. Never a WorkDesk id (those do not start with an underscore). */
export const usageSessionOf = (id: string): string => `_workdesk-usage-${id}`

export type LimitLevel = 'ok' | 'warm' | 'hot'
export const limitLevel = (pct: number): LimitLevel => (pct >= 90 ? 'hot' : pct >= 70 ? 'warm' : 'ok')

export interface LimitNotice {
  title: string
  body: string
}

interface Reading {
  session: number
  week?: number
}

/**
 * A notification when a reading crosses into the red (90 %) for the 5-hour session or the week, once per crossing.
 * It names the Account. Nothing when there was no reading before (a start of the app with a full account is no news).
 */
export function limitNotices(accountName: string, before: Reading | undefined, after: Reading | undefined): LimitNotice[] {
  if (!before || !after) return []
  const out: LimitNotice[] = []
  const crossed = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined && limitLevel(a) !== 'hot' && limitLevel(b) === 'hot'
  if (crossed(before.session, after.session)) out.push({ title: `Claude (${accountName}): 5-hour limit almost used`, body: `${after.session}% of the session limit is used on ${accountName}.` })
  if (crossed(before.week, after.week)) out.push({ title: `Claude (${accountName}): weekly limit almost used`, body: `${after.week}% of the weekly limit is used on ${accountName}.` })
  return out
}
