import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BranchesService } from './branches-service'
import { ProjectRegistry } from './projects/projects'
import { realRepoGit, type RepoGit } from './projects/repo-git'
import { WorkDeskService } from './service'
import { FakeGit } from './status/fake-git'

Object.assign(process.env, { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'a@t', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'a@t' })
const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()

let tmp: string
let root: string
let origin: string
let service: WorkDeskService
let registry: ProjectRegistry
let branches: BranchesService

async function commit(repo: string, file: string, message: string) {
  await writeFile(join(repo, file), message)
  sh(repo, 'add', '.')
  sh(repo, 'commit', '-m', message)
}

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'workdesk-exb-'))
  root = join(tmp, 'root')
  const seed = join(tmp, 'seed')
  origin = join(tmp, 'origin.git')
  await mkdir(seed)
  sh(seed, 'init', '-b', 'main')
  await commit(seed, 'base.txt', 'base')
  sh(seed, 'checkout', '-b', 'feature-a')
  await commit(seed, 'a.txt', 'work on a')
  sh(seed, 'checkout', '-b', 'feature-b')
  await commit(seed, 'b.txt', 'work on b')
  sh(seed, 'checkout', 'main')
  sh(seed, 'checkout', '-b', 'side')
  await commit(seed, 's.txt', 'a side branch')
  sh(tmp, 'clone', '--bare', seed, origin)
  service = new WorkDeskService(root, new FakeGit())
  await service.load()
  registry = new ProjectRegistry(join(service.status.dir, 'projects.json'), realRepoGit, root)
  await registry.addByClone('app', origin)
  branches = new BranchesService(service, registry, realRepoGit)
})
afterEach(async () => {
  service.status.autoCommit.dispose()
  await rm(tmp, { recursive: true, force: true })
})

describe('existing branches of the Projects', () => {
  it('lists local and remote branches with their last commit, newest first', async () => {
    const [app] = await branches.listBranches(true)
    expect(app.project).toBe('app')
    expect(app.branches.map((b) => b.name).sort()).toEqual(['feature-a', 'feature-b', 'main', 'side'])
    const b = app.branches.find((x) => x.name === 'feature-b')!
    expect(b).toMatchObject({ remote: true, local: false, author: 'Ada', subject: 'work on b' })
    expect(b.date).toBeGreaterThan(0)
    expect(app.branches.map((x) => x.date)).toEqual([...app.branches.map((x) => x.date)].sort((x, y) => y - x))
    expect(app.branches.every((x) => !x.inDesk && !x.checkedOutAt)).toBe(true)
  })

  it('reports an unreadable Project without losing the others', async () => {
    await registry.addExisting('broken', join(tmp, 'nowhere'))
    const all = await branches.listBranches(false)
    expect(all.find((p) => p.project === 'app')!.branches.length).toBe(4)
    expect(all.find((p) => p.project === 'broken')!.error).toBeTruthy()
  })
})

