import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { parseTsc, type Problem } from './domain/diagnostics'
import type { FilesService } from './files'

const run = promisify(execFile)

export interface Diagnostics {
  problems: Problem[]
  /** why there is nothing to report (no tsconfig, TypeScript not installed in the folder) */
  message?: string
}

/**
 * TypeScript problems of a Branch folder, from the project's own `tsc --noEmit` (its tsconfig.json and its installed TypeScript).
 * Run on request only: a full type check takes seconds to minutes. ESLint is not run: it needs the project's config and plugins.
 */
export class DiagnosticsService {
  private running = new Map<string, Promise<Diagnostics>>()
  constructor(private readonly files: Pick<FilesService, 'resolveInside'>) {}

  check(deskId: string, rootPath: string): Promise<Diagnostics> {
    const { abs, root } = this.files.resolveInside(deskId, rootPath)
    if (root.scratch || root.plain) throw new Error('That folder is not a git folder')
    const dir = resolve(abs)
    const busy = this.running.get(dir)
    if (busy) return busy
    const job = this.go(dir).finally(() => this.running.delete(dir))
    this.running.set(dir, job)
    return job
  }

  private async go(dir: string): Promise<Diagnostics> {
    if (!existsSync(join(dir, 'tsconfig.json'))) return { problems: [], message: 'No tsconfig.json in this folder.' }
    const tsc = join(dir, 'node_modules', '.bin', 'tsc')
    if (!existsSync(tsc)) return { problems: [], message: 'TypeScript is not installed in this folder (no node_modules/.bin/tsc).' }
    try {
      await run(tsc, ['--noEmit', '--pretty', 'false'], { cwd: dir, maxBuffer: 64 * 1024 * 1024, timeout: 300_000 })
      return { problems: [] }
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; killed?: boolean; message?: string }
      if (e.killed) return { problems: [], message: 'The type check took too long and was stopped.' }
      const problems = parseTsc(e.stdout ?? '')
      // exit code 2 with errors is the normal "there are problems"; anything else is tsc failing to run
      if (problems.length === 0) return { problems, message: (e.stderr || e.stdout || e.message || 'tsc failed').trim().split('\n')[0] }
      return { problems }
    }
  }
}
