import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  accountOfConfigDir, addAccount, defaultAccount, limitNotices, MAX_INTERVAL_MIN, migrateAccounts, MIN_INTERVAL_MIN, parseAccounts, removeAccount, renameAccount,
  setAccountDir, setDefaultAccount, usageSessionOf, type AccountsConfig, type ClaudeAccount, type LimitNotice, type LegacyUsageConfig
} from '../domain/claude-accounts'
import { UsageSchedule } from '../domain/usage-schedule'
import type { AuthStatus, LoginProcess } from './auth'
import { UsageService, type Screen, type UsageState } from './usage'

export interface AccountView {
  account: ClaudeAccount
  isDefault: boolean
  usage: UsageState
}

export interface AccountsState {
  enabled: boolean
  intervalMin: number
  defaultId: string
  accounts: AccountView[]
}

export interface AccountsDeps {
  /** the accounts (`claude-accounts.json`) */
  file: string
  /** the single-account settings of earlier versions (`claude-usage.json`), migrated when `file` does not exist */
  legacyFile: string
  screen: Screen
  cwd: string
  binary: () => string | undefined
  env?: () => string
  /** login state, login and logout of the account whose config folder `configDir()` gives */
  makeAuth: (configDir: () => string | undefined) => {
    status: () => Promise<AuthStatus>
    startLogin: (onUrl: (url: string) => void) => LoginProcess
    logout: () => Promise<void>
  }
  newId: () => string
  onChange?: (state: AccountsState) => void
  onNotice?: (notice: LimitNotice) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * The Claude Accounts and one usage reader per account. The readers share one lock, so at most one hidden Claude session
 * exists at any time (each starts for its reading and ends right after it), and one schedule decides when they read: every
 * `intervalMin` minutes, not while the screen is locked or the window is long out of sight, at once when that ends.
 */
export class AccountsService {
  private cfg: AccountsConfig = migrateAccounts(undefined)
  private readonly readers = new Map<string, UsageService>()
  private readonly seen = new Map<string, { session: number; week?: number }>()
  private tail: Promise<unknown> = Promise.resolve()
  private timer?: ReturnType<typeof setInterval>
  private watching = false
  private schedule: UsageSchedule

  constructor(private readonly d: AccountsDeps) {
    this.schedule = new UsageSchedule(() => void this.refreshAll(), d.now)
  }

  async load(): Promise<void> {
    let cfg: AccountsConfig | undefined
    try {
      cfg = parseAccounts(JSON.parse(await readFile(this.d.file, 'utf8')))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err
    }
    if (!cfg) {
      let legacy: LegacyUsageConfig | undefined
      try {
        legacy = JSON.parse(await readFile(this.d.legacyFile, 'utf8')) as LegacyUsageConfig
      } catch {
        legacy = undefined
      }
      // the old file stays where it is: nothing is lost if this version is not kept
      cfg = migrateAccounts(legacy, this.d.newId())
      await this.save(cfg)
    }
    this.cfg = cfg
    this.schedule.intervalMs = cfg.intervalMin * 60_000
    for (const a of cfg.accounts) this.build(a)
  }

  config(): AccountsConfig {
    return this.cfg
  }

  private lock = <T>(job: () => Promise<T>): Promise<T> => {
    const run = this.tail.then(job, job)
    this.tail = run.catch(() => undefined)
    return run
  }

  private build(a: ClaudeAccount): UsageService {
    const reader = new UsageService({
      screen: this.d.screen,
      session: usageSessionOf(a.id),
      lock: this.lock,
      initial: { enabled: this.cfg.enabled, configDir: a.configDir },
      cwd: this.d.cwd,
      binary: this.d.binary,
      env: this.d.env,
      now: this.d.now,
      sleep: this.d.sleep,
      auth: () => this.d.makeAuth(() => this.account(a.id)?.configDir).status(),
      startLogin: (onUrl) => this.d.makeAuth(() => this.account(a.id)?.configDir).startLogin(onUrl),
      logout: () => this.d.makeAuth(() => this.account(a.id)?.configDir).logout(),
      onChange: (st) => {
        this.notify(a.id, st)
        this.emit()
      }
    })
    this.readers.set(a.id, reader)
    return reader
  }

  private account(id: string): ClaudeAccount | undefined {
    return this.cfg.accounts.find((a) => a.id === id)
  }

  private notify(id: string, st: UsageState): void {
    const name = this.account(id)?.name
    if (!name || !st.usage) return
    const now = { session: st.usage.session, week: st.usage.week }
    const before = this.seen.get(id)
    this.seen.set(id, now)
    if (before) for (const n of limitNotices(name, before, now)) this.d.onNotice?.(n)
  }

  state(): AccountsState {
    return {
      enabled: this.cfg.enabled,
      intervalMin: this.cfg.intervalMin,
      defaultId: this.cfg.defaultId,
      accounts: this.cfg.accounts.map((account) => ({ account, isDefault: account.id === this.cfg.defaultId, usage: this.reader(account.id).state() }))
    }
  }

