import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { installHooks, isInstalled, uninstallHooks } from './installer'

export interface ClaudeDirStatus {
  path: string
  installed: boolean
  error?: string
}

/** Defaults offered for registration: `~/.claude` and `$CLAUDE_CONFIG_DIR`, when they exist. */
export function defaultClaudeDirs(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): string[] {
  return [...new Set([env['CLAUDE_CONFIG_DIR'], join(homedir(), '.claude')].filter((p): p is string => !!p && exists(p)))]
}

/**
 * The Claude config directories the user registered. Hooks are only written into them on an
 * explicit install call (consent), and can be removed again.
 */
export class ClaudeConfig {
  constructor(
    private readonly file: string,
    private readonly cliPath: string
  ) {}

  private async dirs(): Promise<string[]> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as string[]
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }

  private async save(dirs: string[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(dirs, null, 2) + '\n')
  }

  async list(): Promise<ClaudeDirStatus[]> {
    return Promise.all(
      (await this.dirs()).map(async (path) => {
        try {
          return { path, installed: await isInstalled(path) }
        } catch (err) {
          return { path, installed: false, error: (err as Error).message }
        }
      })
    )
  }

  async add(path: string): Promise<void> {
    const dir = resolve(path)
    const dirs = await this.dirs()
    if (!dirs.includes(dir)) await this.save([...dirs, dir])
  }

  /** Unregistering removes our hooks from that directory first. */
  async remove(path: string): Promise<void> {
    const dir = resolve(path)
    await uninstallHooks(dir).catch(() => undefined)
    await this.save((await this.dirs()).filter((d) => d !== dir))
  }

  async install(path: string): Promise<void> {
    await this.assertRegistered(path)
    await installHooks(resolve(path), this.cliPath)
  }

  async uninstall(path: string): Promise<void> {
    await this.assertRegistered(path)
    await uninstallHooks(resolve(path))
  }

  private async assertRegistered(path: string): Promise<void> {
    if (!(await this.dirs()).includes(resolve(path))) throw new Error(`${path} is not a registered Claude config directory`)
  }
}
