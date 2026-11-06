import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BranchesService } from './branches-service'
import type { DeskItem } from './domain/types'
import { ProjectRegistry } from './projects/projects'
import { realRepoGit } from './projects/repo-git'
import { WorkDeskService } from './service'
import { FakeGit } from './status/fake-git'

Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' })
const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()

const ticket: DeskItem = { kind: 'ticket', id: 'p1', title: 'Fix login', ticketKey: 'ENG-12' }
const pr: DeskItem = { kind: 'pr', id: 'o/api#7', title: 'Add export', url: 'https://github.com/o/api/pull/7' }

describe('starting a WorkDesk from work items', () => {
  let tmp: string
  let root: string
  let service: WorkDeskService
  let branches: BranchesService

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'workdesk-items-'))
    root = join(tmp, 'root')
    service = new WorkDeskService(root, new FakeGit())
    await service.load()
    const seed = join(tmp, 'seed')
    await mkdir(seed)
    sh(seed, 'init', '-b', 'main')
    await writeFile(join(seed, 'f.txt'), 'base\n')
    sh(seed, 'add', '.')
    sh(seed, 'commit', '-m', 'init')
    sh(tmp, 'clone', '--bare', seed, join(tmp, 'api.git'))
    const registry = new ProjectRegistry(join(service.status.dir, 'projects.json'), realRepoGit, root)
    await registry.addByClone('api', join(tmp, 'api.git'))
    branches = new BranchesService(service, registry, realRepoGit)
  })
  afterEach(async () => {
    service.status.autoCommit.dispose()
    await rm(tmp, { recursive: true, force: true })
  })

  const request = (over: Partial<Parameters<BranchesService['startFromItems']>[0]> = {}) => ({ name: '', todoIds: [], items: [], branches: [], projects: [], checkout: false, ...over })

  it('starts a Ticket WorkDesk from a ticket without making a Todo of it', async () => {
    const s = await branches.startFromItems(request({ items: [ticket], projects: ['api'], name: 'Login' }))
    expect(s.todos).toEqual([])
    expect(s.desks[0]).toMatchObject({ id: 'eng-12', name: 'Login', presence: 'inactive', items: [ticket] })
    expect(s.desks[0].branches.map((b) => b.branch)).toEqual(['ENG-12'])
    expect(await realRepoGit.currentBranch(s.desks[0].branches[0].path)).toBe('ENG-12')
  })

  it('puts Todos into the WorkDesk together with a ticket, as a Plain one', async () => {
    const todo = (await service.addTodo({ title: 'Update docs', topics: [], list: 'backlog' })).todos[0]
    const s = await branches.startFromItems(request({ items: [ticket], todoIds: [todo.id] }))
    expect(s.desks[0]).toMatchObject({ todoIds: [todo.id], items: [ticket] })
    expect(s.todos[0]).toMatchObject({ deskId: s.desks[0].id, list: 'today' })
  })

  it('only plans: a WorkDesk is made, but no branch is checked out and nothing is started', async () => {
    const s = await branches.startFromItems(request({ items: [ticket], projects: ['api'], plan: true }))
    expect(s.desks[0]).toMatchObject({ presence: 'planned', branches: [], items: [ticket] })
    expect(existsSync(join(root, 'eng-12', 'api'))).toBe(false)
    // no folder at all until it is started
    expect(existsSync(join(root, 'eng-12'))).toBe(false)
    await service.activateDesk('eng-12')
    expect(existsSync(join(root, 'eng-12'))).toBe(true)
  })

  it('plans a pull request without asking GitHub anything: no Pull Request source is even needed', async () => {
    const s = await branches.startFromItems(request({ items: [pr], plan: true }))
    expect(s.desks[0]).toMatchObject({ id: 'review-api-7', stage: 'to-review', presence: 'planned', branches: [], items: [pr] })
    expect(s.desks[0].reviews).toEqual([{ owner: 'o', repo: 'api', number: 7, url: 'https://github.com/o/api/pull/7' }])
  })

  it('starts a plain WorkDesk from an existing branch', async () => {
    const s = await branches.startFromItems(request({ branches: [{ project: 'api', branch: 'main' }], name: 'On main' }))
    expect(s.desks[0]).toMatchObject({ name: 'On main' })
    expect(s.desks[0].branches.map((b) => b.branch)).toEqual(['main'])
  })

  it('refuses an item a WorkDesk has already, an empty pick and a Todo that is taken', async () => {
    await branches.startFromItems(request({ items: [ticket], plan: true }))
    await expect(branches.startFromItems(request({ items: [ticket], plan: true }))).rejects.toThrow(/already in a WorkDesk/)
    await expect(branches.startFromItems(request())).rejects.toThrow(/at least one/)
    const todo = (await service.addTodo({ title: 'x', topics: [], list: 'today' })).todos[0]
    await branches.startFromItems(request({ todoIds: [todo.id], plan: true }))
    await expect(branches.startFromItems(request({ todoIds: [todo.id], plan: true }))).rejects.toThrow(/already in a WorkDesk/)
  })

  it('needs GitHub for a Pull Request and leaves nothing behind when it fails', async () => {
    await expect(branches.startFromItems(request({ items: [pr] }))).rejects.toThrow(/GitHub/)
    expect(service.getState().desks).toEqual([])
  })
})
