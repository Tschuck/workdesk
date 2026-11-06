import { execFileSync } from 'node:child_process'
import { lstatSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectRegistry } from '../projects/projects'
import { ProjectsService, type CommandRunner } from '../projects/projects-service'
import { realRepoGit } from '../projects/repo-git'
import { WorkDeskService } from '../service'
import { FakeGit } from '../status/fake-git'
import { EnvStore } from './env-store'

let tmp: string
beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'workdesk-env-')) })
afterEach(() => rm(tmp, { recursive: true, force: true }))

const put = async (path: string, text: string) => {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
}

describe('EnvStore', () => {
  it('syncs every .env, skipping node_modules and .git, and lists them', async () => {
    const wt = join(tmp, 'wt')
    await put(join(wt, '.env'), 'A=1')
    await put(join(wt, 'apps/api/.env'), 'B=2')
    await put(join(wt, 'node_modules/x/.env'), 'NO')
    await put(join(wt, '.git/.env'), 'NO')
    await put(join(wt, '.env.example'), 'not synced')
    const store = new EnvStore(tmp)
    expect((await store.sync('app', wt)).synced.sort()).toEqual(['.env', 'apps/api/.env'])
    expect(await store.list('app')).toEqual(['.env', 'apps/api/.env'])
    expect(await readFile(join(tmp, '.env', 'app', 'apps/api/.env'), 'utf8')).toBe('B=2')
  })

  it('links stored files, keeps differing local files unless forced, replaces identical ones', async () => {
    const store = new EnvStore(tmp)
    const src = join(tmp, 'src')
    await put(join(src, '.env'), 'STORED')
    await put(join(src, 'a/.env'), 'STORED-A')
    await put(join(src, 'b/.env'), 'SAME')
    await store.sync('app', src)

    const wt = join(tmp, 'wt')
    await put(join(wt, '.env'), 'LOCAL DIFFERENT')
    await put(join(wt, 'b/.env'), 'SAME')
    const r = await store.link('app', wt)
    expect(r.conflicts).toEqual(['.env'])
    expect(r.linked.sort()).toEqual(['a/.env', 'b/.env'])
    expect(await readFile(join(wt, '.env'), 'utf8')).toBe('LOCAL DIFFERENT')
    expect(lstatSync(join(wt, 'b/.env')).isSymbolicLink()).toBe(true)

    const forced = await store.link('app', wt, true)
    expect(forced.conflicts).toEqual([])
    expect(await readlink(join(wt, '.env'))).toBe(join(tmp, '.env', 'app', '.env'))
    expect(await readFile(join(wt, '.env'), 'utf8')).toBe('STORED')
  })

  it('never empties a stored file by syncing the link that points to it', async () => {
    const store = new EnvStore(tmp)
    const src = join(tmp, 'src')
    await put(join(src, '.env'), 'KEEP ME')
    await store.sync('app', src)
    const wt = join(tmp, 'wt')
    await store.link('app', wt)
    expect((await store.sync('app', wt)).synced).toEqual([])
    expect(await readFile(join(tmp, '.env', 'app', '.env'), 'utf8')).toBe('KEEP ME')
    // a link to somewhere else is still a real source
    const other = join(tmp, 'wt2')
    await put(join(tmp, 'elsewhere'), 'ELSE')
    await mkdir(other)
    await symlink(join(tmp, 'elsewhere'), join(other, '.env'))
    expect((await store.sync('app', other)).synced).toEqual(['.env'])
  })

  it('moves the stored files with a renamed Project', async () => {
    const store = new EnvStore(tmp)
    const src = join(tmp, 'src')
    await put(join(src, '.env'), 'A')
    await store.sync('old', src)
    await store.rename('old', 'new')
    await store.rename('missing', 'whatever')
    expect(await store.list('new')).toEqual(['.env'])
    expect(await store.list('old')).toEqual([])
  })
})

