import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { EnvStore } from '../env/env-store'
import type { WorkDeskService } from '../service'
import type { BranchWorktree } from '../domain/types'
import type { ProjectInfo, ProjectRegistry } from './projects'
import type { RepoGit } from './repo-git'

const run = promisify(execFile)

export interface CommandResult {
  ok: boolean
  output: string
}

/** Runs a shell command in a folder (a login shell, so `pnpm` and friends are found). */
export type CommandRunner = (command: string, cwd: string) => Promise<CommandResult>

export const shellRunner: CommandRunner = async (command, cwd) => {
  try {
    const { stdout, stderr } = await run('/bin/zsh', ['-lc', command], { cwd, timeout: 10 * 60_000, maxBuffer: 20 * 1024 * 1024 })
    return { ok: true, output: (stdout + stderr).slice(-4000) }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string }
    return { ok: false, output: ((e.stdout ?? '') + (e.stderr ?? '') || e.message).slice(-4000) }
  }
}

export interface EnvActionResult {
  synced: string[]
  linked: string[]
  conflicts: string[]
  /** output of the setup commands, when they ran */
  output?: string
  failed?: boolean
}

/** Project list, order, names and the `.env` actions of a Branch. */
export class ProjectsService {
  readonly env: EnvStore

  constructor(
    private readonly registry: ProjectRegistry,
    private readonly service: WorkDeskService,
    root: string,
    private readonly git: RepoGit,
    private readonly runner: CommandRunner = shellRunner
  ) {
    this.env = new EnvStore(root)
  }

  async list(): Promise<ProjectInfo[]> {
    return Promise.all((await this.registry.listVisibleWithUrls()).map(async (p) => ({ ...p, envFiles: await this.env.list(p.name) })))
  }

  async addClone(name: string, url: string): Promise<ProjectInfo[]> {
    await this.registry.addByClone(name, url)
    return this.list()
  }

  /** An existing clone usually has the real `.env` files: take them into the store right away. */
  async addExisting(name: string, path: string): Promise<ProjectInfo[]> {
    await this.registry.addExisting(name, path)
    await this.env.sync(name, path).catch(() => undefined)
    return this.list()
  }

  /** Rename everywhere: registry, the Branches of WorkDesks and the stored `.env` files. */
  async rename(from: string, to: string): Promise<ProjectInfo[]> {
    await this.registry.rename(from, to)
    if (from !== to) {
      await this.env.rename(from, to)
      for (const desk of this.service.getState().desks.filter((d) => d.branches.some((b) => b.project === from))) {
        await this.service.updateDesk(desk.id, (d) => ({ ...d, branches: d.branches.map((b) => (b.project === from ? { ...b, project: to } : b)) }))
      }
    }
    return this.list()
  }

  async remove(name: string): Promise<ProjectInfo[]> {
    const users = this.service.getState().desks.filter((d) => d.branches.some((b) => b.project === name))
    if (users.length > 0) throw new Error(`${name} is in use by ${users.map((d) => d.name).join(', ')}; clear those WorkDesks first`)
    await this.registry.remove(name)
    return this.list()
  }

  async move(name: string, toIndex: number): Promise<ProjectInfo[]> {
    await this.registry.move(name, toIndex)
    return this.list()
  }

  async setEnvSetup(name: string, commands: string[]): Promise<ProjectInfo[]> {
    await this.registry.setEnvSetup(name, commands)
    return this.list()
  }

  async setCheckoutCommands(name: string, commands: string[]): Promise<ProjectInfo[]> {
    await this.registry.setCheckoutCommands(name, commands)
    return this.list()
  }

  async setSharedEnv(name: string, on: boolean): Promise<ProjectInfo[]> {
    await this.registry.setSharedEnv(name, on)
    return this.list()
  }

  private branch(deskId: string, project: string, branch: string): BranchWorktree {
    const desk = this.service.getState().desks.find((d) => d.id === deskId)
    const wt = desk?.branches.find((b) => b.project === project && b.branch === branch)
    if (!wt) throw new Error(`${branch} of ${project} is not in WorkDesk ${deskId}`)
    return wt
  }

  /** `ws sync-env`: this Branch's `.env` files become the stored ones. */
  async syncEnv(deskId: string, project: string, branch: string): Promise<EnvActionResult> {
    const wt = this.branch(deskId, project, branch)
    return { synced: (await this.env.sync(project, wt.path)).synced, linked: [], conflicts: [] }
  }

  /** `ws link-env`: link the stored files into this Branch. */
  async linkEnv(deskId: string, project: string, branch: string, force = false): Promise<EnvActionResult> {
    const wt = this.branch(deskId, project, branch)
    const { linked, conflicts } = await this.env.link(project, wt.path, force)
    if (linked.length > 0) await this.git.excludeLocally(wt.path, linked)
    return { synced: [], linked, conflicts }
  }

  /** The Branches of a WorkDesk. */
  private deskBranches(deskId: string): BranchWorktree[] {
    const desk = this.service.getState().desks.find((d) => d.id === deskId)
    if (!desk) throw new Error(`Unknown WorkDesk ${deskId}`)
    return desk.branches
  }

  /**
   * "Use this WorkDesk's `.env` files as the base for the others": per Project, the first Branch that has real
   * `.env` files (not links into the store) becomes the stored set, which new Branches then get linked.
   */
  async syncDeskEnv(deskId: string): Promise<EnvActionResult> {
    const result: EnvActionResult = { synced: [], linked: [], conflicts: [] }
    const done = new Set<string>()
    for (const wt of this.deskBranches(deskId)) {
      if (done.has(wt.project) || (await this.env.unstored(wt.path, wt.project)).length === 0) continue
      done.add(wt.project)
      result.synced.push(...(await this.env.sync(wt.project, wt.path)).synced.map((f) => `${wt.project}/${f}`))
    }
    return result
  }

  /** Replace the `.env` files of every Branch of a WorkDesk by links to the stored ones. */
  async linkDeskEnv(deskId: string, force = false): Promise<EnvActionResult> {
    const result: EnvActionResult = { synced: [], linked: [], conflicts: [] }
    for (const wt of this.deskBranches(deskId)) {
      const { linked, conflicts } = await this.env.link(wt.project, wt.path, force)
      if (linked.length > 0) await this.git.excludeLocally(wt.path, linked)
      result.linked.push(...linked.map((f) => `${wt.branch}/${f}`))
      result.conflicts.push(...conflicts.map((f) => `${wt.branch}/${f}`))
    }
    return result
  }

  /** `setup-envs`: run the Project's commands that regenerate `.env`, then store the result. */
  async runEnvSetup(deskId: string, project: string, branch: string): Promise<EnvActionResult> {
    const wt = this.branch(deskId, project, branch)
    const commands = (await this.registry.get(project)).envSetup ?? []
    if (commands.length === 0) throw new Error(`${project} has no env setup commands; add them on the Projects page`)
    let output = ''
    for (const command of commands) {
      const r = await this.runner(command, wt.path)
      output += `$ ${command}\n${r.output}\n`
      if (!r.ok) return { synced: [], linked: [], conflicts: [], output, failed: true }
    }
    return { ...(await this.syncEnv(deskId, project, branch)), output }
  }
}
