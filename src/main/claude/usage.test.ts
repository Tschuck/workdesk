import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AuthStatus, LoginProcess } from './auth'
import { findClaudeBinary, parseUsage, USAGE_SESSION, UsageService, type Screen, type UsageDeps, type UsageState } from './usage'

const SCREEN = `
 Settings:  Status   Config   Usage

 Current session
 ███████████▌                                       23% used
 Resets 3:00pm (Europe/Berlin)

 Current week (all models)
 ████████                                           16% used
 Resets Oct 30, 9:00am (Europe/Berlin)
`

describe('parseUsage', () => {
  it('reads session and week with their reset times', () => {
    expect(parseUsage(SCREEN)).toEqual({ session: 23, week: 16, sessionResets: '3:00pm (Europe/Berlin)', weekResets: 'Oct 30, 9:00am (Europe/Berlin)' })
  })
  it('works with only a session, and rejects other screens', () => {
    expect(parseUsage('Current session\n 7% used\n')).toEqual({ session: 7, week: undefined, sessionResets: undefined, weekResets: undefined })
    expect(parseUsage('❯ ')).toBeUndefined()
    expect(parseUsage('Current session\n loading…')).toBeUndefined()
  })
  it('finds the claude binary in the PATH or the installer folders', () => {
    expect(findClaudeBinary('/a:/b', (p) => p === '/b/claude')).toBe('/b/claude')
    expect(findClaudeBinary('/a', () => false)).toBeUndefined()
  })
})

class FakeScreen implements Screen {
  sessions = new Set<string>()
  keys: string[] = []
  created: { command: string; cols: number }[] = []
  killed = 0
  private list: string[] = ['❯ ']
  private at = 0
  /** what capture-pane returns, in order; the last one repeats. Assigning starts over. */
  get screens() { return this.list }
  set screens(v: string[]) { this.list = v; this.at = 0 }
  async hasSession(s: string) { return this.sessions.has(s) }
  async newSession(s: string, _cwd: string, command: string, cols: number) { this.sessions.add(s); this.created.push({ command, cols }) }
  async sendKeys(_s: string, keys: string[], literal = false) { this.keys.push((literal ? 'lit:' : '') + keys.join(' ')) }
  async capture() { return this.list[Math.min(this.at++, this.list.length - 1)] }
  async killSession(s: string) { this.sessions.delete(s); this.killed++ }
}

/** Dependencies for the login side of the service: logged in, and a login that was never asked for */
const loggedIn = (over: Partial<UsageDeps> = {}): Pick<UsageDeps, 'auth' | 'startLogin' | 'logout'> => ({
  auth: async () => ({ loggedIn: true, email: 'me@example.com' }),
  startLogin: () => { throw new Error('login must not start by itself') },
  logout: async () => undefined,
  ...over
})

