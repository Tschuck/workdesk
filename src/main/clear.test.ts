import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClearService } from './clear-service'
import { EnvStore } from './env/env-store'
import { ProjectRegistry } from './projects/projects'
import { realRepoGit } from './projects/repo-git'
import { createBranchWorktree } from './projects/worktrees'
import { WorkDeskService } from './service'
import { FakeGit } from './status/fake-git'

Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' })
const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()

let tmp: string
let root: string
let service: WorkDeskService
let registry: ProjectRegistry
let clearing: ClearService
let shutDowns: string[]

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'workdesk-clear-'))
  root = join(tmp, 'root')
  const seed = join(tmp, 'seed')
  const origin = join(tmp, 'origin.git')
  await mkdir(seed)
  sh(seed, 'init', '-b', 'main')
  await writeFile(join(seed, 'a.txt'), 'a')
  sh(seed, 'add', '.')
  sh(seed, 'commit', '-m', 'init')
  sh(tmp, 'clone', '--bare', seed, origin)
  service = new WorkDeskService(root, new FakeGit())
  await service.load()
  registry = new ProjectRegistry(join(service.status.dir, 'projects.json'), realRepoGit, root)
  await registry.addByClone('app', origin)
  shutDowns = []
  clearing = new ClearService({ service, registry, git: realRepoGit, root, shutDown: async (id) => void shutDowns.push(id), now: () => new Date(2026, 9, 27, 12).getTime() })
})
afterEach(async () => {
  service.status.autoCommit.dispose()
  await rm(tmp, { recursive: true, force: true })
})

async function deskWithBranch() {
  let s = await service.addTodo({ title: 'Work', topics: [], list: 'today' })
  s = await service.startPlainDesk([s.todos[0].id], 'Work')
  const project = await registry.get('app')
  const wt = await createBranchWorktree(realRepoGit, root, 'work', project, [], 'feature')
  await service.updateDesk('work', (d) => ({ ...d, branches: [wt] }))
  return { project, wt }
}

