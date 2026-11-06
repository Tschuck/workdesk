import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LimitNotice } from '../domain/claude-accounts'
import { AccountsService, type AccountsDeps } from './accounts'
import type { Screen } from './usage'

const SCREEN = '❯ \n Current session\n 23% used\n Resets 3:00pm\n\n Current week (all models)\n 16% used\n Resets Oct 30'

class FakeScreen implements Screen {
  sessions = new Set<string>()
  created: { name: string; command: string }[] = []
  open = 0
  most = 0
  text = SCREEN
  async hasSession(s: string) { return this.sessions.has(s) }
  async newSession(s: string, _cwd: string, command: string) { this.sessions.add(s); this.created.push({ name: s, command }); this.open = this.sessions.size; this.most = Math.max(this.most, this.open) }
  async sendKeys() { /* nothing */ }
  async capture() { return this.text }
  async killSession(s: string) { this.sessions.delete(s) }
}

describe('AccountsService', () => {
  let dir: string
  let screen: FakeScreen
  let notices: LimitNotice[]
  let n: number
  const make = (over: Partial<AccountsDeps> = {}) =>
    new AccountsService({
      file: join(dir, 'claude-accounts.json'), legacyFile: join(dir, 'claude-usage.json'), screen, cwd: dir, binary: () => '/bin/claude', env: () => '/bin',
      makeAuth: (configDir) => ({ status: async () => ({ loggedIn: true, configDir: configDir() }), startLogin: () => { throw new Error('no login') }, logout: async () => undefined }),
      newId: () => `id${++n}`, onNotice: (x) => notices.push(x), sleep: async () => undefined, ...over
    })

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'workdesk-accounts-'))
    screen = new FakeScreen()
    notices = []
    n = 0
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('migrates the single-account settings into account #1 and keeps the old file', async () => {
    const legacy = JSON.stringify({ enabled: false, configDir: '/home/me/.claude-work' })
    await writeFile(join(dir, 'claude-usage.json'), legacy)
    const svc = make()
    await svc.load()
    expect(svc.state()).toMatchObject({ enabled: false, defaultId: 'id1', accounts: [{ account: { id: 'id1', name: 'claude-work', configDir: '/home/me/.claude-work' }, isDefault: true }] })
    expect(JSON.parse(await readFile(join(dir, 'claude-accounts.json'), 'utf8'))).toMatchObject({ defaultId: 'id1', accounts: [{ configDir: '/home/me/.claude-work' }] })
    expect(await readFile(join(dir, 'claude-usage.json'), 'utf8')).toBe(legacy)
    // the second start reads the new file and does not migrate again
    const again = make({ newId: () => 'other' })
    await again.load()
    expect(again.state().defaultId).toBe('id1')
  })

  it('starts with one default account when there was nothing before', async () => {
    const svc = make()
    await svc.load()
    expect(svc.state().accounts.map((a) => a.account.name)).toEqual(['Default'])
  })

  it('adds, renames, changes the folder, sets the default and removes, and keeps it on disk', async () => {
    const svc = make()
    await svc.load()
    await svc.add('Work', '/work')
    await svc.rename('id2', 'Job')
    await svc.setDir('id2', '/job')
    await svc.setDefault('id2')
    let s = svc.state()
    expect(s.accounts.map((a) => [a.account.name, a.account.configDir, a.isDefault])).toEqual([['Default', undefined, false], ['Job', '/job', true]])
    const reloaded = make()
    await reloaded.load()
    expect(reloaded.state().accounts.map((a) => a.account.name)).toEqual(['Default', 'Job'])
    s = await svc.remove('id2')
    expect(s.defaultId).toBe('id1')
    await expect(svc.remove('id1')).rejects.toThrow(/last/)
  })

  it('reads every account one after the other, each in its own session with its own folder', async () => {
    const svc = make()
    await svc.load()
    await svc.add('Work', '/work')
    await svc.refreshAll()
    expect(screen.most).toBe(1)
    expect(screen.created.map((c) => c.name)).toEqual(['_workdesk-usage-id1', '_workdesk-usage-id2'])
    expect(screen.created[1].command).toContain("CLAUDE_CONFIG_DIR='/work'")
    expect(screen.created[0].command).not.toContain('CLAUDE_CONFIG_DIR')
    expect(svc.state().accounts.map((a) => a.usage.usage?.session)).toEqual([23, 23])
    expect(screen.sessions.size).toBe(0)
  })

  it('notifies once, naming the account, when a limit turns red', async () => {
    const svc = make()
    await svc.load()
    await svc.add('Work', '/work')
    await svc.refreshAll()
    screen.text = SCREEN.replace('23%', '93%')
    await svc.refreshAll()
    expect(notices.map((x) => x.title)).toEqual(['Claude (Default): 5-hour limit almost used', 'Claude (Work): 5-hour limit almost used'])
    await svc.refreshAll()
    expect(notices).toHaveLength(2)
  })

  it('reads nothing while paused (the Claude part is closed) or switched off', async () => {
    const svc = make()
    await svc.load()
    await svc.pause()
    expect(svc.paused).toBe(true)
    svc.setLocked(false)
    expect(screen.created).toEqual([])
    await svc.setEnabled(false)
    await svc.refreshAll()
    expect(screen.created).toEqual([])
    expect(svc.state().enabled).toBe(false)
  })

  it('keeps the interval within 1 to 60 minutes', async () => {
    const svc = make()
    await svc.load()
    expect((await svc.setInterval(0)).intervalMin).toBe(1)
    expect((await svc.setInterval(500)).intervalMin).toBe(60)
    expect((await svc.setInterval(10)).intervalMin).toBe(10)
  })
})