describe('UsageService', () => {
  let dir: string
  let screen: FakeScreen
  let changes: UsageState[]
  let svc: UsageService
  let bin: string | undefined
  let t: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'workdesk-usage-'))
    screen = new FakeScreen()
    changes = []
    bin = '/opt/homebrew/bin/claude'
    t = 1000
    svc = new UsageService({
      screen, cwd: dir, binary: () => bin, configFile: join(dir, 'claude-usage.json'), env: () => '/opt/homebrew/bin:/usr/bin', ...loggedIn(),
      now: () => t, sleep: async (ms) => void (t += ms), onChange: (s) => changes.push(s)
    })
    await svc.load()
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('starts the hidden session for a reading, asks /usage, shows the reading and ends the session again', async () => {
    screen.screens = ['❯ ', SCREEN]
    await svc.poll()
    expect(screen.created).toEqual([{ command: "env PATH='/opt/homebrew/bin:/usr/bin' '/opt/homebrew/bin/claude'", cols: 140 }])
    expect(screen.keys).toEqual(['Escape', 'lit:/usage', 'Enter', 'Escape'])
    const s = svc.state()
    expect(s).toMatchObject({ loading: false, why: '', usage: { session: 23, week: 16 } })
    expect(changes.some((c) => c.loading)).toBe(true)

    // nothing runs between two readings
    expect(screen.sessions.size).toBe(0)
    expect(screen.killed).toBeGreaterThanOrEqual(1)

    // the next round starts a session of its own
    screen.screens = ['❯ ', SCREEN.replace('23%', '40%')]
    await svc.poll()
    expect(screen.created).toHaveLength(2)
    expect(screen.sessions.size).toBe(0)
    expect(svc.state().usage?.session).toBe(40)
  })

  it('watches the chosen account and saves the choice', async () => {
    await svc.setConfig({ configDir: "/home/me/.config/claude/work's" })
    screen.screens = ['❯ ', SCREEN]
    await svc.poll()
    expect(screen.created[0].command).toBe("env PATH='/opt/homebrew/bin:/usr/bin' CLAUDE_CONFIG_DIR='/home/me/.config/claude/work'\\''s' '/opt/homebrew/bin/claude'")
    expect(JSON.parse(await readFile(join(dir, 'claude-usage.json'), 'utf8'))).toMatchObject({ enabled: true, configDir: "/home/me/.config/claude/work's" })
    const again = new UsageService({ screen, cwd: dir, binary: () => bin, configFile: join(dir, 'claude-usage.json'), ...loggedIn() })
    await again.load()
    expect(again.state().configDir).toBe("/home/me/.config/claude/work's")
  })

  it('accepts the trust question once, retries a screen without usage, and reports why it failed', async () => {
    // the real dialog: "No, exit" is selected, and it shows the same ❯ marker as the prompt
    const dialog = ' Quick safety check: Is this a project you created or one you trust?\n ❯ No, exit\n   Yes, I trust this folder\n Enter to confirm · Esc to cancel'
    screen.screens = [dialog, '❯ ', 'loading…', 'loading…', 'loading…']
    await svc.poll()
    expect(screen.keys.slice(0, 2)).toEqual(['Down', 'Enter'])
    expect(screen.keys).not.toContain('Escape' + ' first')
    expect(svc.state().usage).toBeUndefined()
    expect(svc.state().why).toContain('no /usage screen')
    expect(screen.keys.filter((k) => k === 'lit:/usage')).toHaveLength(3)
  })

  it('says so when claude is missing or the session never gets ready, and when switched off', async () => {
    bin = undefined
    await svc.poll()
    expect(svc.state().why).toMatch(/claude not found/)
    bin = '/x/claude'
    screen.screens = ['starting…']
    await svc.poll()
    expect(svc.state().why).toBe('session did not become ready')
    await svc.setConfig({ enabled: false })
    expect(svc.state()).toMatchObject({ enabled: false, usage: undefined, why: 'switched off' })
    const before = screen.keys.length
    await svc.poll()
    expect(screen.keys.length).toBe(before)
  })

  it('leaves no session behind after a failed reading, and starts afresh the next time', async () => {
    screen.screens = ['starting…']
    for (let i = 0; i < 3; i++) {
      await svc.poll()
      expect(screen.sessions.size).toBe(0)
    }
    expect(screen.created).toHaveLength(3)
    screen.screens = ['❯ ', SCREEN]
    await svc.poll()
    expect(svc.state().usage?.session).toBe(23)
  })

  it('ends the session when the reading throws', async () => {
    screen.capture = async () => { throw new Error('tmux died') }
    screen.sendKeys = async () => { throw new Error('tmux died') }
    await svc.poll()
    expect(screen.sessions.size).toBe(0)
    expect(svc.state().loading).toBe(false)
  })

  it('reads one account at a time when they share a lock, each in a session of its own', async () => {
    let tail: Promise<unknown> = Promise.resolve()
    const lock = <T,>(job: () => Promise<T>): Promise<T> => {
      const run = tail.then(job, job)
      tail = run.catch(() => undefined)
      return run
    }
    let open = 0
    let most = 0
    const names: string[] = []
    class Spy extends FakeScreen {
      async newSession(s: string, cwd: string, command: string, cols: number) { open++; most = Math.max(most, open); names.push(s); await super.newSession(s, cwd, command, cols) }
      async killSession(s: string) { if (this.sessions.has(s)) open--; await super.killSession(s) }
    }
    const shared = new Spy()
    shared.screens = ['❯ ' + SCREEN]
    const mk = (id: string) => new UsageService({ screen: shared, session: `_workdesk-usage-${id}`, lock, cwd: dir, binary: () => bin, initial: { enabled: true }, ...loggedIn(), sleep: async () => undefined })
    const a = mk('a')
    const b = mk('b')
    await Promise.all([a.poll(), b.poll()])
    expect(most).toBe(1)
    expect(names).toEqual(['_workdesk-usage-a', '_workdesk-usage-b'])
    expect(a.state().usage?.session).toBe(23)
    expect(b.state().usage?.session).toBe(23)
    expect(shared.sessions.size).toBe(0)
  })

  it('keeps its settings in memory when it has no file, and reads nothing while switched off', async () => {
    const mem = new UsageService({ screen, cwd: dir, binary: () => bin, initial: { enabled: false, configDir: '/c' }, ...loggedIn() })
    await mem.poll()
    expect(screen.created).toEqual([])
    expect(mem.state()).toMatchObject({ enabled: false, configDir: '/c' })
  })

  it('does not run two rounds at once', async () => {
    screen.screens = ['❯ ', SCREEN]
    await Promise.all([svc.poll(), svc.poll()])
    expect(screen.keys.filter((k) => k === 'lit:/usage')).toHaveLength(1)
  })
})

