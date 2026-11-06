import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AuthStatus, LoginProcess } from './auth'

export interface UsageReading {
  /** percent of the current 5-hour session limit used */
  session: number
  /** percent of the weekly limit (all models) used */
  week?: number
  sessionResets?: string
  weekResets?: string
  /** epoch ms of the reading */
  at: number
}

/** "45% used" under "Current session" / "Current week (all models)", plus the "Resets …" line below. */
export function parseUsage(screen: string): Omit<UsageReading, 'at'> | undefined {
  const limit = (label: string): { pct: number; resets?: string } | undefined => {
    const from = screen.indexOf(label)
    if (from === -1) return undefined
    const m = /(\d+)%\s+used/.exec(screen.slice(from))
    if (!m) return undefined
    const after = screen.slice(from + m.index + m[0].length)
    return { pct: Number(m[1]), resets: /Resets ([^\n]+)/.exec(after)?.[1].trim() }
  }
  const session = limit('Current session')
  if (!session) return undefined
  const week = limit('Current week (all models)')
  return { session: session.pct, week: week?.pct, sessionResets: session.resets, weekResets: week?.resets }
}

/** Where `claude` is installed: the PATH, plus the places the installer puts it. */
export function findClaudeBinary(path = process.env['PATH'] ?? '', exists: (p: string) => boolean = existsSync): string | undefined {
  const dirs = [...path.split(':').filter(Boolean), join(homedir(), '.claude', 'local'), join(homedir(), '.local', 'bin')]
  return dirs.map((d) => join(d, 'claude')).find(exists)
}

/** The few tmux operations needed to drive a hidden Claude Code session. */
export interface Screen {
  hasSession(session: string): Promise<boolean>
  newSession(session: string, cwd: string, command: string, cols: number, rows: number): Promise<void>
  sendKeys(session: string, keys: string[], literal?: boolean): Promise<void>
  capture(session: string): Promise<string>
  killSession(session: string): Promise<void>
}

export interface UsageConfig {
  enabled: boolean
  /** CLAUDE_CONFIG_DIR of the account to watch; empty = the default login */
  configDir?: string
}

export interface LoginState {
  running: boolean
  /** where to log in, in case the browser did not open */
  url?: string
  error?: string
}

/** Claude Code's `/usage` screen when its usage endpoint answers "too many requests". */
export const RATE_LIMITED = /rate limited|try again in a moment/i

export interface UsageState extends UsageConfig {
  /** epoch ms until which Claude Code asked us to wait; the reading shown (if any) is the last good one */
  retryAt?: number
  /** the account of the watched config dir; undefined until first checked */
  auth?: AuthStatus
  login: LoginState
  usage?: UsageReading
  /** why there is no reading */
  why: string
  loading: boolean
}

/** A reading that could not be renewed is still shown for this long. */
const STALE_AFTER_MS = 30 * 60_000

const TRUST_DIALOG = /Quick safety check|trust this folder|trust the files/i

/** Not a WorkDesk id (those never start with an underscore), so it cannot clash with a WorkDesk's tmux session. */
export const USAGE_SESSION = '_workdesk-usage'

const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

export interface UsageDeps {
  screen: Screen
  /** tmux session of this account's reading; one per account, and only while it is read (default `USAGE_SESSION`) */
  session?: string
  /** runs readings one at a time across accounts (default: no lock) */
  lock?: <T>(job: () => Promise<T>) => Promise<T>
  /** the settings to start with, when they are kept elsewhere (no `configFile`) */
  initial?: UsageConfig
  /** folder the hidden session starts in (it must be one Claude Code may open) */
  cwd: string
  binary: () => string | undefined
  /** where the settings are kept; without it they only live in memory */
  configFile?: string
  /** reads the login state; must never open a browser or start anything */
  auth: () => Promise<AuthStatus>
  startLogin: (onUrl: (url: string) => void) => LoginProcess
  logout: () => Promise<void>
  env?: () => string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  onChange?: (state: UsageState) => void
}

/**
 * Keeps a hidden tmux session running Claude Code, asks it for `/usage` once a minute and parses
 * the screen. The session is only ever driven by this service, never typed into.
 */