describe('a WorkDesk from existing branches', () => {
  it('checks out several branches and makes a Stack of those that sit on each other', async () => {
    const s = await branches.createFromBranches(
      [{ project: 'app', branch: 'feature-b' }, { project: 'app', branch: 'feature-a' }, { project: 'app', branch: 'side' }],
      ' Auth work '
    )
    const desk = s.desks[0]
    expect(desk).toMatchObject({ id: 'auth-work', name: 'Auth work', stage: 'implement' })
    const by = Object.fromEntries(desk.branches.map((x) => [x.branch, x]))
    expect(by['feature-a'].base).toBeUndefined()
    expect(by['feature-b'].base).toBe('feature-a')
    expect(by['side'].base).toBeUndefined()
    expect(desk.branches.map((x) => x.index)).toEqual([1, 2, 3])
    for (const w of desk.branches) expect(await realRepoGit.currentBranch(w.path)).toBe(w.branch)
    expect(existsSync(join(desk.branches[0].path, 'b.txt')) || existsSync(join(desk.branches[1].path, 'b.txt'))).toBe(true)
    // no Todo is made for it
    expect(s.todos).toEqual([])
    expect(desk.todoIds).toEqual([])

    // the listing now shows who has them
    const [app] = await branches.listBranches(false)
    expect(app.branches.find((b) => b.name === 'feature-a')!.inDesk).toEqual({ id: 'auth-work', name: 'Auth work' })
    expect(app.branches.find((b) => b.name === 'main')!.inDesk).toBeUndefined()
  })

  it('names the WorkDesk after the first branch when no name is given', async () => {
    const s = await branches.createFromBranches([{ project: 'app', branch: 'side' }], '   ')
    expect(s.desks[0].name).toBe('side')
  })

  it('refuses taken branches, unknown ones and empty selections', async () => {
    await branches.createFromBranches([{ project: 'app', branch: 'feature-a' }], 'One')
    await expect(branches.createFromBranches([{ project: 'app', branch: 'feature-a' }], 'Two')).rejects.toThrow(/already in the WorkDesk "One"/)
    await expect(branches.createFromBranches([{ project: 'app', branch: 'nope' }], 'x')).rejects.toThrow(/not found/)
    await expect(branches.createFromBranches([], 'x')).rejects.toThrow(/at least one/)
    expect(service.getState().desks).toHaveLength(1)
  })

  it('refuses a branch that is checked out in your own clone', async () => {
    const clone = join(tmp, 'clone')
    sh(tmp, 'clone', origin, clone)
    await registry.addExisting('mine', clone)
    const listed = (await branches.listBranches(false)).find((p) => p.project === 'mine')!
    // a fresh clone has the origin's current branch checked out
    const current = sh(clone, 'branch', '--show-current')
    const row = listed.branches.find((b) => b.name === current)!
    expect(row.local).toBe(true)
    expect(row.checkedOutAt).toBeTruthy()
    await expect(branches.createFromBranches([{ project: 'mine', branch: current }], 'x')).rejects.toThrow(/checked out in/)
    // the other branches of that clone are fine
    const ok = await branches.createFromBranches([{ project: 'mine', branch: 'feature-a' }], 'From my clone')
    expect(ok.desks[0].branches[0].branch).toBe('feature-a')
  })

  it('leaves nothing behind when a checkout fails halfway', async () => {
    let calls = 0
    const flaky: RepoGit = { ...realRepoGit, addWorktree: async (...args) => { if (++calls === 2) throw new Error('disk full'); return realRepoGit.addWorktree(...args) } }
    const svc = new BranchesService(service, registry, flaky)
    await expect(svc.createFromBranches([{ project: 'app', branch: 'feature-a' }, { project: 'app', branch: 'side' }], 'Half')).rejects.toThrow('disk full')
    expect(service.getState().desks).toEqual([])
    expect(service.getState().todos).toEqual([])
    expect(existsSync(join(root, 'half'))).toBe(false)
    const project = await registry.get('app')
    expect(sh(project.gitDir, 'worktree', 'list')).not.toMatch(/root\/half/)
    // and the branch can be used afterwards
    expect((await branches.createFromBranches([{ project: 'app', branch: 'feature-a' }], 'Again')).desks).toHaveLength(1)
  })
})

