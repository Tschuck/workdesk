import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BranchesService } from './branches-service'
import { ClearService } from './clear-service'
import { prBase, restackSteps, stackOrder, ticketBranchName } from './domain/stack'
import { buildDeskTree } from './domain/tree'
import { ProjectRegistry } from './projects/projects'
import { realRepoGit } from './projects/repo-git'
import { WorkDeskService } from './service'
import { FakeGit } from './status/fake-git'

Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' })
const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()

describe('Stack rules', () => {
  const b = (branch: string, base?: string, project = 'api') => ({ project, branch, base, path: `/x/${branch}`, index: 1 })

  it('names Ticket Branches after the key', () => {
    expect(ticketBranchName('ENG-123')).toBe('ENG-123')
    expect(ticketBranchName(' eng 123 ')).toBe('eng-123')
    expect(ticketBranchName('a~b^c:d')).toBe('abcd')
    expect(() => ticketBranchName('~~')).toThrow()
  })

  it('orders a Stack base to tip and targets the previous Branch', () => {
    const desk = { branches: [b('three', 'two'), b('one'), b('two', 'one')] }
    expect(stackOrder(desk).map((x) => x.branch)).toEqual(['one', 'two', 'three'])
    expect(prBase(desk.branches[0])).toBe('two')
    expect(prBase(desk.branches[1])).toBeUndefined()
    const [p] = buildDeskTree(desk)
    expect(p.branches[0].children[0].children[0].branch.branch).toBe('three')
  })

  it('restacks everything above a stale Branch', () => {
    const desk = { branches: [b('one'), b('two', 'one'), b('three', 'two'), b('side')] }
    expect(restackSteps(desk, (x) => x.branch === 'two')).toEqual([
      { project: 'api', branch: 'two', onto: 'one' },
      { project: 'api', branch: 'three', onto: 'two' }
    ])
    expect(restackSteps(desk, () => false)).toEqual([])
  })
})

