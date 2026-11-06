import { describe, expect, it } from 'vitest'
import {
  ALL_PROFILES, DEFAULT_PROFILE_ID, THEME_COLOR, cssColor, HOME_REPO_ID, addProfile, addRepo, creationProfileId, defaultConfig, effectiveClaudeAccountId, filterState, forgetRepo, parseConfig,
  profileIdOf, removeProfile, renameProfile, retag, setActive, setProfileClaudeAccount, setProfileColor, setProfileRepo, signalCounts, stampNew
} from './profiles'
import type { Todo, WorkDesk } from './types'
import { daySummary } from './time-tracking'

const desk = (id: string, over: Partial<WorkDesk> = {}): WorkDesk => ({
  id, name: id, stage: 'implement', stageOverridden: false, priority: 0, presence: 'inactive', todoIds: [], branches: [], signals: [], createdAt: 0, ...over
})
const todo = (id: string, over: Partial<Todo> = {}): Todo => ({ id, title: id, topics: [], list: 'today', resolved: false, createdAt: 0, ...over })

describe('Profiles configuration', () => {
  it('colours the Default Profile with the theme\'s yellow until it is changed by hand', () => {
    expect(defaultConfig().profiles[0].color).toBe(THEME_COLOR)
    expect(cssColor(THEME_COLOR)).toBe('var(--yellow)')
    const old = { version: 1, profiles: [{ id: DEFAULT_PROFILE_ID, name: 'Default', color: '#4f9cf9', repoId: HOME_REPO_ID }], repos: [], active: DEFAULT_PROFILE_ID }
    expect(parseConfig(old).profiles[0].color).toBe(THEME_COLOR)
    expect(parseConfig({ ...old, profiles: [{ ...old.profiles[0], color: '#e05d6f' }] }).profiles[0].color).toBe('#e05d6f')
  })

  it('starts as the one Default Profile on the home Status Repo', () => {
    const c = defaultConfig()
    expect(c.profiles).toMatchObject([{ id: DEFAULT_PROFILE_ID, name: 'Default', repoId: HOME_REPO_ID }])
    expect(c.active).toBe(DEFAULT_PROFILE_ID)
    expect(parseConfig(undefined)).toEqual(c)
    expect(parseConfig({ nonsense: 1 })).toEqual(c)
  })

  it('repairs a stored config: Default first, dangling repo falls back home, all needs two Profiles', () => {
    const c = parseConfig({
      profiles: [{ id: 'b', name: 'B', color: '#112233', repoId: 'gone' }],
      repos: [{ id: 'r1', label: 'x', path: '/tmp/x' }, { id: 'bad' }],
      active: ALL_PROFILES
    })
    expect(c.profiles.map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID, 'b'])
    expect(c.profiles[1].repoId).toBe(HOME_REPO_ID)
    expect(c.repos.map((r) => r.id)).toEqual([HOME_REPO_ID, 'r1'])
    // "all" from an older version is the Default Profile now: one Profile is always in view
    expect(c.active).toBe(DEFAULT_PROFILE_ID)
    expect(parseConfig({ profiles: [], active: ALL_PROFILES }).active).toBe(DEFAULT_PROFILE_ID)
  })

  it('adds, renames, colours and removes Profiles; the Default one stays', () => {
    let c = addProfile(defaultConfig(), 'p2', ' Work B ')
    expect(c.profiles[1]).toMatchObject({ id: 'p2', name: 'Work B', repoId: HOME_REPO_ID })
    expect(c.profiles[1].color).not.toBe(c.profiles[0].color)
    expect(() => addProfile(c, 'p3', 'work b')).toThrow(/already/)
    expect(() => addProfile(c, 'p3', ' ')).toThrow(/name/)
    c = renameProfile(c, 'p2', 'Product B')
    c = setProfileColor(c, 'p2', '#aabbcc')
    expect(() => setProfileColor(c, 'p2', 'red')).toThrow()
    expect(c.profiles[1]).toMatchObject({ name: 'Product B', color: '#aabbcc' })
    expect(() => removeProfile(c, DEFAULT_PROFILE_ID)).toThrow(/Default/)
    c = setActive(c, 'p2')
    c = removeProfile(c, 'p2')
    expect(c.profiles.map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID])
    expect(c.active).toBe(DEFAULT_PROFILE_ID)
  })

  it('one Profile is always in view: "all" is not a choice and changes nothing', () => {
    expect(setActive(defaultConfig(), ALL_PROFILES).active).toBe(DEFAULT_PROFILE_ID)
    const c = addProfile(defaultConfig(), 'p2', 'B')
    expect(setActive(setActive(c, 'p2'), ALL_PROFILES).active).toBe('p2')
    expect(removeProfile(setActive(c, 'p2'), 'p2').active).toBe(DEFAULT_PROFILE_ID)
    expect(() => setActive(c, 'nope')).toThrow(/Unknown Profile/)
  })

  it('registers Status Repos once per folder and forgets only unused ones', () => {
    let c = addRepo(defaultConfig(), { id: 'r1', label: 'B repo', path: '/data/b' })
    expect(() => addRepo(c, { id: 'r2', label: 'again', path: '/data/b' })).toThrow(/already/)
    c = addProfile(c, 'p2', 'B', 'r1')
    expect(() => forgetRepo(c, 'r1')).toThrow(/still uses/)
    expect(() => forgetRepo(c, HOME_REPO_ID)).toThrow(/home/)
    c = setProfileRepo(c, 'p2', HOME_REPO_ID)
    expect(forgetRepo(c, 'r1').repos.map((r) => r.id)).toEqual([HOME_REPO_ID])
    expect(() => setProfileRepo(c, 'p2', 'nope')).toThrow()
  })
})