describe('fetching and pulling the branches of a WorkDesk', () => {
  async function otherClone() {
    const clone = join(tmp, 'other-clone')
    sh(tmp, 'clone', origin, clone)
    sh(clone, 'checkout', 'feature-a')
    return clone
  }

  it('shows what was pushed from another clone, and fast-forwards the branch', async () => {
    const s = await branches.createFromBranches([{ project: 'app', branch: 'feature-a' }], 'Pull me')
    const wt = s.desks[0].branches[0]
    expect(await branches.deskSync('pull-me')).toEqual([{ project: 'app', branch: 'feature-a', upstream: 'origin/feature-a', behind: 0, ahead: 0, dirty: false }])

    const other = await otherClone()
    await commit(other, 'pushed.txt', 'pushed from elsewhere')
    sh(other, 'push', 'origin', 'feature-a')

    // nothing is known before fetching
    expect((await branches.deskSync('pull-me'))[0].behind).toBe(0)
    expect((await branches.fetchDesk('pull-me'))[0]).toMatchObject({ behind: 1, ahead: 0 })
    expect(existsSync(join(wt.path, 'pushed.txt'))).toBe(false)

    expect(await branches.pullBranch('pull-me', 'app', 'feature-a')).toEqual({ result: 'updated' })
    expect(existsSync(join(wt.path, 'pushed.txt'))).toBe(true)
    expect((await branches.deskSync('pull-me'))[0]).toMatchObject({ behind: 0, ahead: 0 })
    expect(await branches.pullBranch('pull-me', 'app', 'feature-a')).toEqual({ result: 'up-to-date' })
  })

  it('does not merge when both sides have new commits, and counts unpushed ones', async () => {
    const s = await branches.createFromBranches([{ project: 'app', branch: 'feature-a' }], 'Diverge')
    const wt = s.desks[0].branches[0]
    await commit(wt.path, 'local.txt', 'local work')
    expect((await branches.deskSync('diverge'))[0]).toMatchObject({ ahead: 1, behind: 0 })
    const other = await otherClone()
    await commit(other, 'remote.txt', 'remote work')
    sh(other, 'push', 'origin', 'feature-a')
    expect((await branches.fetchDesk('diverge'))[0]).toMatchObject({ ahead: 1, behind: 1 })
    const r = await branches.pullBranch('diverge', 'app', 'feature-a')
    expect(r).toMatchObject({ result: 'diverged', message: expect.stringContaining('1 ahead, 1 behind') })
    expect(existsSync(join(wt.path, 'remote.txt'))).toBe(false)
  })

  it('reports uncommitted changes, a missing remote branch and unknown branches', async () => {
    await branches.createFromBranches([{ project: 'app', branch: 'feature-a' }], 'Dirty')
    const wt = service.getState().desks[0].branches[0]
    await writeFile(join(wt.path, 'a.txt'), 'edited, uncommitted')
    const other = await otherClone()
    await writeFile(join(other, 'a.txt'), 'edited upstream')
    sh(other, 'commit', '-am', 'upstream edit')
    sh(other, 'push', 'origin', 'feature-a')
    expect((await branches.fetchDesk('dirty'))[0]).toMatchObject({ behind: 1, dirty: true })
    expect(await branches.pullBranch('dirty', 'app', 'feature-a')).toMatchObject({ result: 'blocked' })

    // a branch made here has no remote counterpart yet
    const added = await branches.addBranch('dirty', 'app', 'brand-new', 'feature-a')
    expect(added.desks[0].branches).toHaveLength(2)
    expect(await branches.pullBranch('dirty', 'app', 'brand-new')).toMatchObject({ result: 'no-upstream' })
    await expect(branches.pullBranch('dirty', 'app', 'nope')).rejects.toThrow(/not in this WorkDesk/)
    await expect(branches.deskSync('zzz')).rejects.toThrow(/Unknown WorkDesk/)
  })
})

