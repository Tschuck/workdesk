import { describe, expect, it } from 'vitest'
import {
  accountEnv, accountOfConfigDir, addAccount, DEFAULT_INTERVAL_MIN, limitNotices, migrateAccounts, parseAccounts, removeAccount, renameAccount,
  resolveAccount, sameConfigDir, setAccountDir, setDefaultAccount, usageSessionOf
} from './claude-accounts'

describe('migrating the single-account settings', () => {
  it('keeps the folder and the on/off switch in account #1, which is the default', () => {
    const cfg = migrateAccounts({ enabled: false, configDir: '/home/me/.claude-work/' })
    expect(cfg).toEqual({ enabled: false, intervalMin: DEFAULT_INTERVAL_MIN, defaultId: 'main', accounts: [{ id: 'main', name: 'claude-work', configDir: '/home/me/.claude-work' }] })
  })
  it('makes a "Default" account of the default login, also when there was no file', () => {
    expect(migrateAccounts({ enabled: true })).toMatchObject({ enabled: true, accounts: [{ id: 'main', name: 'Default' }] })
    expect(migrateAccounts(undefined).accounts[0]).toEqual({ id: 'main', name: 'Default' })
    expect(migrateAccounts({ configDir: '  ' }).accounts[0].configDir).toBeUndefined()
  })
  it('round trips through parse', () => {
    const cfg = migrateAccounts({ enabled: true, configDir: '/x/y' })
    expect(parseAccounts(JSON.parse(JSON.stringify(cfg)))).toEqual(cfg)
  })
})

describe('parseAccounts', () => {
  it('drops unusable entries, repairs the default and the interval', () => {
    const cfg = parseAccounts({
      enabled: true, intervalMin: 500, defaultId: 'gone',
      accounts: [{ id: 'a', name: ' Work ', configDir: '/w' }, { id: 'a', name: 'dup' }, { id: 'Bad Id', name: 'x' }, 7, { id: 'b' }]
    })
    expect(cfg).toEqual({ enabled: true, intervalMin: 60, defaultId: 'a', accounts: [{ id: 'a', name: 'Work', configDir: '/w' }, { id: 'b', name: 'Default' }] })
  })
  it('refuses a file without any account', () => {
    expect(parseAccounts({ accounts: [] })).toBeUndefined()
    expect(parseAccounts('x')).toBeUndefined()
    expect(parseAccounts({})).toBeUndefined()
  })
})

describe('editing accounts', () => {
  const base = migrateAccounts({ configDir: '/priv' })
  it('adds with a unique name', () => {
    const a = addAccount(base, 'w1', 'Work', '/work')
    expect(a.accounts.map((x) => x.name)).toEqual(['priv', 'Work'])
    expect(addAccount(a, 'w2', 'work').accounts.at(-1)!.name).toBe('work 2')
    expect(() => addAccount(a, 'w1', 'again')).toThrow()
    expect(() => addAccount(a, 'no way', 'x')).toThrow()
  })
  it('renames, sets the folder, changes the default', () => {
    let c = addAccount(base, 'w1', 'Work', '/work')
    c = renameAccount(c, 'w1', 'Job')
    expect(() => renameAccount(c, 'main', 'job')).toThrow(/already/)
    expect(() => renameAccount(c, 'main', ' ')).toThrow()
    c = setAccountDir(c, 'w1', undefined)
    expect(c.accounts[1]).toEqual({ id: 'w1', name: 'Job' })
    c = setDefaultAccount(c, 'w1')
    expect(c.defaultId).toBe('w1')
    expect(() => setDefaultAccount(c, 'nope')).toThrow()
  })
  it('removes, moves the default, keeps the last', () => {
    let c = setDefaultAccount(addAccount(base, 'w1', 'Work'), 'w1')
    c = removeAccount(c, 'w1')
    expect(c.defaultId).toBe('main')
    expect(() => removeAccount(c, 'main')).toThrow(/last/)
  })
})

describe('which account', () => {
  const c = setDefaultAccount(addAccount(migrateAccounts({ configDir: '/priv' }), 'w1', 'Work', '/work'), 'w1')
  it('resolves a WorkDesk choice, falling back to the default', () => {
    expect(resolveAccount(c, 'main').id).toBe('main')
    expect(resolveAccount(c, undefined).id).toBe('w1')
    expect(resolveAccount(c, 'removed').id).toBe('w1')
  })
  it('finds the account of a config folder', () => {
    expect(accountOfConfigDir(c, '/work/')?.id).toBe('w1')
    expect(accountOfConfigDir(c, '/elsewhere')).toBeUndefined()
    expect(sameConfigDir(undefined, '')).toBe(true)
  })
  it('sets CLAUDE_CONFIG_DIR only for an account with a folder', () => {
    expect(accountEnv(c.accounts[1])).toEqual({ CLAUDE_CONFIG_DIR: '/work' })
    expect(accountEnv({ id: 'x', name: 'x' })).toEqual({})
    expect(usageSessionOf('w1')).toBe('_workdesk-usage-w1')
  })
})

describe('limit notices', () => {
  it('name the account and fire once, when a limit turns red', () => {
    expect(limitNotices('Work', { session: 80, week: 10 }, { session: 91, week: 10 })).toEqual([
      { title: 'Claude (Work): 5-hour limit almost used', body: '91% of the session limit is used on Work.' }
    ])
    expect(limitNotices('Work', { session: 91 }, { session: 95 })).toEqual([])
    expect(limitNotices('Work', undefined, { session: 99 })).toEqual([])
    expect(limitNotices('Priv', { session: 1, week: 89 }, { session: 1, week: 90 })[0].title).toContain('Priv')
  })
})