describe('Ticket WorkDesks and Stacks on real git', () => {
  let tmp: string
  let root: string
  let service: WorkDeskService
  let branches: BranchesService
  let registry: ProjectRegistry
  let apiDir: string
  let ran: string[]
  let setCommands: (project: string, commands: string[]) => Promise<void>

  async function origin(name: string): Promise<string> {
    const seed = join(tmp, `seed-${name}`)
    const bare = join(tmp, `${name}.git`)
    await mkdir(seed)
    sh(seed, 'init', '-b', 'main')
    await writeFile(join(seed, 'f.txt'), 'base\n')
    sh(seed, 'add', '.')
    sh(seed, 'commit', '-m', 'init')
    sh(tmp, 'clone', '--bare', seed, bare)
    return bare
  }

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'workdesk-tk-'))
    root = join(tmp, 'root')
    service = new WorkDeskService(root, new FakeGit())
    await service.load()
    registry = new ProjectRegistry(join(service.status.dir, 'projects.json'), realRepoGit, root)
    await registry.addByClone('api', await origin('api'))
    await registry.addByClone('web', await origin('web'))
    ran = []
    branches = new BranchesService(service, registry, realRepoGit, async (deskId, wt, commands) => void ran.push(`${deskId}:${wt.project}:${wt.branch}:${commands.join(' && ')}`))
    setCommands = (p, c) => registry.setCheckoutCommands(p, c)
    apiDir = join(root, 'ENG-12', 'api')
  })
  afterEach(async () => {
    service.status.autoCommit.dispose()
    await rm(tmp, { recursive: true, force: true })
  })

  const TICKET = { kind: 'ticket' as const, id: 'p1', title: 'Fix login', ticketKey: 'ENG-12' }
  /** a Ticket WorkDesk from the ticket, with a branch named after it in each Project */
  const startTicket = (projects: string[], name = '') => branches.startFromItems({ name, todoIds: [], items: [TICKET], branches: [], projects, checkout: false })

  it('starts a Ticket WorkDesk with one ticket-named Branch per picked Project', async () => {
    const s = await startTicket(['api', 'web'], 'Login fix')
    const desk = s.desks[0]
    expect(desk.name).toBe('Login fix')
    expect(desk).toMatchObject({ id: 'eng-12', stage: 'implement', items: [TICKET] })
    expect(desk.branches.map((b) => [b.project, b.branch])).toEqual([['api', 'ENG-12'], ['web', 'ENG-12']])
    expect(await realRepoGit.currentBranch(desk.branches[0].path)).toBe('ENG-12')
    expect(s.todos).toEqual([])
    await expect(startTicket(['api'])).rejects.toThrow(/already in a WorkDesk/)
  })

  it('combines two WorkDesks: the folders move with their uncommitted work and review comments, the rest is merged', async () => {
    await startTicket(['api'], 'Backend')
    const second = { kind: 'ticket' as const, id: 'p2', title: 'Show it', ticketKey: 'ENG-13' }
    await branches.startFromItems({ name: 'Frontend', todoIds: [], items: [second], branches: [], projects: ['web'], checkout: false })
    // the second one has work that is not committed, a review comment, a note and a Todo
    const webDir = join(root, 'eng-13', 'web')
    await writeFile(join(webDir, 'wip.txt'), 'not committed')
    await mkdir(join(webDir, '.review'))
    await writeFile(join(webDir, '.review', 'comments.json'), '[]\n')
    await service.status.writeNote('desk-eng-13', 'remember the form')
    let s = await service.addTodo({ title: 'Check it', topics: [], list: 'today' })
    s = await service.assignTodoToDesk(s.todos[0].id, 'eng-13')
    await expect(branches.combineDesks('eng-12', 'eng-12')).rejects.toThrow(/another WorkDesk/)

    s = await branches.combineDesks('eng-12', 'eng-13')
    const target = s.desks.find((d) => d.id === 'eng-12')!
    const other = s.desks.find((d) => d.id === 'eng-13')!
    expect(target.branches.map((b) => [b.project, b.branch, b.index])).toEqual([['api', 'ENG-12', 1], ['web', 'ENG-13', 1]])
    expect(target.branches[1].path).toBe(join(root, 'eng-12', 'web'))
    expect(await realRepoGit.currentBranch(target.branches[1].path)).toBe('ENG-13')
    expect(existsSync(join(root, 'eng-12', 'web', 'wip.txt'))).toBe(true)
    expect(existsSync(join(root, 'eng-12', 'web', '.review', 'comments.json'))).toBe(true)
    expect(existsSync(webDir)).toBe(false)
    expect(target.items?.map((i) => i.id)).toEqual(['p1', 'p2'])
    expect(target.todoIds).toHaveLength(1)
    expect(s.todos[0].deskId).toBe('eng-12')
    expect(await service.status.readNote('desk-eng-12')).toContain('From "Frontend"')
    expect(await service.status.readNote('desk-eng-12')).toContain('remember the form')
    expect(other.branches).toEqual([])
    // clearing the emptied WorkDesk leaves what moved untouched
    const after = await new ClearService({ service, registry, git: realRepoGit, root, shutDown: async () => undefined }).clear('eng-13')
    expect(after.desks.map((d) => d.id)).toEqual(['eng-12'])
    expect(existsSync(join(root, 'eng-13'))).toBe(false)
    expect(existsSync(join(root, 'eng-12', 'web', 'wip.txt'))).toBe(true)
    // git itself knows the new place
    expect(sh(join(root, 'eng-12', 'web'), 'worktree', 'list')).toContain(join('eng-12', 'web'))
  })

  it('lists and fetches the branches of the Projects in view only', async () => {
    registry.visible = (p) => p.name === 'web'
    const fetched: string[] = []
    const spy = new BranchesService(service, registry, { ...realRepoGit, fetch: async (gitDir) => void fetched.push(gitDir) })
    const rows = await spy.listBranches(true)
    expect(rows.map((r) => r.project)).toEqual(['web'])
    expect(fetched).toHaveLength(1)
    registry.visible = () => true
    expect((await branches.listBranches(false)).map((r) => r.project)).toEqual(['api', 'web'])
  })

  it('needs a ticket key for Projects, and cleans up after failures', async () => {
    await expect(branches.startFromItems({ name: '', todoIds: [], items: [{ kind: 'ticket', id: 'p9', title: 'No key' }], branches: [], projects: ['api'], checkout: false })).rejects.toThrow(/ticket with a key/)
    await expect(startTicket(['nope'])).rejects.toThrow(/Unknown Project/)
    expect(existsSync(join(root, 'eng-12'))).toBe(false)
    expect(service.getState().desks).toEqual([])
  })

  it('builds a 3-branch Stack with correct bases and proposes a restack but never runs it', async () => {
    let s = await startTicket(['api'])
    s = await branches.addBranch('eng-12', 'api', 'ENG-12-b', 'ENG-12')
    s = await branches.addBranch('eng-12', 'api', 'ENG-12-c', 'ENG-12-b')
    const desk = s.desks[0]
    expect(desk.branches.map((b) => [b.branch, b.base])).toEqual([['ENG-12', undefined], ['ENG-12-b', 'ENG-12'], ['ENG-12-c', 'ENG-12-b']])
    expect(desk.branches.map((b) => b.index)).toEqual([1, 2, 3])
    const [p] = buildDeskTree(desk)
    expect(p.branches[0].children[0].children[0].branch.branch).toBe('ENG-12-c')
    expect(await branches.restackPlan('eng-12')).toEqual([])

    // the base gains a commit: the two Branches above are behind
    await writeFile(join(apiDir, 'base.txt'), 'new base work')
    sh(apiDir, 'add', '.')
    sh(apiDir, 'commit', '-m', 'base work')
    const plan = await branches.restackPlan('eng-12')
    expect(plan).toEqual([
      { project: 'api', branch: 'ENG-12-b', onto: 'ENG-12' },
      { project: 'api', branch: 'ENG-12-c', onto: 'ENG-12-b' }
    ])
    // proposing changed nothing
    expect(sh(desk.branches[1].path, 'log', '--oneline').split('\n')).toHaveLength(1)

    // it is done by hand, in the branch's folder; afterwards nothing is proposed any more
    sh(desk.branches[1].path, 'rebase', 'ENG-12')
    sh(desk.branches[2].path, 'rebase', 'ENG-12-b')
    expect(await branches.restackPlan('eng-12')).toEqual([])
  })

  it('runs a Project\'s checkout commands for every checked out branch, and only for Projects that have some', async () => {
    await setCommands('api', ['  pnpm install ', '', 'pnpm build'])
    await startTicket(['api', 'web'])
    expect(ran).toEqual(['eng-12:api:ENG-12:pnpm install && pnpm build'])
    await branches.addBranch('eng-12', 'api', 'ENG-12-b', 'ENG-12')
    expect(ran).toHaveLength(2)
    expect(ran[1]).toBe('eng-12:api:ENG-12-b:pnpm install && pnpm build')
    await branches.addBranch('eng-12', 'web', 'side')
    expect(ran).toHaveLength(2) // web has no commands
    await setCommands('api', [])
    await branches.addBranch('eng-12', 'api', 'ENG-12-c', 'ENG-12-b')
    expect(ran).toHaveLength(2)
  })

  it('validates new Branches', async () => {
    await startTicket(['api'])
    await expect(branches.addBranch('eng-12', 'api', 'x', 'missing')).rejects.toThrow(/no such branch/)
    await expect(branches.addBranch('eng-12', 'api', 'has space')).rejects.toThrow(/spaces/)
    await expect(branches.addBranch('nope', 'api', 'x')).rejects.toThrow(/Unknown WorkDesk/)
  })
})