describe('adding branches to an existing WorkDesk', () => {
  it('checks out an existing branch of a Project, stacked on what the WorkDesk has', async () => {
    await branches.createFromBranches([{ project: 'app', branch: 'feature-a' }], 'Grow')
    const s = await branches.addBranch('grow', 'app', 'feature-b')
    const b = s.desks[0].branches.find((x) => x.branch === 'feature-b')!
    expect(b.base).toBe('feature-a')
    expect(b.index).toBe(2)
    expect(await realRepoGit.currentBranch(b.path)).toBe('feature-b')
    expect(existsSync(join(b.path, 'b.txt'))).toBe(true)
  })

  it('creates a new branch from the base you pick, or from the default branch', async () => {
    await branches.createFromBranches([{ project: 'app', branch: 'feature-a' }], 'New ones')
    let s = await branches.addBranch('new-ones', 'app', 'on-top', 'feature-a')
    expect(s.desks[0].branches.find((x) => x.branch === 'on-top')!.base).toBe('feature-a')
    s = await branches.addBranch('new-ones', 'app', 'fresh')
    const fresh = s.desks[0].branches.find((x) => x.branch === 'fresh')!
    expect(fresh.base).toBeUndefined()
    expect(await realRepoGit.currentBranch(fresh.path)).toBe('fresh')
  })

  it('refuses a branch that another WorkDesk has, with a clear message', async () => {
    await branches.createFromBranches([{ project: 'app', branch: 'feature-a' }], 'One')
    await branches.createFromBranches([{ project: 'app', branch: 'side' }], 'Two')
    await expect(branches.addBranch('two', 'app', 'feature-a')).rejects.toThrow(/already in the WorkDesk "One"/)
    await expect(branches.addExistingBranches('two', [{ project: 'app', branch: 'feature-a' }])).rejects.toThrow(/already in the WorkDesk "One"/)
    // the WorkDesk's own branch is taken too
    await expect(branches.addBranch('two', 'app', 'side')).rejects.toThrow(/already in the WorkDesk "Two"/)
  })

  it('adds several existing branches at once, also from another Project, and detects the Stack', async () => {
    const seed2 = join(tmp, 'seed2')
    const origin2 = join(tmp, 'lib.git')
    await mkdir(seed2)
    sh(seed2, 'init', '-b', 'main')
    await commit(seed2, 'l.txt', 'lib base')
    sh(seed2, 'checkout', '-b', 'lib-fix')
    await commit(seed2, 'fix.txt', 'lib fix')
    sh(tmp, 'clone', '--bare', seed2, origin2)
    await registry.addByClone('lib', origin2)

    await branches.createFromBranches([{ project: 'app', branch: 'feature-a' }], 'Many')
    const s = await branches.addExistingBranches('many', [{ project: 'app', branch: 'feature-b' }, { project: 'lib', branch: 'lib-fix' }])
    const by = Object.fromEntries(s.desks[0].branches.map((b) => [b.branch, b]))
    expect(by['feature-b'].base).toBe('feature-a')
    expect(by['lib-fix'].base).toBeUndefined()
    expect(by['lib-fix'].project).toBe('lib')
    expect(s.desks[0].branches.map((b) => b.index)).toEqual([1, 2, 1])
    await expect(branches.addExistingBranches('many', [])).rejects.toThrow(/at least one/)
  })

  it('leaves nothing behind when a checkout fails', async () => {
    await branches.createFromBranches([{ project: 'app', branch: 'feature-a' }], 'Rev')

    let calls = 0
    const flaky: RepoGit = { ...realRepoGit, addWorktree: async (...args) => { if (++calls === 2) throw new Error('disk full'); return realRepoGit.addWorktree(...args) } }
    const svc = new BranchesService(service, registry, flaky)
    await expect(svc.addExistingBranches('rev', [{ project: 'app', branch: 'feature-b' }, { project: 'app', branch: 'side' }])).rejects.toThrow('disk full')
    expect(service.getState().desks[0].branches).toHaveLength(1)
    const project = await registry.get('app')
    expect(sh(project.gitDir, 'worktree', 'list')).not.toMatch(/feature-b/)
    expect((await branches.addExistingBranches('rev', [{ project: 'app', branch: 'feature-b' }])).desks[0].branches).toHaveLength(2)
  })
})