describe('Tags, views and defaults', () => {
  const cfg = addProfile(defaultConfig(), 'b', 'B')

  it('untagged things belong to Profile #1, as do things of a Profile that is gone', () => {
    expect(profileIdOf({}, cfg)).toBe(DEFAULT_PROFILE_ID)
    expect(profileIdOf({ profileId: 'b' }, cfg)).toBe('b')
    expect(profileIdOf({ profileId: 'deleted' }, cfg)).toBe(DEFAULT_PROFILE_ID)
  })

  it('filters Todos and WorkDesks by the view; "all" is no filter', () => {
    const state = { todos: [todo('t1'), todo('t2', { profileId: 'b' })], desks: [desk('d1'), desk('d2', { profileId: 'b' }), desk('d3', { profileId: DEFAULT_PROFILE_ID })] }
    expect(filterState(state, DEFAULT_PROFILE_ID, cfg).desks.map((d) => d.id)).toEqual(['d1', 'd3'])
    expect(filterState(state, 'b', cfg).todos.map((t) => t.id)).toEqual(['t2'])
    expect(filterState(state, ALL_PROFILES, cfg)).toBe(state)
  })

  it('new things get the tag of the Profile in view; Default things stay untagged', () => {
    expect(creationProfileId({ active: 'b' })).toBe('b')
    expect(creationProfileId({ active: ALL_PROFILES })).toBe(DEFAULT_PROFILE_ID)
    expect(stampNew(todo('t'), 'b').profileId).toBe('b')
    expect(stampNew(todo('t'), DEFAULT_PROFILE_ID)).not.toHaveProperty('profileId')
    expect(stampNew(todo('t', { profileId: 'x' }), 'b').profileId).toBe('x')
  })

  it("retag hands a removed Profile's things to another and leaves the rest alone", () => {
    const list = [todo('a', { profileId: 'b' }), todo('c'), todo('d', { profileId: 'z' })]
    const out = retag(list, 'b', DEFAULT_PROFILE_ID)
    expect(out[0]).not.toHaveProperty('profileId')
    expect(out[1]).toBe(list[1])
    expect(out[2]).toBe(list[2])
    expect(retag(list, 'b', 'q')[0].profileId).toBe('q')
  })

  it("a WorkDesk uses its own Claude Account, else the Profile's", () => {
    const c = setProfileClaudeAccount(cfg, 'b', 'acc-b')
    expect(effectiveClaudeAccountId({ profileId: 'b' }, c)).toBe('acc-b')
    expect(effectiveClaudeAccountId({ profileId: 'b', claudeAccountId: 'own' }, c)).toBe('own')
    expect(effectiveClaudeAccountId({}, c)).toBeUndefined()
    expect(setProfileClaudeAccount(c, 'b', null).profiles[1]).not.toHaveProperty('claudeAccountId')
  })

  it('time today of one Profile counts only the WorkDesks it lists', () => {
    const log = { '2026-01-02': { a: 600, b: 300, gone: 100 } }
    expect(daySummary(log, '2026-01-02', { a: 'A' }).total).toBe(1000)
    const s = daySummary(log, '2026-01-02', { a: 'A' }, true)
    expect(s.total).toBe(600)
    expect(s.entries.map((e) => e.deskId)).toEqual(['a'])
  })

  it('counts open Signals per Profile for the badge', () => {
    const sig = (read: boolean, id: string) => ({ id, type: 'claude-finished' as const, at: 1, read })
    const desks = [desk('a', { signals: [sig(false, '1'), sig(true, '2')] }), desk('b1', { profileId: 'b', signals: [sig(false, '3'), sig(false, '4')] }), desk('b2', { profileId: 'b' })]
    expect(signalCounts(desks, cfg)).toEqual({ [DEFAULT_PROFILE_ID]: 1, b: 2 })
  })
})