describe('ProjectsService', () => {
  let root: string
  let service: WorkDeskService
  let registry: ProjectRegistry
  let ran: { command: string; cwd: string }[]
  let fail: string | undefined
  let projects: ProjectsService

  beforeEach(async () => {
    root = join(tmp, 'root')
    service = new WorkDeskService(root, new FakeGit())
    await service.load()
    registry = new ProjectRegistry(join(service.status.dir, 'projects.json'), realRepoGit, root)
    ran = []
    fail = undefined
    const runner: CommandRunner = async (command, cwd) => {
      ran.push({ command, cwd })
      return command === fail ? { ok: false, output: 'boom' } : { ok: true, output: 'ok' }
    }
    projects = new ProjectsService(registry, service, root, realRepoGit, runner)
    // register without git: write the registry file directly
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(service.status.dir, { recursive: true })
    await writeFile(
      join(service.status.dir, 'projects.json'),
      JSON.stringify(['a', 'b', 'c'].map((name) => ({ name, gitDir: join(tmp, name + '.git'), origin: 'bare-clone' }))),
    )
  })
  afterEach(() => service.status.autoCommit.dispose())

  const names = async () => (await projects.list()).map((p) => p.name)

  it('moves, renames and validates names', async () => {
    expect(await names()).toEqual(['a', 'b', 'c'])
    await projects.move('c', 0)
    expect(await names()).toEqual(['c', 'a', 'b'])
    await projects.move('c', 99)
    expect(await names()).toEqual(['a', 'b', 'c'])
    await expect(projects.move('zzz', 0)).rejects.toThrow(/Unknown/)

    await projects.rename('b', 'bee')
    expect(await names()).toEqual(['a', 'bee', 'c'])
    await expect(projects.rename('a', 'c')).rejects.toThrow(/already registered/)
    await expect(projects.rename('a', 'bad/name')).rejects.toThrow(/valid Project name/)
    await expect(projects.rename('nope', 'x')).rejects.toThrow(/Unknown/)
  })

  it('rename follows into WorkDesk Branches and the env store', async () => {
    let s = await service.addTodo({ title: 'T', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'T')
    await service.updateDesk('t', (d) => ({ ...d, branches: [{ project: 'a', branch: 'x', path: join(root, 't', 'a'), index: 1 }] }))
    await put(join(tmp, 'src/.env'), 'A=1')
    await projects.env.sync('a', join(tmp, 'src'))

    await projects.rename('a', 'alpha')
    expect(service.getState().desks[0].branches[0].project).toBe('alpha')
    expect((await projects.list()).find((p) => p.name === 'alpha')!.envFiles).toEqual(['.env'])
  })

  it('refuses to remove a Project that a WorkDesk uses, keeps the folder otherwise', async () => {
    let s = await service.addTodo({ title: 'T', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'T')
    await service.updateDesk('t', (d) => ({ ...d, branches: [{ project: 'a', branch: 'x', path: join(root, 't', 'a'), index: 1 }] }))
    await expect(projects.remove('a')).rejects.toThrow(/in use by T/)
    expect(await names()).toEqual(['a', 'b', 'c'])
    await projects.remove('b')
    expect(await names()).toEqual(['a', 'c'])
  })

  it('runs env setup commands in the Branch folder, then syncs; stops at the first failure', async () => {
    let s = await service.addTodo({ title: 'T', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'T')
    const path = join(root, 't', 'a')
    await put(join(path, '.env'), 'GENERATED=1')
    execFileSync('git', ['init', '-q'], { cwd: path })
    await service.updateDesk('t', (d) => ({ ...d, branches: [{ project: 'a', branch: 'x', path, index: 1 }] }))

    await expect(projects.runEnvSetup('t', 'a', 'x')).rejects.toThrow(/no env setup commands/)
    await projects.setEnvSetup('a', [' pnpm apps:setup-env ', '', 'pnpm second'])
    const ok = await projects.runEnvSetup('t', 'a', 'x')
    expect(ran).toEqual([{ command: 'pnpm apps:setup-env', cwd: path }, { command: 'pnpm second', cwd: path }])
    expect(ok.synced).toEqual(['.env'])
    expect(ok.output).toContain('$ pnpm apps:setup-env')

    ran = []
    fail = 'pnpm apps:setup-env'
    const bad = await projects.runEnvSetup('t', 'a', 'x')
    expect(bad).toMatchObject({ failed: true, synced: [] })
    expect(ran).toHaveLength(1)

    const linked = await projects.linkEnv('t', 'a', 'x', true)
    expect(linked.linked).toEqual(['.env'])
    await expect(projects.syncEnv('t', 'a', 'nope')).rejects.toThrow(/not in WorkDesk/)
  })
})