describe('a WorkDesk on a new branch', () => {
  it('creates the branch from the default branch and the WorkDesk together', async () => {
    const s = await branches.createFromBranches([], 'Fresh start', [{ project: 'app', branch: 'my-feature' }])
    const desk = s.desks[0]
    expect(desk).toMatchObject({ id: 'fresh-start', name: 'Fresh start', })
    const b = desk.branches[0]
    expect(b).toMatchObject({ project: 'app', branch: 'my-feature', base: undefined })
    expect(await realRepoGit.currentBranch(b.path)).toBe('my-feature')
    // it starts at the default branch: none of the feature work is in it
    expect(existsSync(join(b.path, 'base.txt'))).toBe(true)
    expect(existsSync(join(b.path, 'a.txt'))).toBe(false)
    expect(s.todos).toEqual([])
    // and it shows up in the list as a local branch that has no remote yet
    const row = (await branches.listBranches(false))[0].branches.find((x) => x.name === 'my-feature')!
    expect(row).toMatchObject({ local: true, remote: false, inDesk: { id: 'fresh-start', name: 'Fresh start' } })
  })

  it('can start from another branch, even one that only exists on the remote, and targets it', async () => {
    const s = await branches.createFromBranches([], '', [{ project: 'app', branch: 'follow-up', from: 'feature-a' }])
    const b = s.desks[0].branches[0]
    expect(s.desks[0].name).toBe('follow-up')
    expect(b.base).toBe('feature-a')
    expect(existsSync(join(b.path, 'a.txt'))).toBe(true)
    expect(existsSync(join(b.path, 'b.txt'))).toBe(false)
  })

  it('mixes new and existing branches, and stacks a new branch on one that is in the WorkDesk', async () => {
    const s = await branches.createFromBranches([{ project: 'app', branch: 'feature-a' }], 'Mix', [{ project: 'app', branch: 'next-step', from: 'feature-a' }])
    const by = Object.fromEntries(s.desks[0].branches.map((x) => [x.branch, x]))
    expect(by['feature-a'].base).toBeUndefined()
    expect(by['next-step'].base).toBe('feature-a')
    expect(s.desks[0].branches.map((x) => x.index)).toEqual([1, 2])
  })

  it('refuses names that exist, are invalid or twice, and unknown starting points', async () => {
    const nb = (branch: string, from?: string) => [{ project: 'app', branch, from }]
    await expect(branches.createFromBranches([], 'x', nb('feature-a'))).rejects.toThrow(/already exists/)
    for (const bad of ['has space', '', 'a..b', '-lead', 'trail/', 'x.lock', 'a~b', 'a@{b']) {
      await expect(branches.createFromBranches([], 'x', nb(bad))).rejects.toThrow(/not a valid branch name/)
    }
    await expect(branches.createFromBranches([], 'x', [...nb('same'), ...nb('same')])).rejects.toThrow(/named twice/)
    await expect(branches.createFromBranches([], 'x', nb('new-one', 'nope'))).rejects.toThrow(/no such branch/)
    await expect(branches.createFromBranches([], 'x', [{ project: 'zzz', branch: 'new-one' }])).rejects.toThrow(/Unknown Project/)
    await expect(branches.createFromBranches([], 'x')).rejects.toThrow(/at least one/)
    expect(service.getState().desks).toEqual([])
  })

  it('leaves no new branch or folder behind when a checkout fails', async () => {
    let calls = 0
    const flaky: RepoGit = { ...realRepoGit, addWorktree: async (...args) => { if (++calls === 2) throw new Error('disk full'); return realRepoGit.addWorktree(...args) } }
    const svc = new BranchesService(service, registry, flaky)
    await expect(svc.createFromBranches([{ project: 'app', branch: 'side' }], 'Oops', [{ project: 'app', branch: 'brand-new' }])).rejects.toThrow('disk full')
    expect(service.getState().desks).toEqual([])
    expect(existsSync(join(root, 'oops'))).toBe(false)
    const project = await registry.get('app')
    expect(sh(project.gitDir, 'worktree', 'list')).not.toMatch(/root\/oops/)
  })
})

describe('starting a new branch of an open WorkDesk from any existing branch', () => {
  it('uses a branch the WorkDesk does not have, also one that only exists on the remote', async () => {
    await branches.createFromBranches([{ project: 'app', branch: 'side' }], 'Start elsewhere')
    const s = await branches.addBranch('start-elsewhere', 'app', 'from-b', 'feature-b')
    const b = s.desks[0].branches.find((x) => x.branch === 'from-b')!
    expect(b.base).toBe('feature-b')
    expect(existsSync(join(b.path, 'b.txt'))).toBe(true)
    expect(existsSync(join(b.path, 's.txt'))).toBe(false)
    expect(await realRepoGit.currentBranch(b.path)).toBe('from-b')
    await expect(branches.addBranch('start-elsewhere', 'app', 'x', 'nope')).rejects.toThrow(/no such branch/)
  })

  it('still starts a new branch from the default branch, and ignores the starting point for an existing name', async () => {
    await branches.createFromBranches([{ project: 'app', branch: 'side' }], 'Defaults')
    let s = await branches.addBranch('defaults', 'app', 'plain-new')
    expect(s.desks[0].branches.find((x) => x.branch === 'plain-new')!.base).toBeUndefined()
    s = await branches.addBranch('defaults', 'app', 'feature-a', 'side')
    const a = s.desks[0].branches.find((x) => x.branch === 'feature-a')!
    expect(a.base).toBeUndefined()
    expect(existsSync(join(a.path, 'a.txt'))).toBe(true)
  })
})