describe('the trust dialog', () => {
  it('is answered with Yes, also when Yes is already selected, and never mistaken for the prompt', async () => {
    const screen = new FakeScreen()
    const svc = new UsageService({ screen, cwd: '/x', binary: () => '/bin/claude', configFile: '/nonexistent/u.json', sleep: async () => undefined, ...loggedIn() })
    screen.screens = ['Quick safety check\n   No, exit\n ❯ Yes, I trust this folder', '❯ ', SCREEN]
    await svc.poll()
    expect(screen.keys.slice(0, 1)).toEqual(['Enter'])
    expect(svc.state().usage?.session).toBe(23)
  })
})

describe('login', () => {
  let screen: FakeScreen
  let status: AuthStatus
  let logins: { cancelled: boolean; finish: () => void; fail: (m: string) => void; urlCb: (u: string) => void }[]
  let svc: UsageService
  let changes: UsageState[]

  beforeEach(() => {
    screen = new FakeScreen()
    status = { loggedIn: false }
    logins = []
    changes = []
    svc = new UsageService({
      screen, cwd: '/x', binary: () => '/bin/claude', configFile: '/nonexistent/u.json', sleep: async () => undefined,
      onChange: (s) => changes.push(s),
      auth: async () => status,
      startLogin: (onUrl) => {
        let finish!: () => void
        let fail!: (m: string) => void
        const done = new Promise<void>((res, rej) => { finish = res; fail = (m) => rej(new Error(m)) })
        const p: LoginProcess = { done, cancel: () => { entry.cancelled = true; fail('Login was cancelled') } }
        const entry = { cancelled: false, finish, fail, urlCb: onUrl }
        logins.push(entry)
        return p
      },
      logout: async () => { status = { loggedIn: false } }
    })
  })

  it('does not start a Claude session, and so cannot open a login page, while logged out', async () => {
    screen.sessions.add(USAGE_SESSION)
    await svc.poll()
    expect(screen.created).toEqual([])
    expect(screen.keys).toEqual([])
    expect(screen.sessions.has(USAGE_SESSION)).toBe(false)
    expect(logins).toEqual([])
    expect(svc.state()).toMatchObject({ auth: { loggedIn: false }, usage: undefined, why: 'not logged in', loading: false })
    expect(changes.at(-1)!.auth?.loggedIn).toBe(false)
  })

  it('logs in only when asked, shows the URL, then reads the usage', async () => {
    const login = svc.login()
    expect(svc.state().login).toEqual({ running: true })
    logins[0].urlCb('https://claude.ai/oauth/authorize?x=1')
    expect(svc.state().login).toEqual({ running: true, url: 'https://claude.ai/oauth/authorize?x=1' })
    await svc.login() // a second press while one is running does nothing
    expect(logins).toHaveLength(1)

    status = { loggedIn: true, email: 'me@example.com', plan: 'pro' }
    screen.screens = ['❯ ', SCREEN]
    logins[0].finish()
    await login
    expect(svc.state().login).toEqual({ running: false })
    expect(svc.state().auth).toMatchObject({ loggedIn: true, email: 'me@example.com' })
    expect(svc.state().usage?.session).toBe(23)
  })

  it('reports a failed or cancelled login and stays logged out', async () => {
    const failed = svc.login()
    logins[0].fail('claude auth login exited with 1')
    await failed
    expect(svc.state().login).toEqual({ running: false, error: 'claude auth login exited with 1' })

    const cancelled = svc.login()
    svc.cancelLogin()
    await cancelled
    expect(logins[1].cancelled).toBe(true)
    expect(svc.state().login.error).toBe('Login was cancelled')
    expect(svc.state().auth?.loggedIn).toBe(false)
  })

  it('logs out and stops reading', async () => {
    status = { loggedIn: true }
    screen.screens = ['❯ ', SCREEN]
    await svc.poll()
    expect(svc.state().usage?.session).toBe(23)
    await svc.logout()
    expect(svc.state()).toMatchObject({ usage: undefined, why: 'logged out', auth: { loggedIn: false } })
    expect(screen.sessions.has(USAGE_SESSION)).toBe(false)
  })
})

