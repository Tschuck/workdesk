import { lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

export interface SyncResult {
  /** files copied into the store, relative to the worktree */
  synced: string[]
}

export interface LinkResult {
  linked: string[]
  /** a different local file is in the way; left alone unless forced */
  conflicts: string[]
}

const SKIP_DIRS = new Set(['node_modules', '.git'])

/**
 * Central store of `.env` files: `<root>/.env/<project>/<relative path>`. Lives next to, not inside,
 * the Status Repo, so secrets are never committed or pushed. Branch worktrees get symlinks into it.
 */
export class EnvStore {
  constructor(
    private readonly root: string,
    private readonly names: readonly string[] = ['.env']
  ) {}

  dir(project: string): string {
    return join(this.root, '.env', project)
  }

  private async walk(base: string, dir: string, keep: (name: string) => boolean): Promise<string[]> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    const found: string[] = []
    for (const e of entries) {
      const path = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) found.push(...(await this.walk(base, path, keep)))
      } else if (keep(e.name)) found.push(relative(base, path))
    }
    return found.sort()
  }

  /** Stored files of a Project. */
  list(project: string): Promise<string[]> {
    return this.walk(this.dir(project), this.dir(project), () => true)
  }

  /** `.env` files of a worktree that are real files, not links into the store: they would be lost with the worktree. */
  async unstored(worktree: string, project: string): Promise<string[]> {
    const store = this.dir(project)
    const found: string[] = []
    for (const rel of await this.walk(worktree, worktree, (n) => this.names.includes(n))) {
      if (!(await this.pointsIntoStore(join(worktree, rel), store))) found.push(rel)
    }
    return found
  }

  /** `ws sync-env`: copy every `.env` of a worktree into the store (content, not links). */
  async sync(project: string, worktree: string): Promise<SyncResult> {
    const store = this.dir(project)
    const synced: string[] = []
    for (const rel of await this.walk(worktree, worktree, (n) => this.names.includes(n))) {
      const source = join(worktree, rel)
      // a link into the store already is the stored file; copying it onto itself would empty it
      if (await this.pointsIntoStore(source, store)) continue
      const target = join(store, rel)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, await readFile(source))
      synced.push(rel)
    }
    return { synced }
  }

  /** `ws link-env`: symlink the stored files into a worktree, without overwriting different local files. */
  async link(project: string, worktree: string, force = false): Promise<LinkResult> {
    const store = this.dir(project)
    const result: LinkResult = { linked: [], conflicts: [] }
    for (const rel of await this.list(project)) {
      const stored = join(store, rel)
      const target = join(worktree, rel)
      const existing = await lstat(target).catch(() => undefined)
      if (existing && !existing.isSymbolicLink()) {
        const same = (await readFile(target)).equals(await readFile(stored))
        if (!same && !force) {
          result.conflicts.push(rel)
          continue
        }
      }
      await mkdir(dirname(target), { recursive: true })
      await rm(target, { force: true })
      await symlink(stored, target)
      result.linked.push(rel)
    }
    return result
  }

  /** A renamed Project keeps its stored files. */
  async rename(from: string, to: string): Promise<void> {
    await mkdir(dirname(this.dir(to)), { recursive: true })
    await rename(this.dir(from), this.dir(to)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err
    })
  }

  private async pointsIntoStore(path: string, store: string): Promise<boolean> {
    const info = await lstat(path)
    if (!info.isSymbolicLink()) return false
    const target = resolve(dirname(path), await readlink(path))
    const realStore = await realpath(store).catch(() => resolve(store))
    return target.startsWith(resolve(store) + sep) || target.startsWith(realStore + sep)
  }
}
