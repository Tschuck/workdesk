import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ALL_PROFILES, DEFAULT_PROFILE_ID, filterState } from './domain/profiles'
import { ProfilesService } from './profiles-service'
import { WorkDeskService } from './service'
import { FakeGit } from './status/fake-git'

let root: string
let profiles: ProfilesService
let services: WorkDeskService[] = []
const open = async (): Promise<WorkDeskService> => {
  const s = new WorkDeskService(root, new FakeGit(), Date.now, profiles)
  await s.load()
  services.push(s)
  return s
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workdesk-prof-'))
  let n = 0
  profiles = new ProfilesService(join(root, 'userdata', 'profiles.json'), () => `p${++n}`)
  await profiles.load()
  services = []
})
afterEach(async () => {
  for (const s of services) s.status.autoCommit.dispose()
  await rm(root, { recursive: true, force: true })
})

/** What an installation from before Profiles left behind: no tags, no profiles.json. */
async function writeOldLayout(): Promise<{ todos: string; desk: string }> {
  const status = join(root, 'workdesk-status')
  await mkdir(join(status, 'desks', 'fix-login'), { recursive: true })
  const todos = [
    { id: 't1', title: 'Fix login', topics: ['auth'], list: 'today', deskId: 'fix-login', resolved: false, createdAt: 1 },
    { id: 't2', title: 'Write docs', topics: [], list: 'backlog', resolved: false, createdAt: 2 }
  ]
  const desk = { id: 'fix-login', name: 'Fix login', kind: 'plain', stage: 'implement', stageOverridden: false, priority: 0, presence: 'inactive', todoIds: ['t1'], branches: [], createdAt: 1, claudeAccountId: 'acc-1' }
  await writeFile(join(status, 'todos.json'), JSON.stringify(todos, null, 2) + '\n')
  await writeFile(join(status, 'desks', 'fix-login', 'desk.json'), JSON.stringify(desk, null, 2) + '\n')
  return { todos: JSON.stringify(todos, null, 2) + '\n', desk: JSON.stringify(desk, null, 2) + '\n' }
}

describe('Migration: the layout from before Profiles', () => {
  it('loads unchanged: nothing lost, no tag written, everything belongs to the Default Profile', async () => {
    const before = await writeOldLayout()
    expect(profiles.config().profiles.map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID])
    const s = await open()

    const state = s.state()
    expect(state.todos.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(state.desks.map((d) => d.id)).toEqual(['fix-login'])
    expect(state.desks[0]).toMatchObject({ claudeAccountId: 'acc-1', todoIds: ['t1'] })
    for (const item of [...state.todos, ...state.desks]) {
      expect(item).not.toHaveProperty('profileId')
      expect(s.profileOf(item)).toBe(DEFAULT_PROFILE_ID)
    }
    // the files on disk are byte for byte what they were
    expect(await readFile(join(root, 'workdesk-status', 'todos.json'), 'utf8')).toBe(before.todos)
    expect(await readFile(join(root, 'workdesk-status', 'desks', 'fix-login', 'desk.json'), 'utf8')).toBe(before.desk)

    // the Default view shows all of it, a new Profile's view none of it
    expect(filterState(state, DEFAULT_PROFILE_ID, profiles.config()).todos).toHaveLength(2)
    await profiles.add('Product B')
    expect(filterState(state, 'p1', profiles.config()).todos).toHaveLength(0)
    expect(filterState(state, 'p1', profiles.config()).desks).toHaveLength(0)
    expect(filterState(state, ALL_PROFILES, profiles.config())).toBe(state)
  })

  it('still reads and writes old data after a Profile was added: untagged stays Default, new things are tagged', async () => {
    await writeOldLayout()
    await profiles.add('Product B')
    await profiles.setActive('p1')
    const s = await open()

    const added = await s.addTodo({ title: 'B work', topics: [], list: 'today' })
    const b = added.todos.find((t) => t.title === 'B work')!
    expect(b.profileId).toBe('p1')
    expect(added.todos.filter((t) => t.id !== b.id).every((t) => s.profileOf(t) === DEFAULT_PROFILE_ID)).toBe(true)

    const started = await s.startPlainDesk([b.id], '')
    expect(started.desks.find((d) => d.id === 'b-work')?.profileId).toBe('p1')
    // editing an old Todo does not tag it with the Profile in view
    const edited = await s.editTodo('t2', { title: 'Write more docs' })
    expect(edited.todos.find((t) => t.id === 't2')).not.toHaveProperty('profileId')

    // persisted with the tag, and a restart sees the same
    const again = await open()
    expect(again.state().todos.find((t) => t.id === b.id)?.profileId).toBe('p1')
    expect(again.state().desks.find((d) => d.id === 'b-work')?.profileId).toBe('p1')
    expect(again.state().desks.find((d) => d.id === 'fix-login')).not.toHaveProperty('profileId')
  })

  it('a new Todo while all Profiles are shown belongs to the Default Profile', async () => {
    await profiles.add('Product B')
    await profiles.setActive(ALL_PROFILES)
    const s = await open()
    const st = await s.addTodo({ title: 'Anywhere', topics: [], list: 'today' })
    expect(s.profileOf(st.todos[0])).toBe(DEFAULT_PROFILE_ID)
    expect(st.todos[0]).not.toHaveProperty('profileId')
  })

  it('a WorkDesk started from a Todo of another Profile takes that Profile, whatever is in view', async () => {
    await profiles.add('Product B')
    await profiles.setActive('p1')
    const s = await open()
    const b = (await s.addTodo({ title: 'Mine', topics: [], list: 'today' })).todos[0]
    await profiles.setActive(DEFAULT_PROFILE_ID)
    const st = await s.startPlainDesk([b.id], '')
    expect(st.desks[0].profileId).toBe('p1')
  })

  it("removing a Profile gives its Todos and WorkDesks to the Default Profile", async () => {
    await profiles.add('Product B')
    await profiles.setActive('p1')
    const s = await open()
    const t = (await s.addTodo({ title: 'Doomed', topics: [], list: 'today' })).todos[0]
    await s.startPlainDesk([t.id], '')
    await profiles.remove('p1')
    const st = await s.retagProfile('p1', DEFAULT_PROFILE_ID)
    expect(st.todos[0]).not.toHaveProperty('profileId')
    expect(st.desks[0]).not.toHaveProperty('profileId')
    expect(s.profileOf(st.desks[0])).toBe(DEFAULT_PROFILE_ID)
  })
})