describe('rate limited /usage', () => {
  const LIMITED = ' Settings:  Status   Config   Usage\n\n Usage endpoint is rate limited. Please try again in a moment.\n\n r to retry · Esc to cancel'
  let screen: FakeScreen
  let t: number
  let svc: UsageService
  let changes: UsageState[]

  beforeEach(() => {
    screen = new FakeScreen()
    t = 1_000_000
    changes = []
    svc = new UsageService({
      screen, cwd: '/x', binary: () => '/bin/claude', configFile: '/nonexistent/u.json', env: () => '/bin',
      now: () => t, sleep: async (ms) => void (t += ms), onChange: (s) => changes.push(s), ...loggedIn()
    })
  })

  it('keeps the last reading, waits before asking again, and never restarts the session for it', async () => {
    screen.screens = ['❯ ', SCREEN]
    await svc.poll()
    const good = svc.state().usage!
    expect(good.session).toBe(23)

    screen.screens = ['❯ ', LIMITED]
    await svc.poll()
    let s = svc.state()
    expect(s.usage).toEqual(good)
    expect(s.why).toBe('rate limited by Claude')
    expect(s.retryAt).toBeGreaterThan(t)
    const retryAfter = s.retryAt! - t
    expect(retryAfter).toBeGreaterThanOrEqual(110_000)
    expect(screen.keys.filter((k) => k === 'lit:/usage')).toHaveLength(2)
    // it pressed Escape (not "r") and did not retry within the same round
    expect(screen.keys.at(-1)).toBe('Escape')
    expect(screen.keys).not.toContain('r')

    // polls during the wait ask nothing
    const before = screen.keys.length
    await svc.poll()
    await svc.poll()
    expect(screen.keys.length).toBe(before)

    // waiting longer each time, up to 15 minutes, and never a restart
    for (let i = 0; i < 8; i++) {
      t = svc.state().retryAt! + 1
      screen.screens = ['❯ ', LIMITED]
      await svc.poll()
    }
    expect(svc.state().retryAt! - t).toBeLessThanOrEqual(15 * 60_000)
    expect(svc.state().retryAt! - t).toBeGreaterThan(10 * 60_000)
    expect(svc.state().usage).toBeUndefined() // 30 minutes passed: too old to show as current

    // once it answers again, the numbers are back and the waiting is forgotten
    t = svc.state().retryAt! + 1
    screen.screens = ['❯ ', SCREEN.replace('23%', '31%')]
    await svc.poll()
    s = svc.state()
    expect(s.usage?.session).toBe(31)
    expect(s.retryAt).toBeUndefined()
    expect(s.why).toBe('')
    screen.screens = ['❯ ', LIMITED]
    t += 130_000
    await svc.poll()
    expect(svc.state().retryAt! - t).toBeLessThan(3 * 60_000) // started again at 2 minutes
  })

  it('keeps a reading that could not be renewed for a while, instead of clearing it', async () => {
    screen.screens = ['❯ ', SCREEN]
    await svc.poll()
    t += 5 * 60_000
    screen.screens = ['❯ ', 'loading…', 'loading…', 'loading…', 'loading…']
    await svc.poll()
    expect(svc.state().usage?.session).toBe(23)
    expect(svc.state().why).toContain('no /usage screen')
  })
})
