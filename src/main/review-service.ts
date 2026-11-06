import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

import {
  BASE_CANDIDATES,
  COMMENTS_DIR,
  EXCLUDE_ENTRY,
  baseChoices,
  parseComments,
  parseNameStatus,
  parseNotes,
  parseUntracked,
  serializeComments,
  serializeNotes,
  withExcludeEntry,
  type ReviewComment,
  type ReviewEntry,
  type ReviewNote
} from './domain/local-review'
import { makePreset, parseStoredPresets, presetsFor, withoutPreset, withPreset, type ReviewPreset } from './domain/review-presets'
import type { FilesService } from './files'
import { gitMessage, type HeadFile } from './git-service'

const run = promisify(execFile)

/** Review of one Branch folder against a base branch: what changed since the merge base, and the comments on it. */
export interface ReviewState {
  base?: string
  mergeBase?: string
  entries: ReviewEntry[]
  comments: ReviewComment[]
  /** comments on the review as a whole */
  notes: ReviewNote[]
  /** why there is nothing to show (no base picked, no changes, cannot compare) */
  message?: string
}

/** Where the base branch picked for a folder is kept. */
export interface BaseStore {
  get(key: string): string | undefined
  set(key: string, base: string): void
}

export class FileBaseStore implements BaseStore {
  constructor(private readonly file: string) {}
  private read(): Record<string, string> {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>
    } catch {
      return {}
    }
  }
  get(key: string): string | undefined {
    return this.read()[key]
  }
  set(key: string, base: string): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify({ ...this.read(), [key]: base }, null, 2))
  }
}

/** Where the Review presets made for this machine are kept. */
export interface PresetStore {
  read(): ReviewPreset[]
  write(presets: ReviewPreset[]): void
}

export class FilePresetStore implements PresetStore {
  constructor(private readonly file: string) {}
  read(): ReviewPreset[] {
    try {
      return parseStoredPresets(readFileSync(this.file, 'utf8'))
    } catch {
      return []
    }
  }
  write(presets: ReviewPreset[]): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(presets, null, 2))
  }
}

class MemoryPresets implements PresetStore {
  private list: ReviewPreset[] = []
  read = (): ReviewPreset[] => this.list
  write = (presets: ReviewPreset[]): void => void (this.list = presets)
}

const MAX_BYTES = 2 * 1024 * 1024

/**
 * The review mode of the File pane. Comments are stored the way the "Local Review" VS Code extension stores them
 * (`.review/comments.json` at the checkout's root, `/.review/` in info/exclude of the repository),
 * so both tools see the same comments. Read-only towards git: no network, nothing is pushed or changed in the repository
 * except the line in info/exclude.
 */
export class ReviewService {
  constructor(
    private readonly files: Pick<FilesService, 'resolveInside'>,
    private readonly bases: BaseStore,
    private readonly presetStore: PresetStore = new MemoryPresets()
  ) {}

  /** The Review presets a WorkDesk is offered: the built-in ones and what was made for it. */
  presets(deskId: string): ReviewPreset[] {
    return presetsFor(this.presetStore.read(), deskId)
  }

  /** Make (or replace) a preset for a WorkDesk. */
  savePreset(deskId: string, raw: Parameters<typeof makePreset>[0]): ReviewPreset {
    const preset = makePreset({ ...raw, deskId })
    this.presetStore.write(withPreset(this.presetStore.read(), preset))
    return preset
  }

  removePreset(deskId: string, id: string): void {
    if (!this.presets(deskId).some((p) => p.id === id && !p.builtin)) throw new Error('That preset is built in or gone')
    this.presetStore.write(withoutPreset(this.presetStore.read(), id, deskId))
  }

  private repo(deskId: string, rootPath: string): string {
    const { abs, root } = this.files.resolveInside(deskId, rootPath)
    if (root.scratch || root.plain) throw new Error('That folder is not a git folder')
    return resolve(abs)
  }

