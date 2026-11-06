import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkDeskService } from './service'
import { FakeGit } from './status/fake-git'

describe('Pull request and ticket Todos become work items on load', () => {
  let root: string
  const open = async () => {
    const s = new WorkDeskService(root, new FakeGit())
    await s.load()
    return s
  }
  beforeEach(async () => void (root = await mkdtemp(join(tmpdir(), 'workdesk-mig-'))))
  afterEach(async () => await rm(root, { recursive: true, force: true }))

  it('moves the Todo of a review into its WorkDesk as an item, with its notes, and backs the Todo up', async () => {
    let s = await open()
    const added = await s.addSourceTodo({ title: 'Fix login', list: 'today', source: { sourceId: 'github-prs', externalId: 'a/b#4', url: 'https://github.com/a/b/pull/4' } })
    const todoId = added.todos[0].id
    await s.registerDesk({ id: 'review-b-4', name: 'Review', stage: 'to-review', stageOverridden: false, presence: 'inactive', todoIds: [todoId], branches: [], signals: [], createdAt: 0 }, todoId)
    await s.saveNotes(todoId, 'looks fine so far')
    const free = await s.addSourceTodo({ title: 'Export', list: 'backlog', source: { sourceId: 'notion-tickets', externalId: 'p1', ticketKey: 'ENG-5' } })
    s.status.autoCommit.dispose()

    s = await open()
    const state = s.getState()
    expect(state.todos).toEqual([])
    expect(state.desks[0].todoIds).toEqual([])
    expect(state.desks[0].items).toMatchObject([{ kind: 'pr', id: 'a/b#4', url: 'https://github.com/a/b/pull/4' }])
    expect(await s.readNotes('pr-a-b-4')).toBe('looks fine so far')
    expect(await s.status.readNote(todoId)).toBe('')
    const backup = JSON.parse(await (await import('node:fs/promises')).readFile(join(s.status.dir, 'archive', 'migrated-todos.json'), 'utf8')) as { id: string }[]
    expect(backup.map((t) => t.id).sort()).toEqual([todoId, free.todos[1].id].sort())
    s.status.autoCommit.dispose()

    // a second start has nothing left to do
    s = await open()
    expect(s.getState().desks[0].items).toHaveLength(1)
    s.status.autoCommit.dispose()
  })
})

describe('WorkDesks from before they were all alike', () => {
  let root: string
  beforeEach(async () => void (root = await mkdtemp(join(tmpdir(), 'workdesk-unify-'))))
  afterEach(async () => await rm(root, { recursive: true, force: true }))

  it('lose their type on load, a review keeps its pull request as a list and its folder is marked with it, and a save writes the new shape', async () => {
    const { mkdir, readFile, writeFile } = await import('node:fs/promises')
    let s = new WorkDeskService(root, new FakeGit())
    await s.load()
    const dir = (id: string) => join(s.status.dir, 'desks', id)
    await mkdir(dir('review-app-7'), { recursive: true })
    await writeFile(
      join(dir('review-app-7'), 'desk.json'),
      JSON.stringify({
        id: 'review-app-7', name: 'Fix it', kind: 'review', stage: 'reviewed-waiting', stageOverridden: false, priority: 0, presence: 'inactive', todoIds: [],
        items: [{ kind: 'pr', id: 'o/app#7', title: 'Fix it' }],
        branches: [{ project: 'app', branch: 'fix-it', path: '/x/review-app-7/app', index: 1 }],
        review: { owner: 'o', repo: 'app', number: 7, url: 'u', snapshot: { state: 'open', headSha: 'a', reviewRequested: false, myReview: { state: 'APPROVED', commitId: 'a' }, commentCount: 0, ci: 'none' } },
        createdAt: 1
      })
    )
    await mkdir(dir('old-plain'), { recursive: true })
    await writeFile(join(dir('old-plain'), 'desk.json'), JSON.stringify({ id: 'old-plain', name: 'Plain', kind: 'plain', stage: 'testing', stageOverridden: true, priority: 1, presence: 'parked', todoIds: [], branches: [], createdAt: 2 }))
    s.status.autoCommit.dispose()

    s = new WorkDeskService(root, new FakeGit())
    await s.load()
    const byId = (id: string) => s.getState().desks.find((d) => d.id === id)!
    const rev = byId('review-app-7')
    const plain = byId('old-plain')
    expect(rev).not.toHaveProperty('kind')
    expect(rev).not.toHaveProperty('review')
    expect(rev.reviews).toHaveLength(1)
    expect(rev.reviews![0]).toMatchObject({ owner: 'o', repo: 'app', number: 7 })
    expect(rev.branches[0].pr).toBe('o/app#7')
    expect(rev.stage).toBe('reviewed-waiting')
    expect(plain).not.toHaveProperty('kind')
    expect(plain).toMatchObject({ stage: 'testing', stageOverridden: true, presence: 'parked' })
    // the next save writes the files in the new shape
    await s.updateDesk('review-app-7', (d) => ({ ...d, name: 'Fix it now' }))
    const written = JSON.parse(await readFile(join(s.status.dir, 'desks', 'review-app-7', 'desk.json'), 'utf8')) as Record<string, unknown>
    expect(written).not.toHaveProperty('kind')
    expect(written).not.toHaveProperty('review')
    expect(written.reviews).toHaveLength(1)
    s.status.autoCommit.dispose()
  })
})
