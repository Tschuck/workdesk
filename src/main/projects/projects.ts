import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { bareCloneDir } from './layout'
import type { RepoGit } from './repo-git'

export interface Project {
  name: string
  /** git directory worktrees are created from: our bare clone, or the user's existing clone */
  gitDir: string
  origin: 'bare-clone' | 'existing-clone'
  /** commands that regenerate the `.env` files (e.g. `pnpm apps:setup-env`), run in a Branch folder */
  envSetup?: string[]
  /** commands typed into a terminal of the WorkDesk each time a Branch of this Project is checked out, e.g. `pnpm install` */
  checkoutCommands?: string[]
  /** the stored `.env` files are linked into every new Branch of it; off: a new Branch starts without them (the `env` button still links them). Not set = on */
  sharedEnv?: boolean
  /** the Profile it is listed under; none = Profile #1 */
  profileId?: string
}

/** A Project as shown in the UI: where it lives and where it was cloned from. */
export interface ProjectInfo extends Project {
  /** where it was cloned from */
  url?: string
  /** stored `.env` files, relative to the Branch folder */
  envFiles: string[]
}

export const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function assertName(name: string): void {
  if (!PROJECT_NAME.test(name)) throw new Error(`"${name}" is not a valid Project name (letters, digits, . _ - only)`)
}

export class ProjectRegistry {
  constructor(
    private readonly file: string,
    private readonly git: RepoGit,
    private readonly root: string,
    /** the Profile a newly registered Project is listed under (none for Profile #1) */
    private readonly profileTag: () => string | undefined = () => undefined
  ) {}

  async list(): Promise<Project[]> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as Project[]
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }

  /** Which Projects the pages list: those of the Profile in view (set by the app; all by default). Lookups by name always see all. */
  visible: (p: Project) => boolean = () => true

  async listVisible(): Promise<Project[]> {
    return (await this.list()).filter((p) => this.visible(p))
  }

  async listVisibleWithUrls(): Promise<(Project & { url?: string })[]> {
    return (await this.listWithUrls()).filter((p) => this.visible(p))
  }

  /** Projects with their remote URL, read from git so it is right for existing clones too. */
  async listWithUrls(): Promise<(Project & { url?: string })[]> {
    return Promise.all((await this.list()).map(async (p) => ({ ...p, url: await this.git.remoteUrl(p.gitDir) })))
  }

  async get(name: string): Promise<Project> {
    const project = (await this.list()).find((p) => p.name === name)
    if (!project) throw new Error(`Unknown Project ${name}`)
    return project
  }

  /** Register a Project by making a bare clone in `.projects/` (an existing one there is reused). */
  async addByClone(name: string, url: string): Promise<Project> {
    assertName(name)
    await this.assertFree(name)
    const gitDir = bareCloneDir(this.root, name)
    if (existsSync(gitDir)) await this.git.fetch(gitDir)
    else await this.git.cloneBare(url, gitDir)
    return this.add({ name, gitDir, origin: 'bare-clone' })
  }

  /** Register a Project from a clone the user already has; worktrees are made from it. */
  async addExisting(name: string, clonePath: string): Promise<Project> {
    assertName(name)
    await this.assertFree(name)
    // a working copy has its git directory in `.git`; a path that is one itself (a bare repository, or `.git` typed out) is taken as it is
    const gitDir = existsSync(join(clonePath, '.git')) ? join(clonePath, '.git') : clonePath
    await this.git.fetch(gitDir).catch(() => undefined)
    return this.add({ name, gitDir, origin: 'existing-clone' })
  }

  /** Only the name changes; the folder stays where it is, so existing worktrees keep working. */
  async rename(from: string, to: string): Promise<void> {
    assertName(to)
    const all = await this.list()
    if (!all.some((p) => p.name === from)) throw new Error(`Unknown Project ${from}`)
    if (from !== to && all.some((p) => p.name === to)) throw new Error(`Project ${to} is already registered`)
    await this.write(all.map((p) => (p.name === from ? { ...p, name: to } : p)))
  }

  /** Unregister; the clone stays on disk because its Branches may hold unpushed work. */
  async remove(name: string): Promise<void> {
    const all = await this.list()
    if (!all.some((p) => p.name === name)) throw new Error(`Unknown Project ${name}`)
    await this.write(all.filter((p) => p.name !== name))
  }

  /** Put a Project at a new position of the list. */
  async move(name: string, toIndex: number): Promise<void> {
    const all = await this.list()
    const from = all.findIndex((p) => p.name === name)
    if (from === -1) throw new Error(`Unknown Project ${name}`)
    const [moved] = all.splice(from, 1)
    all.splice(Math.max(0, Math.min(toIndex, all.length)), 0, moved)
    await this.write(all)
  }

  async setEnvSetup(name: string, commands: string[]): Promise<void> {
    const all = await this.list()
    if (!all.some((p) => p.name === name)) throw new Error(`Unknown Project ${name}`)
    const clean = commands.map((c) => c.trim()).filter(Boolean)
    await this.write(all.map((p) => (p.name === name ? { ...p, envSetup: clean } : p)))
  }

  async setCheckoutCommands(name: string, commands: string[]): Promise<void> {
    const all = await this.list()
    if (!all.some((p) => p.name === name)) throw new Error(`Unknown Project ${name}`)
    const clean = commands.map((c) => c.trim()).filter(Boolean)
    await this.write(all.map((p) => (p.name === name ? { ...p, checkoutCommands: clean } : p)))
  }

  async setSharedEnv(name: string, on: boolean): Promise<void> {
    const all = await this.list()
    if (!all.some((p) => p.name === name)) throw new Error(`Unknown Project ${name}`)
    await this.write(all.map((p) => (p.name === name ? { ...p, sharedEnv: on } : p)))
  }

  private async assertFree(name: string): Promise<void> {
    if ((await this.list()).some((p) => p.name === name)) throw new Error(`Project ${name} is already registered`)
  }

  /** List a Project under another Profile; `undefined` = Profile #1. The Project itself is not touched. */
  async setProfile(name: string, profileId: string | undefined): Promise<void> {
    const all = await this.list()
    if (!all.some((p) => p.name === name)) throw new Error(`Unknown Project ${name}`)
    await this.write(all.map((p) => {
      if (p.name !== name) return p
      const { profileId: _, ...rest } = p
      return profileId ? { ...rest, profileId } : rest
    }))
  }

  private async add(project: Project): Promise<Project> {
    const tag = this.profileTag()
    if (tag) project = { ...project, profileId: tag }
    await this.write([...(await this.list()), project])
    return project
  }

  private async write(projects: Project[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(projects, null, 2) + '\n')
  }
}
