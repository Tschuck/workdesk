import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeGit } from '../status/fake-git'
import { StatusRepo } from '../status/status-repo'
import { EnvStore } from '../env/env-store'
import { ProjectRegistry } from './projects'
import { realRepoGit } from './repo-git'
import { clearDesk, createBranchWorktree, ensureDeskFolder, preflight } from './worktrees'

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim()

let tmp: string
let root: string
let origin: string
let registry: ProjectRegistry

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'workdesk-int-'))
  root = join(tmp, 'root')
  origin = join(tmp, 'origin.git')
  const seed = join(tmp, 'seed')
  await mkdir(seed, { recursive: true })
  sh(seed, 'init', '-b', 'main')
  await writeFile(join(seed, 'a.txt'), 'a')
  sh(seed, 'add', '.')
  sh(seed, 'commit', '-m', 'init')
  sh(tmp, 'clone', '--bare', seed, origin)
  sh(seed, 'remote', 'add', 'origin', origin)
  sh(seed, 'push', '-u', 'origin', 'main')
  sh(seed, 'push', 'origin', 'main:feature-x')
  registry = new ProjectRegistry(join(root, 'workdesk-status', 'projects.json'), realRepoGit, root)
  process.env.GIT_AUTHOR_NAME = 't'
  process.env.GIT_AUTHOR_EMAIL = 't@t'
  process.env.GIT_COMMITTER_NAME = 't'
  process.env.GIT_COMMITTER_EMAIL = 't@t'
})
afterEach(() => rm(tmp, { recursive: true, force: true }))

describe('Projects and worktrees', () => {
  it('registers a bare clone and lays out Branch worktrees', async () => {
    const project = await registry.addByClone('app', origin)
    expect(project.gitDir).toBe(join(root, '.projects', 'app.git'))
    expect((await registry.list()).map((p) => p.name)).toEqual(['app'])
    await expect(registry.addByClone('app', origin)).rejects.toThrow(/already registered/)

    const first = await createBranchWorktree(realRepoGit, root, 'rev-1', project, [], 'feature-x')
    const second = await createBranchWorktree(realRepoGit, root, 'rev-1', project, [first], 'feature-y', 'feature-x')
    expect(first.path).toBe(join(root, 'rev-1', 'app'))
    expect(second.path).toBe(join(root, 'rev-1', 'app--2-feature-y'))
    expect(await realRepoGit.currentBranch(first.path)).toBe('feature-x')
    expect(await realRepoGit.currentBranch(second.path)).toBe('feature-y')
    // existing remote branch is tracked
    expect((await realRepoGit.pushState(first.path)).hasUpstream).toBe(true)
    // notes link into the Status Repo
    expect(lstatSync(join(root, 'rev-1', 'notes')).isSymbolicLink()).toBe(true)
  })

  it('links stored .env files into new Branches without dirtying status', async () => {
    const clone = join(tmp, 'clone')
    sh(tmp, 'clone', origin, clone)
    await writeFile(join(clone, '.env'), 'SECRET=1')
    await mkdir(join(clone, 'apps', 'x'), { recursive: true })
    await writeFile(join(clone, 'apps', 'x', '.env'), 'X=1')
    await registry.addExisting('app', clone)
    await new EnvStore(root).sync('app', clone)
    const project = await registry.get('app')
    const w = await createBranchWorktree(realRepoGit, root, 'plain-1', project, [], 'new-branch')
    expect(await readFile(join(w.path, '.env'), 'utf8')).toBe('SECRET=1')
    expect(lstatSync(join(w.path, '.env')).isSymbolicLink()).toBe(true)
    expect(await readFile(join(w.path, 'apps', 'x', '.env'), 'utf8')).toBe('X=1')
    expect((await realRepoGit.status(w.path)).untracked).toEqual([])
  })

  it('does not link the stored .env files when the Project switched shared env off', async () => {
    const clone = join(tmp, 'clone')
    sh(tmp, 'clone', origin, clone)
    await writeFile(join(clone, '.env'), 'SECRET=1')
    await registry.addExisting('app', clone)
    await new EnvStore(root).sync('app', clone)
    await registry.setSharedEnv('app', false)
    const off = await createBranchWorktree(realRepoGit, root, 'off-1', await registry.get('app'), [], 'feature-off')
    expect(existsSync(join(off.path, '.env'))).toBe(false)
    await registry.setSharedEnv('app', true)
    const on = await createBranchWorktree(realRepoGit, root, 'on-1', await registry.get('app'), [], 'feature-on')
    expect(lstatSync(join(on.path, '.env')).isSymbolicLink()).toBe(true)
  })

  it('rejects the same Branch twice in one WorkDesk', async () => {
    const project = await registry.addByClone('app', origin)
    const w = await createBranchWorktree(realRepoGit, root, 'd', project, [], 'feature-x')
    await expect(createBranchWorktree(realRepoGit, root, 'd', project, [w], 'feature-x')).rejects.toThrow()
  })
})