describe('details and deletion of a branch', () => {
  it('shows the commits, how far it is from the default branch, and whether it is merged', async () => {
    const d = await branches.branchDetails('app', 'feature-b')
    expect(d).toMatchObject({ name: 'feature-b', project: 'app', remote: true, local: false, isDefault: false, merged: false })
    expect(d.defaultBranch).toBeTruthy()
    // feature-b holds the commits of feature-a and its own, on top of the first one
    expect(d.ahead).toBe(2)
    expect(d.behind).toBeGreaterThanOrEqual(0)
    expect(d.commits.map((c) => c.subject).slice(0, 3)).toEqual(['work on b', 'work on a', 'base'])
    expect(d.commits[0]).toMatchObject({ author: 'Ada' })
    expect(d.commits[0].sha).toMatch(/^[0-9a-f]{40}$/)
    // the fixture's remote is a local path, not GitHub: no link
    expect(d.githubUrl).toBeUndefined()
    expect(d.commits[0].date).toBeGreaterThan(0)

    const def = await branches.branchDetails('app', d.defaultBranch!)
    expect(def).toMatchObject({ isDefault: true, ahead: 0, behind: 0, merged: false })
    await expect(branches.branchDetails('app', 'nope')).rejects.toThrow(/not found/)
    await expect(branches.branchDetails('zzz', 'x')).rejects.toThrow(/Unknown Project/)
  })

  it('deletes a local branch only when it is merged, unless forced; and never the default branch', async () => {
    const project = await registry.get('app')
    // --no-track: a branch that tracks its remote counts as merged when it is level with it
    sh(project.gitDir, 'branch', '--no-track', 'merged-one', 'origin/main')
    // a commit that exists nowhere else: local work
    const local = sh(project.gitDir, 'commit-tree', 'origin/feature-a^{tree}', '-p', 'origin/feature-a', '-m', 'local only')
    sh(project.gitDir, 'branch', '--no-track', 'unmerged', local)
    const def = (await branches.branchDetails('app', 'side')).defaultBranch!

    let all = await branches.deleteBranch('app', 'merged-one', { local: true, remote: false })
    expect(all[0].branches.some((b) => b.name === 'merged-one')).toBe(false)
    await expect(branches.deleteBranch('app', 'unmerged', { local: true, remote: false })).rejects.toThrow(/not on any remote branch/)
    expect((await branches.listBranches(false))[0].branches.some((b) => b.name === 'unmerged')).toBe(true)
    all = await branches.deleteBranch('app', 'unmerged', { local: true, remote: false, force: true })
    expect(all[0].branches.some((b) => b.name === 'unmerged')).toBe(false)

    await expect(branches.deleteBranch('app', def, { local: true, remote: true })).rejects.toThrow(/default branch/)
    await expect(branches.deleteBranch('app', 'feature-a', { local: true, remote: false })).rejects.toThrow(/no local branch/)
    await expect(branches.deleteBranch('app', 'feature-a', { local: false, remote: false })).rejects.toThrow(/Choose what to delete/)
  })

  it('does not delete both when the remote branch is the only copy of the commits, and changes nothing then', async () => {
    const project = await registry.get('app')
    // feature-b is built on feature-a, so feature-a's commits also live on origin/feature-b; feature-b's own commit does not
    sh(project.gitDir, 'branch', '--no-track', 'feature-b', 'origin/feature-b')
    await expect(branches.deleteBranch('app', 'feature-b', { local: true, remote: true })).rejects.toThrow(/exist on no other branch/)
    // nothing was touched: neither the local branch nor anything on the remote
    const row = (await branches.listBranches(false))[0].branches.find((b) => b.name === 'feature-b')!
    expect(row).toMatchObject({ local: true, remote: true })
    expect(sh(origin, 'branch', '--list', 'feature-b')).toContain('feature-b')
    // alone it is fine (the commits stay on the remote)
    await branches.deleteBranch('app', 'feature-b', { local: true, remote: false })
    expect(sh(origin, 'branch', '--list', 'feature-b')).toContain('feature-b')

    // feature-a's commits are on another remote branch as well, so both can go; forcing is possible anyway
    sh(project.gitDir, 'branch', '--no-track', 'feature-a', 'origin/feature-a')
    const after = await branches.deleteBranch('app', 'feature-a', { local: true, remote: true })
    expect(after[0].branches.some((b) => b.name === 'feature-a')).toBe(false)
    expect(sh(origin, 'branch', '--list', 'feature-a')).toBe('')
    sh(project.gitDir, 'branch', '--no-track', 'feature-b', 'origin/feature-b')
    const forced = await branches.deleteBranch('app', 'feature-b', { local: true, remote: true, force: true })
    expect(forced[0].branches.some((b) => b.name === 'feature-b')).toBe(false)
    expect(sh(origin, 'branch', '--list', 'feature-b')).toBe('')
  })

  it('deletes the remote branch for everyone, local first kept when that fails', async () => {
    expect(sh(origin, 'branch', '--list', 'feature-b')).toContain('feature-b')
    const all = await branches.deleteBranch('app', 'feature-b', { local: false, remote: true })
    expect(sh(origin, 'branch', '--list', 'feature-b')).toBe('')
    expect(all[0].branches.some((b) => b.name === 'feature-b')).toBe(false)
    await expect(branches.deleteBranch('app', 'feature-b', { local: false, remote: true })).rejects.toThrow(/not found/)
    // both at once
    await branches.createFromBranches([{ project: 'app', branch: 'feature-a' }], 'Temp')
    await expect(branches.deleteBranch('app', 'feature-a', { local: true, remote: true })).rejects.toThrow(/in the WorkDesk "Temp"/)
    // the refusal came before anything was touched
    expect(sh(origin, 'branch', '--list', 'feature-a')).toContain('feature-a')
  })

  it('does not delete a branch a WorkDesk or your own clone has checked out', async () => {
    const clone = join(tmp, 'clone')
    sh(tmp, 'clone', origin, clone)
    await registry.addExisting('mine', clone)
    const current = sh(clone, 'branch', '--show-current')
    await expect(branches.deleteBranch('mine', current, { local: true, remote: false })).rejects.toThrow(/checked out in|default branch/)
  })
})