  private async git(repo: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await run('git', ['-C', repo, '--work-tree=.', ...args], {
        maxBuffer: 64 * 1024 * 1024,
        // read-only commands must not rewrite the index
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
      })
      return stdout
    } catch (err) {
      throw new Error(gitMessage(err))
    }
  }

  private key = (deskId: string, repo: string): string => `${deskId}|${repo}`

  private async defaultBase(repo: string): Promise<string | undefined> {
    try {
      const head = (await this.git(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim()
      if (head) return head
    } catch {
      // no origin/HEAD
    }
    for (const c of BASE_CANDIDATES) {
      try {
        await this.git(repo, ['rev-parse', '--verify', '--quiet', `${c}^{commit}`])
        return c
      } catch {
        // not there
      }
    }
    return undefined
  }

  private async baseOf(deskId: string, repo: string): Promise<string | undefined> {
    return this.bases.get(this.key(deskId, repo)) ?? (await this.defaultBase(repo))
  }

  private paths(repo: string): { json: string; notes: string } {
    return { json: join(repo, COMMENTS_DIR, 'comments.json'), notes: join(repo, COMMENTS_DIR, 'notes.json') }
  }

  private loadNotes(repo: string): ReviewNote[] {
    try {
      return parseNotes(readFileSync(this.paths(repo).notes, 'utf8'))
    } catch {
      return []
    }
  }

  private async persistNotes(repo: string, notes: ReviewNote[]): Promise<void> {
    await this.ensureDir(repo)
    writeFileSync(this.paths(repo).notes, serializeNotes(notes))
  }

  async addNote(deskId: string, rootPath: string, text: string): Promise<ReviewNote> {
    const repo = this.repo(deskId, rootPath)
    const clean = text.trim()
    if (!clean) throw new Error('A comment needs a text')
    const note = { id: randomUUID(), text: clean }
    await this.persistNotes(repo, [...this.loadNotes(repo), note])
    return note
  }

  async updateNote(deskId: string, rootPath: string, id: string, text: string): Promise<void> {
    const repo = this.repo(deskId, rootPath)
    const clean = text.trim()
    if (!clean) throw new Error('A comment needs a text')
    const all = this.loadNotes(repo)
    if (!all.some((n) => n.id === id)) throw new Error('That comment is gone')
    await this.persistNotes(repo, all.map((n) => (n.id === id ? { ...n, text: clean } : n)))
  }

  async removeNote(deskId: string, rootPath: string, id: string): Promise<void> {
    const repo = this.repo(deskId, rootPath)
    await this.persistNotes(repo, this.loadNotes(repo).filter((n) => n.id !== id))
  }

  private loadComments(repo: string): ReviewComment[] {
    try {
      return parseComments(readFileSync(this.paths(repo).json, 'utf8'))
    } catch {
      return []
    }
  }

  /** `.review/` is made and listed in the repository's info/exclude, which all of its worktrees share */
  private async ensureDir(repo: string): Promise<void> {
    mkdirSync(join(repo, COMMENTS_DIR), { recursive: true })
    const common = (await this.git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()
    const exclude = join(common, 'info', 'exclude')
    const content = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
    const updated = withExcludeEntry(content, EXCLUDE_ENTRY)
    if (updated === null) return
    mkdirSync(dirname(exclude), { recursive: true })
    writeFileSync(exclude, updated)
  }

  private async persist(_deskId: string, repo: string, comments: ReviewComment[]): Promise<void> {
    await this.ensureDir(repo)
    writeFileSync(this.paths(repo).json, serializeComments(comments))
  }

  async state(deskId: string, rootPath: string): Promise<ReviewState> {
    const repo = this.repo(deskId, rootPath)
    const base = await this.baseOf(deskId, repo)
    const comments = this.loadComments(repo)
    const notes = this.loadNotes(repo)
    if (!base) return { entries: [], comments, notes, message: 'Select a base branch to start the review.' }
    try {
      const mergeBase = (await this.git(repo, ['merge-base', base, 'HEAD'])).trim()
      const [diff, untracked] = await Promise.all([
        this.git(repo, ['diff', '--name-status', '-z', '-M', mergeBase]),
        this.git(repo, ['ls-files', '--others', '--exclude-standard', '-z'])
      ])
      const entries = [...parseNameStatus(diff), ...parseUntracked(untracked)]
      return { base, mergeBase, entries, comments, notes, message: entries.length ? undefined : `No changes compared to ${base}.` }
    } catch (e) {
      return { base, entries: [], comments, notes, message: `Cannot compare with ${base}: ${(e as Error).message.split('\n')[0]}` }
    }
  }

  /** branches (local and remote-tracking) to pick the base from */
  async branches(deskId: string, rootPath: string): Promise<string[]> {
    const repo = this.repo(deskId, rootPath)
    return baseChoices(await this.git(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']))
  }

  /** the newest commits of the folder's Branch (hash and title), to pick one as the base: the review then shows what changed since it */
  async commits(deskId: string, rootPath: string, limit = 40): Promise<{ sha: string; title: string }[]> {
    const repo = this.repo(deskId, rootPath)
    const out = await this.git(repo, ['log', `-n${Math.max(1, Math.min(limit, 200))}`, '--format=%H%x09%s', 'HEAD']).catch(() => '')
    return out.split('\n').filter(Boolean).map((l) => {
      const [sha, ...title] = l.split('\t')
      return { sha, title: title.join('\t') }
    })
  }

  async setBase(deskId: string, rootPath: string, base: string): Promise<void> {
    const repo = this.repo(deskId, rootPath)
    const name = base.trim()
    if (!name || name.startsWith('-')) throw new Error('That is not a branch name')
    await this.git(repo, ['rev-parse', '--verify', '--quiet', `${name}^{commit}`]).catch(() => {
      throw new Error(`There is no branch ${name}`)
    })
    this.bases.set(this.key(deskId, repo), name)
  }

  /** a file as it was at the merge base (`path` relative to the folder or absolute) */
  async baseFile(deskId: string, rootPath: string, path: string): Promise<HeadFile> {
    const repo = this.repo(deskId, rootPath)
    const { mergeBase } = await this.state(deskId, rootPath)
    const rel = relative(repo, resolve(repo, path)).split('\\').join('/')
    if (!mergeBase || !rel || rel.startsWith('..')) return { exists: false, content: '' }
    try {
      const size = Number((await this.git(repo, ['cat-file', '-s', `${mergeBase}:${rel}`])).trim())
      if (size > MAX_BYTES) return { exists: true, content: '', refused: true }
      const content = await this.git(repo, ['show', `${mergeBase}:${rel}`])
      return { exists: true, content, refused: content.includes('\0') || undefined }
    } catch {
      return { exists: false, content: '' }
    }
  }

  async addComment(deskId: string, rootPath: string, path: string, line: number, text: string): Promise<ReviewComment> {
    const repo = this.repo(deskId, rootPath)
    const clean = text.trim()
    if (!clean) throw new Error('A comment needs a text')
    if (!Number.isInteger(line) || line < 1) throw new Error('That is not a line')
    const rel = relative(repo, resolve(repo, path)).split('\\').join('/')
    if (!rel || rel.startsWith('..')) throw new Error('That file is not in this git folder')
    const comment: ReviewComment = { id: randomUUID(), path: rel, line, text: clean }
    await this.persist(deskId, repo, [...this.loadComments(repo), comment])
    return comment
  }

  async updateComment(deskId: string, rootPath: string, id: string, text: string): Promise<void> {
    const repo = this.repo(deskId, rootPath)
    const clean = text.trim()
    if (!clean) throw new Error('A comment needs a text')
    const all = this.loadComments(repo)
    if (!all.some((c) => c.id === id)) throw new Error('That comment is gone')
    await this.persist(deskId, repo, all.map((c) => (c.id === id ? { ...c, text: clean } : c)))
  }

  async removeComment(deskId: string, rootPath: string, id: string): Promise<void> {
    const repo = this.repo(deskId, rootPath)
    await this.persist(deskId, repo, this.loadComments(repo).filter((c) => c.id !== id))
  }

  async clearComments(deskId: string, rootPath: string): Promise<void> {
    const repo = this.repo(deskId, rootPath)
    if (this.loadNotes(repo).length > 0) await this.persistNotes(repo, [])
    if (this.loadComments(repo).length === 0) return
    await this.persist(deskId, repo, [])
  }
}