  private reader(id: string): UsageService {
    const r = this.readers.get(id)
    if (!r) throw new Error(`Unknown Account ${id}`)
    return r
  }

  private emit(): void {
    this.d.onChange?.(this.state())
  }

  private async save(cfg: AccountsConfig): Promise<void> {
    await mkdir(dirname(this.d.file), { recursive: true })
    await writeFile(this.d.file, JSON.stringify(cfg, null, 2) + '\n')
  }

  private async change(next: AccountsConfig): Promise<AccountsState> {
    this.cfg = next
    await this.save(next)
    this.emit()
    return this.state()
  }

  // ── editing the accounts

  async add(name: string, configDir?: string): Promise<AccountsState> {
    const id = this.d.newId()
    const next = addAccount(this.cfg, id, name, configDir)
    const account = next.accounts.find((a) => a.id === id)!
    this.cfg = next
    const reader = this.build(account)
    await this.save(next)
    this.emit()
    if (this.watching && this.cfg.enabled) void reader.poll()
    return this.state()
  }

  rename(id: string, name: string): Promise<AccountsState> {
    return this.change(renameAccount(this.cfg, id, name))
  }

  async setDir(id: string, configDir: string | undefined): Promise<AccountsState> {
    const next = setAccountDir(this.cfg, id, configDir)
    this.seen.delete(id)
    await this.change(next)
    const reader = this.reader(id)
    await reader.setConfig({ configDir: this.account(id)?.configDir })
    if (this.watching && this.cfg.enabled) void reader.poll()
    return this.state()
  }

  setDefault(id: string): Promise<AccountsState> {
    return this.change(setDefaultAccount(this.cfg, id))
  }

  async remove(id: string): Promise<AccountsState> {
    const next = removeAccount(this.cfg, id)
    await this.reader(id).pause()
    this.readers.delete(id)
    this.seen.delete(id)
    return this.change(next)
  }

  async setEnabled(enabled: boolean): Promise<AccountsState> {
    await this.change({ ...this.cfg, enabled })
    await Promise.all([...this.readers.values()].map((r) => r.setConfig({ enabled })))
    if (enabled && this.watching) void this.refreshAll()
    return this.state()
  }

  async setInterval(minutes: number): Promise<AccountsState> {
    const intervalMin = Math.min(MAX_INTERVAL_MIN, Math.max(MIN_INTERVAL_MIN, Math.round(minutes)))
    this.schedule.intervalMs = intervalMin * 60_000
    const state = await this.change({ ...this.cfg, intervalMin })
    if (this.watching) this.startTimer()
    return state
  }

  /** The Account a Claude session of this config folder belongs to, if any. */
  ofConfigDir(dir: string | undefined): ClaudeAccount | undefined {
    return accountOfConfigDir(this.cfg, dir)
  }

  get default(): ClaudeAccount {
    return defaultAccount(this.cfg)
  }

  // ── reading

  /** Reads every account, one after the other. */
  async refreshAll(): Promise<void> {
    this.schedule.noteRefresh()
    await Promise.all([...this.readers.values()].map((r) => r.poll()))
  }

  /** The reload button: now, without waiting for the interval (a rate limit Claude asked for is still respected). */
  async refresh(id: string): Promise<void> {
    this.schedule.noteRefresh()
    await this.reader(id).poll()
  }

  restart = (id: string): Promise<void> => this.reader(id).restart()
  login = (id: string): Promise<void> => this.reader(id).login()
  cancelLogin = (id: string): void => this.reader(id).cancelLogin()
  logout = (id: string): Promise<void> => this.reader(id).logout()

  private startTimer(): void {
    clearInterval(this.timer)
    this.timer = setInterval(() => this.schedule.tick(), this.cfg.intervalMin * 60_000)
  }

  /** Begin reading now and then every interval. */
  start(): void {
    this.watching = true
    this.startTimer()
    void this.refreshAll()
  }

  stop(): void {
    clearInterval(this.timer)
    this.timer = undefined
    this.watching = false
  }

  /** Stop without changing the setting (the Claude part of the sidebar is closed): no timer, nothing running. */
  async pause(): Promise<void> {
    this.stop()
    await Promise.all([...this.readers.values()].map((r) => r.pause()))
  }

  get paused(): boolean {
    return !this.watching
  }

  /** The window gained or lost focus. */
  setFocused(focused: boolean): void {
    if (this.watching) this.schedule.setFocused(focused)
  }

  /** The screen was locked or the machine went to sleep / came back. */
  setLocked(locked: boolean): void {
    if (this.watching) this.schedule.setLocked(locked)
  }

  /** Ends every hidden session (at quit). */
  async killAll(): Promise<void> {
    await Promise.all(this.cfg.accounts.map((a) => this.d.screen.killSession(usageSessionOf(a.id))))
  }
}