describe('removing a branch from a WorkDesk', () => {
  it('deletes its folder, keeps the branch, and re-attaches the branches stacked on it', async () => {
    const s = await branches.createFromBranches([{ project: 'app', branch: 'feature-a' }, { project: 'app', branch: 'feature-b' }, { project: 'app', branch: 'side' }], 'Stack')
    const by = Object.fromEntries(s.desks[0].branches.map((b) => [b.branch, b]))
    expect(by['feature-b'].base).toBe('feature-a')
    expect(existsSync(by['feature-a'].path)).toBe(true)

    // nothing to lose: no changes, and its commits are on the remote
    expect(await branches.removalPreflight('stack', 'app', 'feature-a')).toEqual([])
    const after = await branches.removeBranchFromDesk('stack', 'app', 'feature-a')
    expect(existsSync(by['feature-a'].path)).toBe(false)
    expect(after.desks[0].branches.map((b) => b.branch)).toEqual(['feature-b', 'side'])
    // feature-b was on feature-a, which had no base: it is on its own now
    expect(after.desks[0].branches.find((b) => b.branch === 'feature-b')!.base).toBeUndefined()
    // the branch is not deleted: it is free again, and in the list
    const row = (await branches.listBranches(false))[0].branches.find((b) => b.name === 'feature-a')!
    expect(row.inDesk).toBeUndefined()
    expect(sh(origin, 'branch', '--list', 'feature-a')).toContain('feature-a')
    const project = await registry.get('app')
    expect(sh(project.gitDir, 'worktree', 'list')).not.toMatch(/stack\/app\b[^-]/)
    // and it can be added again
    expect((await branches.addBranch('stack', 'app', 'feature-a')).desks[0].branches).toHaveLength(3)
  })

  it('lists what would be lost first, and refuses unknown branches', async () => {
    const s = await branches.createFromBranches([{ project: 'app', branch: 'feature-a' }], 'Dirty one')
    const wt = s.desks[0].branches[0]
    await writeFile(join(wt.path, 'a.txt'), 'edited')
    await writeFile(join(wt.path, 'new.txt'), 'x')
    await writeFile(join(wt.path, '.env'), 'SECRET=1')
    const issues = await branches.removalPreflight('dirty-one', 'app', 'feature-a')
    expect(issues.map((i) => i.kind)).toEqual(expect.arrayContaining(['env', 'uncommitted', 'untracked']))
    expect(issues.find((i) => i.kind === 'env')!.detail).toEqual(['.env'])

    await expect(branches.removalPreflight('dirty-one', 'app', 'nope')).rejects.toThrow(/not in this WorkDesk/)
    await expect(branches.removeBranchFromDesk('dirty-one', 'app', 'nope')).rejects.toThrow(/not in this WorkDesk/)
    expect(existsSync(wt.path)).toBe(true)
  })
})