describe('clearing', () => {
  async function setup() {
    const project = await registry.addByClone('app', origin)
    const status = new StatusRepo(root, new FakeGit())
    await status.ensure()
    const desk = {
      id: 'rev-1', name: 'rev', kind: 'review' as const, stage: 'done' as const, stageOverridden: false,
      priority: 0, presence: 'inactive' as const, todoIds: [], branches: [], createdAt: 1
    }
    await status.writeDesk(desk)
    const w = await createBranchWorktree(realRepoGit, root, desk.id, project, [], 'feature-x')
    return { project, status, desk, w }
  }

  it('reports uncommitted, untracked and unpushed work and branches without remote', async () => {
    const { project, w } = await setup()
    const local = await createBranchWorktree(realRepoGit, root, 'rev-1', project, [w], 'local-only')
    expect(await preflight(realRepoGit, [w, local])).toEqual([{ project: 'app', branch: 'local-only', kind: 'no-remote', detail: 0 }])

    await writeFile(join(w.path, 'a.txt'), 'changed')
    await writeFile(join(w.path, 'new.txt'), 'x')
    sh(w.path, 'commit', '-am', 'local commit')
    await writeFile(join(w.path, 'a.txt'), 'dirty again')
    const kinds = (await preflight(realRepoGit, [w])).map((i) => i.kind)
    expect(kinds).toEqual(['uncommitted', 'untracked', 'unpushed'])
  })

  it('archives notes, removes worktrees and the desk folder, keeps branches', async () => {
    const { project, status, desk, w } = await setup()
    await writeFile(join(status.notesDir(desk.id), 'n.md'), 'note')
    const target = await clearDesk(realRepoGit, status, root, desk, [w], [project], ['sess'], '2026-10-27')

    expect(await readFile(join(target, 'notes', 'n.md'), 'utf8')).toBe('note')
    expect(existsSync(join(root, 'rev-1'))).toBe(false)
    expect(sh(project.gitDir, 'worktree', 'list')).not.toContain('rev-1')
    expect(sh(project.gitDir, 'branch', '--list', 'feature-x')).toContain('feature-x')
    expect(await status.readDesks()).toEqual([])
  })

  it('refuses to clear outside the WorkDesk root', async () => {
    const { project, status, desk, w } = await setup()
    await expect(clearDesk(realRepoGit, status, root, { ...desk, id: '..' }, [w], [project], [], 'd')).rejects.toThrow(/Refusing/)
  })
})

it('ensureDeskFolder is idempotent', async () => {
  await ensureDeskFolder(root, 'x')
  await ensureDeskFolder(root, 'x')
  expect(lstatSync(join(root, 'x', 'notes')).isSymbolicLink()).toBe(true)
})

describe('project URLs', () => {
  it('shows where a Project was cloned from, for bare and existing clones', async () => {
    const bare = await registry.addByClone('app', origin)
    const clone = join(tmp, 'clone2')
    sh(tmp, 'clone', origin, clone)
    await registry.addExisting('mine', clone)
    expect(bare.name).toBe('app')
    const infos = await registry.listWithUrls()
    expect(infos.map((p) => [p.name, p.url])).toEqual([['app', origin], ['mine', origin]])
  })

  it('makes a Branch in a repository without a commit', async () => {
    const empty = join(tmp, 'empty')
    sh(tmp, 'init', empty)
    const project = await registry.addExisting('empty', empty)
    const w = await createBranchWorktree(realRepoGit, root, 'e-1', project, [], 'feature/first')
    expect(lstatSync(w.path).isDirectory()).toBe(true)
    expect(w.branch).toBe('feature/first')
  })

  it('makes a Branch folder that is a work tree also when the clone has extensions.worktreeConfig', async () => {
    const project = await registry.addByClone('app', origin)
    sh(project.gitDir, 'config', 'extensions.worktreeConfig', 'true')
    const w = await createBranchWorktree(realRepoGit, root, 'wc-1', project, [], 'feature/wc')
    expect(sh(w.path, 'rev-parse', '--is-inside-work-tree').trim()).toBe('true')
    expect(sh(w.path, 'status', '--short').trim()).toBe('')
  })

  it('takes a path that is a git directory as it is', async () => {
    const bareDir = join(tmp, 'acme-devkit')
    sh(tmp, 'clone', '--bare', origin, bareDir)
    const p = await registry.addExisting('devkit', bareDir)
    expect(p.gitDir).toBe(bareDir)
  })
})