describe('renaming a WorkDesk', () => {
  it('changes the name only, and keeps the folder', async () => {
    let s = await service.addTodo({ title: 'Work', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'Work')
    s = await service.renameDesk('work', '  Login fix ')
    expect(s.desks[0]).toMatchObject({ id: 'work', name: 'Login fix' })
    expect(existsSync(join(root, 'work'))).toBe(true)
    await expect(service.renameDesk('work', ' ')).rejects.toThrow(/needs a name/)
    await expect(service.renameDesk('nope', 'x')).rejects.toThrow(/Unknown/)
    const reloaded = new WorkDeskService(root, new FakeGit())
    await reloaded.load()
    expect(reloaded.state().desks[0].name).toBe('Login fix')
    reloaded.status.autoCommit.dispose()
  })
})

describe('clearing a WorkDesk', () => {
  it('reads the changes of a Branch folder in a bare clone that has per-worktree config switched on', async () => {
    const { project, wt } = await deskWithBranch()
    sh(project.gitDir, 'config', 'core.bare', 'true')
    sh(project.gitDir, 'config', 'extensions.worktreeConfig', 'true')
    // plain git now refuses in the folder, as in "this operation must be run in a work tree"
    expect(() => sh(wt.path, 'status', '--porcelain')).toThrow()
    await writeFile(join(wt.path, 'a.txt'), 'changed')
    const issues = await clearing.preflight('work')
    expect(issues.map((i) => i.kind).sort()).toEqual(['no-remote', 'uncommitted'])
  })

  it('still clears when a Branch folder is no longer a git work tree', async () => {
    const { project, wt } = await deskWithBranch()
    // what happens when the folder was half deleted or its .git link was lost
    await rm(join(wt.path, '.git'), { force: true })
    const issues = await clearing.preflight('work')
    expect(issues.map((i) => i.kind)).toEqual(['broken'])
    const s = await clearing.clear('work')
    expect(s.desks).toEqual([])
    expect(existsSync(join(root, 'work'))).toBe(false)
    expect(sh(project.gitDir, 'worktree', 'list')).not.toMatch(/root\/work\b/)
    expect(sh(project.gitDir, 'branch', '--list', 'feature')).toContain('feature')
  })

  it('lists the Branches with where they exist, and deletes the ticked ones; one that is on the remote goes locally together with the remote one', async () => {
    const { project, wt } = await deskWithBranch()
    await writeFile(join(wt.path, 'own.txt'), 'x')
    sh(wt.path, 'add', '.')
    sh(wt.path, 'commit', '-m', 'own work')
    expect(await clearing.branches('work')).toMatchObject([{ project: 'app', branch: 'feature', local: true, onRemote: false, unsafe: expect.any(String) }])
    sh(project.gitDir, 'push', 'origin', 'feature')
    expect(await clearing.branches('work')).toMatchObject([{ project: 'app', branch: 'feature', local: true, onRemote: true }])
    // not ticked: it stays
    let s = await clearing.clear('work', [{ project: 'app', branch: 'unknown', local: true }])
    expect(s.desks).toEqual([])
    expect(sh(project.gitDir, 'branch', '--list', 'feature')).toContain('feature')

    await service.addTodo({ title: 'Again', topics: [], list: 'today' })
    s = await service.startPlainDesk([service.getState().todos.find((t) => t.title === 'Again')!.id], 'Again')
    const again = await createBranchWorktree(realRepoGit, root, 'again', project, [], 'feature')
    await service.updateDesk('again', (d) => ({ ...d, branches: [again] }))
    s = await clearing.clear('again', [{ project: 'app', branch: 'feature', local: true, remote: true }])
    expect(s.desks).toEqual([])
    expect(sh(project.gitDir, 'branch', '--list', 'feature')).toBe('')
    expect(sh(sh(project.gitDir, 'remote', 'get-url', 'origin'), 'branch', '--list', 'feature')).toBe('')
  })

  it('asks the remote first, so a branch deleted there after its merge shows as gone, and deletes the remote branch when ticked', async () => {
    const { project, wt } = await deskWithBranch()
    await writeFile(join(wt.path, 'own.txt'), 'x')
    sh(wt.path, 'add', '.')
    sh(wt.path, 'commit', '-m', 'own work')
    sh(project.gitDir, 'push', 'origin', 'feature')
    const origin = sh(project.gitDir, 'remote', 'get-url', 'origin')
    // deleted on the remote behind the clone's back: its origin/feature ref is stale
    sh(origin, 'branch', '-D', 'feature')
    expect(sh(project.gitDir, 'branch', '-r', '--list', 'origin/feature')).toContain('origin/feature')
    expect(await clearing.branches('work')).toMatchObject([{ branch: 'feature', local: true, onRemote: false }])

    // still there: it can be deleted on the remote too
    sh(project.gitDir, 'push', 'origin', 'feature')
    expect(await clearing.branches('work')).toMatchObject([{ branch: 'feature', onRemote: true }])
    await clearing.clear('work', [{ project: 'app', branch: 'feature', remote: true }])
    expect(sh(origin, 'branch', '--list', 'feature')).toBe('')
    // the local copy was not ticked
    expect(sh(project.gitDir, 'branch', '--list', 'feature')).toContain('feature')
  })

  it('takes a remote branch that is already gone as deleted, and drops the stale note of it', async () => {
    const { project } = await deskWithBranch()
    sh(project.gitDir, 'push', 'origin', 'feature')
    const origin = sh(project.gitDir, 'remote', 'get-url', 'origin')
    sh(origin, 'branch', '-D', 'feature')
    // the clone still lists it (no fetch yet); ticking both must not fail with "remote ref does not exist"
    const s = await clearing.clear('work', [{ project: 'app', branch: 'feature', local: true, remote: true }])
    expect(s.desks).toEqual([])
    expect(sh(project.gitDir, 'branch', '-r', '--list', 'origin/feature')).toBe('')
  })

  it('asks GitHub when the fetch fails: a branch it says is gone is not on the remote, whatever the clone still notes', async () => {
    const { project } = await deskWithBranch()
    sh(project.gitDir, 'push', 'origin', 'feature')
    const asked: string[] = []
    const offline = new ClearService({
      service,
      registry: { list: () => registry.list(), listWithUrls: async () => [{ name: 'app', url: 'git@github.com:acme/app.git' }] } as unknown as ProjectRegistry,
      git: { ...realRepoGit, fetch: async () => { throw new Error('Permission denied (publickey)') } },
      root,
      shutDown: async () => undefined,
      github: async () => ({ api: { branchExists: async (o: string, r: string, b: string) => (asked.push(`${o}/${r}:${b}`), false) } as never })
    })
    // the clone's note says the branch is on the remote; GitHub says it is not
    expect(sh(project.gitDir, 'branch', '-r', '--list', 'origin/feature')).toContain('origin/feature')
    expect(await offline.branches('work')).toMatchObject([{ branch: 'feature', local: true, onRemote: false }])
    expect((await offline.branches('work'))[0].stale).toBeUndefined()
    expect(asked[0]).toBe('acme/app:feature')
    // GitHub cannot be asked either: the clone's note stays, said to be out of date
    const blind = new ClearService({ service, registry: { list: () => registry.list(), listWithUrls: async () => [] } as unknown as ProjectRegistry, git: { ...realRepoGit, fetch: async () => { throw new Error('Permission denied (publickey)') } }, root, shutDown: async () => undefined })
    expect(await blind.branches('work')).toMatchObject([{ branch: 'feature', onRemote: true, stale: 'Permission denied (publickey)' }])
  })

  it('deletes the local copy of a Branch that is on the remote only together with the remote one', async () => {
    const { project } = await deskWithBranch()
    sh(project.gitDir, 'push', 'origin', 'feature')
    await clearing.clear('work', [{ project: 'app', branch: 'feature', local: true }])
    expect(sh(project.gitDir, 'branch', '--list', 'feature')).toContain('feature')
  })

  it('reports everything that would be lost, .env files included', async () => {
    const { wt } = await deskWithBranch()
    expect((await clearing.preflight('work')).map((i) => i.kind)).toEqual(['no-remote'])

    await writeFile(join(wt.path, 'a.txt'), 'changed')
    await writeFile(join(wt.path, 'new.txt'), 'x')
    await mkdir(join(wt.path, 'apps'), { recursive: true })
    await writeFile(join(wt.path, 'apps', '.env'), 'GENERATED=1')
    const issues = await clearing.preflight('work')
    expect(issues.map((i) => i.kind).sort()).toEqual(['env', 'no-remote', 'uncommitted', 'untracked'])
    expect(issues.find((i) => i.kind === 'env')!.detail).toEqual(['apps/.env'])

    // stored but still a plain file in the Branch: the Branch folder goes away, the store keeps it, so it is safe once linked
    await new EnvStore(root).sync('app', wt.path)
    expect((await clearing.preflight('work')).some((i) => i.kind === 'env')).toBe(true)
    await rm(join(wt.path, 'apps', '.env'))
    await new EnvStore(root).link('app', wt.path)
    expect((await clearing.preflight('work')).some((i) => i.kind === 'env')).toBe(false)
  })

  it('archives notes and sessions, removes folders and worktrees, keeps Branches and Todos', async () => {
    const { project, wt } = await deskWithBranch()
    await writeFile(join(service.status.notesDir('work'), 'n.md'), 'my notes')
    // the WorkDesk's CLAUDE.md is generated, and what you wrote into it is kept
    const guide = join(root, 'work', 'CLAUDE.md')
    expect(await readFile(guide, 'utf8')).toContain('# WorkDesk: Work')
    await writeFile(guide, (await readFile(guide, 'utf8')) + '\nRun the linter first.\n')
    await service.claudeSessions.record('work', { sessionId: 'sess-1', paneId: 'p1', cwd: wt.path })
    const todoId = service.getState().todos[0].id
    expect(service.getState().todos[0].deskId).toBe('work')

    const s = await clearing.clear('work')
    expect(shutDowns).toEqual(['work'])
    expect(s.desks).toEqual([])
    expect(s.todos[0]).toMatchObject({ id: todoId, deskId: undefined, title: 'Work' })
    expect(existsSync(join(root, 'work'))).toBe(false)
    expect(sh(project.gitDir, 'worktree', 'list')).not.toMatch(/root\/work\b/)
    expect(sh(project.gitDir, 'branch', '--list', 'feature')).toContain('feature')

    const archive = join(service.status.dir, 'archive', '2026-10-27-work')
    expect(await readFile(join(archive, 'notes', 'n.md'), 'utf8')).toBe('my notes')
    expect(JSON.parse(await readFile(join(archive, 'summary.json'), 'utf8'))).toMatchObject({ finalStage: 'implement', claudeSessionIds: ['sess-1'] })
    expect(existsSync(join(service.status.dir, 'desks', 'work'))).toBe(false)
    expect((await readFile(join(archive, 'CLAUDE.md'), 'utf8')).trim()).toBe('Run the linter first.')

    // the Todo can start a new WorkDesk
    const again = await service.startPlainDesk([todoId], 'Work again')
    expect(again.desks[0].todoIds).toEqual([todoId])
    await expect(clearing.clear('work')).rejects.toThrow(/Unknown WorkDesk/)
  })
})

describe('Stage by hand', () => {
  it('sets a Stage, gives it back to the tool, and refuses one that does not exist', async () => {
    let s = await service.addTodo({ title: 'Work', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'Work')
    s = await service.setDeskStage('work', 'testing')
    expect(s.desks[0]).toMatchObject({ stage: 'testing', stageOverridden: true })
    await expect(service.setDeskStage('work', 'nonsense' as never)).rejects.toThrow(/not known/)
    s = await service.setDeskStage('work', 'auto')
    expect(s.desks[0]).toMatchObject({ stage: 'testing', stageOverridden: false })
    await expect(service.setDeskStage('nope', 'auto')).rejects.toThrow(/Unknown/)
  })

  it('"automatic" on a WorkDesk that reviews pull requests takes the Stage derived from them', async () => {
    let s = await service.addTodo({ title: 'R', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'R')
    await service.updateDesk('r', (d) => ({
      ...d,
      stage: 'to-review',
      reviews: [{ owner: 'o', repo: 'r', number: 1, url: 'u', snapshot: { state: 'open', headSha: 'a', reviewRequested: false, myReview: { state: 'APPROVED', commitId: 'a' }, commentCount: 0, ci: 'none' } }]
    }))
    s = await service.setDeskStage('r', 'done')
    expect(s.desks[0]).toMatchObject({ stage: 'done', stageOverridden: true })
    s = await service.setDeskStage('r', 'auto')
    expect(s.desks[0]).toMatchObject({ stage: 'reviewed-waiting', stageOverridden: false })
  })
})
