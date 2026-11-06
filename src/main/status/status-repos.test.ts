import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE_ID, filterState } from '../domain/profiles'
import { ProfilesService } from '../profiles-service'
import { WorkDeskService } from '../service'
import { FakeGit } from './fake-git'

let tmp: string
let root: string
let repoB: string
let profiles: ProfilesService
let services: WorkDeskService[] = []

const open = async (): Promise<WorkDeskService> => {
  const s = new WorkDeskService(root, new FakeGit(), Date.now, profiles)
  await s.load()
  services.push(s)
  return s
}
const json = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'workdesk-repos-'))
  root = join(tmp, 'root')
  repoB = join(tmp, 'status-b')
  let n = 0
  profiles = new ProfilesService(join(tmp, 'profiles.json'), () => `id${++n}`)
  await profiles.load()
  services = []
})
afterEach(async () => {
  for (const s of services) s.status.autoCommit.dispose()
  await rm(tmp, { recursive: true, force: true })
})

/** Two Profiles: Default in the home repo, "B" in a repo of its own. */
async function twoRepos(): Promise<void> {
  const { repo } = await profiles.addRepo(repoB, 'Product B')
  await profiles.add('B', repo.id)
}

describe('several Status Repos', () => {
  it('writes the things of each Profile to the repo of that Profile and reads both back after a restart', async () => {
    await twoRepos()
    const s = await open()
    const a = (await s.addTodo({ title: 'Home work', topics: [], list: 'today' })).todos[0]
    await s.startPlainDesk([a.id], 'Home desk')
    await profiles.setActive(profiles.config().profiles[1].id)
    const b = (await s.addTodo({ title: 'B work', topics: [], list: 'today' })).todos.find((t) => t.title === 'B work')!
    await s.startPlainDesk([b.id], 'B desk')
    await s.saveNotes(b.id, 'note for b')

    const home = join(root, 'workdesk-status')
    expect((await json<{ title: string }[]>(join(home, 'todos.json'))).map((t) => t.title)).toEqual(['Home work'])
    expect((await json<{ title: string }[]>(join(repoB, 'todos.json'))).map((t) => t.title)).toEqual(['B work'])
    expect(existsSync(join(home, 'desks', 'home-desk', 'desk.json'))).toBe(true)
    expect(existsSync(join(repoB, 'desks', 'b-desk', 'desk.json'))).toBe(true)
    expect(existsSync(join(home, 'desks', 'b-desk'))).toBe(false)
    expect(await readFile(join(repoB, 'notes', `${b.id}.md`), 'utf8')).toBe('note for b')
    expect(existsSync(join(home, 'notes', `${b.id}.md`))).toBe(false)
    // the WorkDesk's notes link points into the repo it lives in
    expect(await readlink(join(root, 'b-desk', 'notes'))).toBe(join(repoB, 'desks', 'b-desk', 'notes'))
    expect(await readlink(join(root, 'home-desk', 'notes'))).toBe(join('..', 'workdesk-status', 'desks', 'home-desk', 'notes'))

    const again = await open()
    expect(again.state().todos.map((t) => t.title).sort()).toEqual(['B work', 'Home work'])
    expect(again.state().desks.map((d) => d.id).sort()).toEqual(['b-desk', 'home-desk'])
    expect(await again.readNotes(b.id)).toBe('note for b')
    const cfg = profiles.config()
    expect(filterState(again.state(), cfg.profiles[1].id, cfg).desks.map((d) => d.id)).toEqual(['b-desk'])
    expect(filterState(again.state(), DEFAULT_PROFILE_ID, cfg).desks.map((d) => d.id)).toEqual(['home-desk'])
  })

  it('background work covers every repo: a reminder of a Todo in the other repo raises its Signal while the Default Profile is in view', async () => {
    await twoRepos()
    const bId = profiles.config().profiles[1].id
    await profiles.setActive(bId)
    const s = await open()
    const t = (await s.addTodo({ title: 'Call back', topics: [], list: 'today' })).todos[0]
    await s.startPlainDesk([t.id], 'B desk')
    await profiles.setActive(DEFAULT_PROFILE_ID)
    await s.setTodoDue(t.id, Date.now() - 1000)
    await s.checkReminders()
    expect(s.state().desks.find((d) => d.id === 'b-desk')?.signals.map((x) => x.type)).toEqual(['todo-due'])
    // and it was written to the repo it lives in
    expect((await json<{ remindedAt?: number }[]>(join(repoB, 'todos.json')))[0].remindedAt).toBeGreaterThan(0)
  })

  it('pointing a Profile at another repo moves nothing: old things stay in their repo and stay visible', async () => {
    const s0 = await open()
    const old = (await s0.addTodo({ title: 'Old', topics: [], list: 'today' })).todos[0]
    await profiles.setActive(DEFAULT_PROFILE_ID)
    const { repo } = await profiles.addRepo(repoB, 'B')
    await profiles.setRepo(DEFAULT_PROFILE_ID, repo.id)
    const attached = await s0.attachRepos()
    expect(attached.todos.map((t) => t.id)).toEqual([old.id])
    const fresh = (await s0.addTodo({ title: 'Fresh', topics: [], list: 'today' })).todos.find((t) => t.title === 'Fresh')!
    expect((await json<{ id: string }[]>(join(root, 'workdesk-status', 'todos.json'))).map((t) => t.id)).toEqual([old.id])
    expect((await json<{ id: string }[]>(join(repoB, 'todos.json'))).map((t) => t.id)).toEqual([fresh.id])
    // an edit of the old Todo is written where it lives
    await s0.editTodo(old.id, { title: 'Old, edited' })
    expect((await json<{ title: string }[]>(join(root, 'workdesk-status', 'todos.json')))[0].title).toBe('Old, edited')
  })

  it('a repo registered while the app runs is loaded live', async () => {
    const s = await open()
    const { repo } = await profiles.addRepo(repoB, 'B')
    // something already in that folder (a repo that was used before) is taken in
    const other = await open()
    await profiles.add('B', repo.id)
    await profiles.setActive(profiles.config().profiles[1].id)
    await other.attachRepos()
    const t = (await other.addTodo({ title: 'Seen live', topics: [], list: 'today' })).todos[0]
    expect(t.profileId).toBe(profiles.config().profiles[1].id)
    const fresh = await open()
    expect(fresh.state().todos.map((x) => x.title)).toEqual(['Seen live'])
    await s.attachRepos()
    expect(s.state().todos.map((x) => x.title)).toEqual(['Seen live'])
  })

  it('a repo whose folder cannot be opened is reported and the app still starts with the rest', async () => {
    const { repo } = await profiles.addRepo('/proc/nope/status', 'Gone')
    await profiles.add('B', repo.id)
    const s = await open()
    expect(s.status.unavailable.has(repo.id)).toBe(true)
    await profiles.setActive(profiles.config().profiles[1].id)
    // new things of that Profile land in the home repo until its own is back; nothing is lost
    const t = (await s.addTodo({ title: 'Parked in home', topics: [], list: 'today' })).todos[0]
    expect((await json<{ id: string }[]>(join(root, 'workdesk-status', 'todos.json'))).map((x) => x.id)).toEqual([t.id])
  })

  it('counts what lives in a repo, so one that is in use is not forgotten', async () => {
    await twoRepos()
    await profiles.setActive(profiles.config().profiles[1].id)
    const s = await open()
    await s.addTodo({ title: 'x', topics: [], list: 'today' })
    const id = profiles.config().repos[1].id
    expect(s.status.usage(id)).toEqual({ todos: 1, desks: 0 })
  })
})