export class UsageService {
  private config: UsageConfig = { enabled: true }
  private usage?: UsageReading
  private auth?: AuthStatus
  private loginState: LoginState = { running: false }
  private loginProcess?: LoginProcess
  private why = 'not read yet'
  private busy = false
  private fails = 0
  private rateLimitedUntil = 0
  private backoffMs = 0
  private gen = 0
  private readonly session: string
  private readonly lock: <T>(job: () => Promise<T>) => Promise<T>
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly d: UsageDeps) {
    this.session = d.session ?? USAGE_SESSION
    this.lock = d.lock ?? ((job) => job())
    if (d.initial) this.config = { ...d.initial }
    this.now = d.now ?? Date.now
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  async load(): Promise<void> {
    if (!this.d.configFile) return
    try {
      this.config = { enabled: true, ...(JSON.parse(await readFile(this.d.configFile, 'utf8')) as Partial<UsageConfig>) }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  state(): UsageState {
    return {
      ...this.config,
      auth: this.auth,
      login: this.loginState,
      usage: this.usage,
      why: this.why,
      loading: this.busy,
      retryAt: this.rateLimitedUntil > this.now() ? this.rateLimitedUntil : undefined
    }
  }

  private emit(): void {
    this.d.onChange?.(this.state())
  }

  async setConfig(patch: Partial<UsageConfig>): Promise<UsageState> {
    const before = this.config
    this.config = { ...before, ...patch }
    if (this.d.configFile) {
      await mkdir(dirname(this.d.configFile), { recursive: true })
      await writeFile(this.d.configFile, JSON.stringify(this.config, null, 2) + '\n')
    }
    if (!this.config.enabled) {
      this.gen++
      this.busy = false
      this.usage = undefined
      this.why = 'switched off'
      await this.kill()
    } else if (!before.enabled || before.configDir !== this.config.configDir) {
      // another login: the old reading is not its reading; the caller decides when to read again
      this.gen++
      this.busy = false
      this.usage = undefined
      this.rateLimitedUntil = 0
      this.backoffMs = 0
      this.fails = 0
      this.why = 'not read yet'
      await this.kill()
    }
    this.emit()
    return this.state()
  }

  private async kill(): Promise<void> {
    await this.d.screen.killSession(this.session).catch(() => undefined)
  }

  /** Stop watching without changing the setting: a reading in progress is dropped and its session ended. */
  async pause(): Promise<void> {
    this.gen++
    this.busy = false
    this.usage = undefined
    this.why = 'not watched'
    await this.kill()
    this.emit()
  }

  /** Log in, because the user asked: Claude Code opens the browser and waits. */
  async login(): Promise<void> {
    if (this.loginState.running) return
    this.loginState = { running: true }
    this.emit()
    try {
      this.loginProcess = this.d.startLogin((url) => {
        this.loginState = { ...this.loginState, url }
        this.emit()
      })
      await this.loginProcess.done
      this.loginState = { running: false }
    } catch (err) {
      this.loginState = { running: false, error: (err as Error).message }
    } finally {
      this.loginProcess = undefined
    }
    this.emit()
    await this.poll()
  }

  cancelLogin(): void {
    this.loginProcess?.cancel()
  }

  async logout(): Promise<void> {
    await this.d.logout()
    this.usage = undefined
    await this.kill()
    this.auth = await this.d.auth()
    this.why = 'logged out'
    this.emit()
  }

  /** Kill the hidden session and begin again. */
  async restart(): Promise<void> {
    this.gen++
    this.busy = false
    this.usage = undefined
    this.fails = 0
    this.why = 'restarting…'
    this.emit()
    await this.kill()
    await this.sleep(1000)
    if (this.config.enabled) void this.poll()
  }

  private async prompt(gen: number): Promise<boolean> {
    for (let tries = 0; tries < 12; tries++) {
      const screen = await this.d.screen.capture(this.session).catch(() => '')
      if (gen !== this.gen) return false
      if (TRUST_DIALOG.test(screen)) {
        // Claude Code asks once whether it may open the folder, with "No, exit" selected: choose "Yes"
        // (the dialog also shows the ❯ marker, so it must be recognised before the prompt is)
        if (!/❯\s*Yes/.test(screen)) await this.d.screen.sendKeys(this.session, ['Down'])
        await this.sleep(300)
        await this.d.screen.sendKeys(this.session, ['Enter'])
      } else if (screen.includes('❯') || screen.includes('Claude Code v')) return true
      else if (tries > 0) await this.d.screen.sendKeys(this.session, ['Escape'])
      await this.sleep(2000)
    }
    return false
  }

  private async query(gen: number): Promise<UsageReading | 'rate-limited' | undefined> {
    const { screen } = this.d
    await screen.sendKeys(this.session, ['Escape'])
    await this.sleep(500)
    await screen.sendKeys(this.session, ['/usage'], true)
    await this.sleep(1000)
    await screen.sendKeys(this.session, ['Enter'])
    await this.sleep(3500)
    const text = await screen.capture(this.session)
    if (gen !== this.gen) return undefined
    // Escape closes the screen, also the one that offers "r to retry"
    await screen.sendKeys(this.session, ['Escape'])
    if (RATE_LIMITED.test(text)) return 'rate-limited'
    const parsed = parseUsage(text)
    if (!parsed) this.why = `no /usage screen: ${text.replace(/\s+/g, ' ').slice(-90)}`
    return parsed ? { ...parsed, at: this.now() } : undefined
  }

  /**
   * One reading, if none is queued or running. The hidden session exists only while it is read: it is started for the
   * reading and killed right after it, also after a failure, so nothing stays running between two readings. Readings
   * of several accounts go one after the other through the shared `lock`.
   */
  async poll(): Promise<void> {
    if (!this.config.enabled || this.busy) return
    if (this.now() < this.rateLimitedUntil) return this.emit()
    const bin = this.d.binary()
    if (!bin) {
      this.usage = undefined
      this.why = 'claude not found (looked in the PATH and ~/.claude/local)'
      return this.emit()
    }
    const gen = this.gen
    this.busy = true
    this.emit()
    try {
      await this.lock(() => this.read(gen, bin))
    } finally {
      if (gen === this.gen) this.busy = false
    }
    this.emit()
  }

  private async read(gen: number, bin: string): Promise<void> {
    if (gen !== this.gen || !this.config.enabled) return
    try {
      // Not logged in: Claude Code would show its login menu, where a key press opens a browser. So no session
      // is started until the user logs in on purpose.
      this.auth = await this.d.auth()
      if (gen !== this.gen) return
      if (!this.auth.loggedIn) {
        this.usage = undefined
        this.why = this.auth.error ?? 'not logged in'
        this.fails = 0
        return
      }
      await this.kill() // a leftover of a crashed app
      this.why = 'starting session…'
      const env = [`PATH=${shellQuote(this.d.env?.() ?? process.env['PATH'] ?? '')}`, this.config.configDir ? `CLAUDE_CONFIG_DIR=${shellQuote(this.config.configDir)}` : '']
        .filter(Boolean)
        .join(' ')
      await this.d.screen.newSession(this.session, this.d.cwd, `env ${env} ${shellQuote(bin)}`, 140, 45)
      if (gen !== this.gen) return
      let reading: UsageReading | undefined
      let limited = false
      if (await this.prompt(gen)) {
        for (let attempt = 1; attempt <= 3 && !reading && !limited && gen === this.gen; attempt++) {
          const r = await this.query(gen)
          if (r === 'rate-limited') limited = true
          else reading = r
          if (!reading && !limited && attempt < 3) await this.sleep(3000)
        }
      } else if (gen === this.gen) {
        this.why = 'session did not become ready'
      }
      if (gen !== this.gen) return
      if (limited) {
        // Not a failure of the session: keep the last good reading and wait longer each time (2, 4, 8 … 15 minutes)
        this.backoffMs = Math.min(Math.max(this.backoffMs * 2, 2 * 60_000), 15 * 60_000)
        this.rateLimitedUntil = this.now() + this.backoffMs
        this.why = 'rate limited by Claude'
        this.fails = 0
        if (this.usage && this.now() - this.usage.at >= STALE_AFTER_MS) this.usage = undefined
      } else {
        // a failed reading keeps showing the last good one for a while instead of clearing it
        this.usage = reading ?? (this.usage && this.now() - this.usage.at < STALE_AFTER_MS ? this.usage : undefined)
        if (reading) {
          this.why = ''
          this.fails = 0
          this.backoffMs = 0
          this.rateLimitedUntil = 0
        } else this.fails++
      }
    } catch (err) {
      if (gen !== this.gen) return
      this.usage = undefined
      this.why = (err as Error).message
      this.fails++
    } finally {
      // every reading ends its session, whatever happened: the next one starts from scratch
      await this.kill()
    }
  }
}