describe('Defaults of a Profile', () => {
  it('a WorkDesk without a Claude Account of its own runs under its Profile\'s', async () => {
    await profiles.add('Product B')
    await profiles.setClaudeAccount('p1', 'acc-b')
    await profiles.setActive('p1')
    const s = await open()
    const b = (await s.addTodo({ title: 'B', topics: [], list: 'today' })).todos[0]
    await s.startPlainDesk([b.id], 'B desk')
    await profiles.setActive(DEFAULT_PROFILE_ID)
    const a = (await s.addTodo({ title: 'A', topics: [], list: 'today' })).todos.find((t) => t.title === 'A')!
    await s.startPlainDesk([a.id], 'A desk')
    await s.setDeskClaudeAccount('a-desk', 'own')
    const byId = Object.fromEntries(s.desksWithClaudeAccount().map((d) => [d.id, d.claudeAccountId]))
    expect(byId).toEqual({ 'b-desk': 'acc-b', 'a-desk': 'own' })
    // the stored WorkDesk is not changed by it
    expect(s.state().desks.find((d) => d.id === 'b-desk')).not.toHaveProperty('claudeAccountId')
  })

  it('a repeating WorkDesk made for a Profile plans its WorkDesks in that Profile', async () => {
    await profiles.add('Product B')
    await profiles.setActive('p1')
    const s = await open()
    await s.addSchedule({ templateId: s.listTemplates()[0].id, name: 'Standup', repeat: 'daily', time: '09:00' })
    expect(s.listSchedules()[0].profileId).toBe('p1')
    await profiles.setActive(DEFAULT_PROFILE_ID)
    await s.startTemplateDesk(s.listTemplates()[0].id, 'x', s.listSchedules()[0])
    expect(s.state().desks[0].profileId).toBe('p1')
  })
})

describe('profiles.json', () => {
  it('survives a restart and is repaired when broken', async () => {
    await profiles.add('Product B')
    await profiles.setActive('p1')
    const again = new ProfilesService(join(root, 'userdata', 'profiles.json'))
    await again.load()
    expect(again.config().profiles.map((p) => p.name)).toEqual(['Default', 'Product B'])
    expect(again.config().active).toBe('p1')
    await writeFile(join(root, 'userdata', 'profiles.json'), '{ not json')
    await again.load()
    expect(again.config().profiles.map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID])
  })
})
