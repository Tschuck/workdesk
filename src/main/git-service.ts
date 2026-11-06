import { execFile } from 'node:child_process'
import { relative, resolve } from 'node:path'
import { promisify } from 'node:util'

import { parseStatus, type GitEntry } from './domain/git-status'
import type { FilesService } from './files'

const run = promisify(execFile)

/** The file at HEAD, for the diff view. */
export interface HeadFile {
  /** false for a file that is new (not in HEAD): the diff is against nothing */
  exists: boolean
  content: string
  /** binary or too large to show */
  refused?: boolean
}

const MAX_HEAD_BYTES = 2 * 1024 * 1024

/** git's own words for a failed command: what it printed on stderr (and stdout, where "nothing to commit" is). */
export function gitMessage(err: unknown): string {
  const e = err as { stderr?: string; stdout?: string; message?: string }
  const text = [e.stderr, e.stdout].map((s) => (s ?? '').trim()).filter(Boolean).join('\n')
  return text || e.message || 'git failed'
}

/**
 * Git for the Branch folders of a WorkDesk's File panes: status, the file at HEAD, stage, unstage and commit.
 * Commits go through the user's own git configuration (signing, hooks, identity) exactly as a commit in a terminal would;
 * nothing here pushes, forces or turns signing off.
 */
export class GitService {
  constructor(private readonly files: Pick<FilesService, 'resolveInside'>) {}

  /** the Branch folder (a git root of the WorkDesk), not a scratch or notes folder */
  private repo(deskId: string, rootPath: string): string {
    const { abs, root } = this.files.resolveInside(deskId, rootPath)
    if (root.scratch || root.plain) throw new Error('That folder is not a git folder')
    return abs
  }

  /** `--work-tree=.`: in a bare clone with extensions.worktreeConfig git takes a linked Branch folder for bare and refuses (see FilesService.list) */
  private async git(repo: string, args: string[], opts: { timeout?: number; maxBuffer?: number } = {}): Promise<string> {
    try {
      const { stdout } = await run('git', ['-C', repo, '--work-tree=.', ...args], { maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024, timeout: opts.timeout })
      return stdout
    } catch (err) {
      throw new Error(gitMessage(err))
    }
  }

  async status(deskId: string, rootPath: string): Promise<GitEntry[]> {
    const repo = this.repo(deskId, rootPath)
    return parseStatus(await this.git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all']))
  }

  /** the file as HEAD has it (the branch's last commit) */
  async head(deskId: string, rootPath: string, path: string): Promise<HeadFile> {
    const repo = this.repo(deskId, rootPath)
    const rel = this.relative(deskId, repo, path)
    let size: number
    try {
      size = Number((await this.git(repo, ['cat-file', '-s', `HEAD:${rel}`])).trim())
    } catch {
      return { exists: false, content: '' }
    }
    if (size > MAX_HEAD_BYTES) return { exists: true, content: '', refused: true }
    const content = await this.git(repo, ['show', `HEAD:${rel}`], { maxBuffer: MAX_HEAD_BYTES * 2 })
    return { exists: true, content, refused: content.includes('\0') || undefined }
  }

  /** a path inside the folder, relative to it, `/`-separated */
  private relative(deskId: string, repo: string, path: string): string {
    const abs = this.files.resolveInside(deskId, path).abs
    const rel = relative(resolve(repo), abs)
    if (!rel || rel.startsWith('..')) throw new Error('That file is not in this git folder')
    return rel.split('\\').join('/')
  }

  private rels(deskId: string, repo: string, paths: string[]): string[] {
    if (paths.length === 0) throw new Error('No files to change')
    return paths.map((p) => this.relative(deskId, repo, p.startsWith('/') ? p : resolve(repo, p)))
  }

  /** `git add` for these files (relative or absolute), deletions and renames included */
  async stage(deskId: string, rootPath: string, paths: string[]): Promise<void> {
    const repo = this.repo(deskId, rootPath)
    await this.git(repo, ['add', '-A', '--', ...this.rels(deskId, repo, paths)])
  }

  /** takes the files out of the index; the files themselves are not touched */
  async unstage(deskId: string, rootPath: string, paths: string[]): Promise<void> {
    const repo = this.repo(deskId, rootPath)
    await this.git(repo, ['reset', '-q', '--', ...this.rels(deskId, repo, paths)])
  }

  /**
   * `git commit -m`: with the user's configuration as it is. If signing is on and fails (a locked gpg-agent), git's error comes back
   * as the error of this call, and nothing is committed. Returns git's first line ("[branch abc123] message").
   */
  async commit(deskId: string, rootPath: string, message: string): Promise<string> {
    const repo = this.repo(deskId, rootPath)
    if (!message.trim()) throw new Error('A commit needs a message')
    // a pinentry prompt may wait for the user: give it time, but not forever
    const out = await this.git(repo, ['commit', '-m', message], { timeout: 180_000 })
    return out.split('\n').find((l) => l.trim()) ?? 'Committed'
  }
}
