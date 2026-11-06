import { execFile } from 'node:child_process'
import { copyFile, mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

import { GLOBAL_DESK } from './domain/file-tabs'
import { applyReplacements, findWordMatches, isIdentifier, wordLinePattern, type Edit } from './domain/symbols'

const run = promisify(execFile)

/** A folder whose files can be opened: a Branch of the WorkDesk, or its scratch folder. */
export interface FileRoot {
  label: string
  path: string
  /** the WorkDesk's scratch folder: not a git folder, files are created here */
  scratch?: boolean
  /** not a git folder (the notes): its files are all the files in it */
  plain?: boolean
  /** inside the Status Repo: a change is told to its auto-commit */
  status?: boolean
}

export { GLOBAL_DESK }

export interface FileContent {
  content: string
  size: number
  /** the file is not text (or too large): it is not shown */
  refused?: 'binary' | 'large'
}

export interface SearchQuery {
  text: string
  regex: boolean
  caseSensitive: boolean
  /** files to look in: globs separated by commas; `!` in front leaves files out. A glob without `/` matches in every folder. */
  glob: string
}

export interface SearchHit {
  /** relative to the root */
  path: string
  line: number
  text: string
}

/** One place a name is used (text based: every whole-word match, whatever it means). */
export interface UsageMatch {
  line: number
  /** UTF-16 offset in the line, from 0 */
  column: number
  length: number
  /** the line (cut at 400 characters) */
  text: string
  /** in a comment or a string, as far as the guess goes */
  nonCode: boolean
}

export interface UsageFile {
  /** relative to the root */
  path: string
  matches: UsageMatch[]
}

export interface UsageResult {
  files: UsageFile[]
  /** the search stopped at its limits: there are more */
  truncated: boolean
}

export interface RenameRequest {
  /** the folders the rename may touch (the branch scope); a file outside them is refused */
  roots: string[]
  from: string
  to: string
  files: { path: string; edits: Edit[] }[]
}

export interface RenameResult {
  files: { path: string; applied: number; stale: number; error?: string }[]
}

export const MAX_FILE_BYTES = 2 * 1024 * 1024
/** the largest PDF opened in the file pane */
const MAX_BINARY_BYTES = 100 * 1024 * 1024
export const MAX_HITS = 500
const MAX_USAGE_FILES = 300
const SKIP_DIRS = new Set(['.git', 'node_modules'])

/** Globs as git pathspecs: `*.ts` means that file anywhere, `!dist/**` leaves files out. */
export function globPathspecs(glob: string): string[] {
  return glob
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
    .map((g) => {
      const exclude = g.startsWith('!')
      const body = exclude ? g.slice(1).trim() : g
      const anywhere = body.includes('/') ? body.replace(/^\//, '') : `**/${body}`
      return `:(${exclude ? 'exclude,' : ''}glob)${anywhere}`
    })
}

/** Does the file name match the glob (for scratch files, which are not in git)? Same rules as `globPathspecs`. */
export function globMatches(glob: string, path: string): boolean {
  const re = (g: string): RegExp => {
    const body = g.includes('/') ? g.replace(/^\//, '') : `**/${g}`
    const src = body
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '\u0001')
      .replace(/\*\*/g, '\u0002')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/\u0001/g, '(?:.*/)?')
      .replace(/\u0002/g, '.*')
    return new RegExp(`^${src}$`)
  }
  const parts = glob.split(',').map((g) => g.trim()).filter(Boolean)
  const includes = parts.filter((g) => !g.startsWith('!'))
  const excludes = parts.filter((g) => g.startsWith('!')).map((g) => g.slice(1).trim())
  return (includes.length === 0 || includes.some((g) => re(g).test(path))) && !excludes.some((g) => re(g).test(path))
}

/** Files and search of a WorkDesk's folders. Every path that comes in must lie inside one of the WorkDesk's roots. */
export class FilesService {
  constructor(
    private readonly rootsOf: (deskId: string) => FileRoot[],
    private readonly scratchDir: (deskId: string) => string,
    /** how a file is removed; the app moves it to the Trash, so it can be got back */
    private readonly trash: (abs: string) => Promise<void> = (abs) => rm(abs, { force: true }),
    /** the WorkDesk's notes folder (a link into the Status Repo), listed after the Branches */
    private readonly notesDir?: (deskId: string) => string,
    /** folders every WorkDesk's File pane and the Files page share (knowledge, Todo notes) and the global scratch folder, all in the Status Repo of the Profile in view */
    private readonly shared?: { roots: () => FileRoot[]; scratch: () => string },
    /** told when a file in the Status Repo was changed */
    private readonly onWrite: () => void = () => undefined
  ) {}

  roots(deskId: string): FileRoot[] {
    const shared = (this.shared?.roots() ?? []).map((r) => ({ ...r, plain: true, status: true }))
    if (deskId === GLOBAL_DESK) return this.shared ? [...shared, { label: 'scratch', path: this.shared.scratch(), scratch: true, status: true }] : []
    return [
      ...this.rootsOf(deskId),
      ...(this.notesDir ? [{ label: 'notes', path: this.notesDir(deskId), plain: true, status: true }] : []),
      { label: 'scratch', path: this.scratchDir(deskId), scratch: true },
      ...shared,
      ...(this.shared ? [{ label: 'global scratch', path: this.shared.scratch(), scratch: true, status: true }] : [])
    ]
  }

  private touched(root: FileRoot): void {
    if (root.status) this.onWrite()
  }

  /** a change at these paths: told when one is in the Status Repo */
  private touchedPaths(deskId: string, ...paths: string[]): void {
    for (const p of paths) {
      try {
        this.touched(this.resolveInside(deskId, p).root)
      } catch {
        // not a path of this WorkDesk: nothing to tell
      }
    }
  }

  /** The absolute path, when it lies inside a root of the WorkDesk; an error otherwise. */
  resolveInside(deskId: string, path: string): { abs: string; root: FileRoot } {
    const abs = resolve(path)
    const root = this.roots(deskId).find((r) => abs === resolve(r.path) || abs.startsWith(resolve(r.path) + sep))
    if (!root) throw new Error('That file is not in a folder of this WorkDesk')
    return { abs, root }
  }

  /** The files of a root, relative to it: git's (tracked and not ignored) or, for scratch, every file. */
  async list(deskId: string, rootPath: string): Promise<string[]> {
    const { abs, root } = this.resolveInside(deskId, rootPath)
    if (root.scratch) {
      await mkdir(abs, { recursive: true })
      return (await walk(abs, abs)).sort()
    }
    if (root.plain) return (await stat(abs).catch(() => undefined))?.isDirectory() ? (await walk(abs, abs)).sort() : []
    // a Branch folder that is gone (deleted by hand) has no files
    if (!(await stat(abs).catch(() => undefined))?.isDirectory()) return []
    // --work-tree=.: in a bare clone with extensions.worktreeConfig git takes core.bare = true for a linked Branch folder and refuses to list its files
    const { stdout } = await run('git', ['-C', abs, '--work-tree=.', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { maxBuffer: 256 * 1024 * 1024 })
    return stdout.split('\0').filter(Boolean).sort()
  }

  /** The folders of a scratch or plain (not git) root that hold no file at all, relative to it: git cannot list them, the tree shows them. */
  async emptyFolders(deskId: string, rootPath: string): Promise<string[]> {
    const { abs, root } = this.resolveInside(deskId, rootPath)
    if (!root.scratch && !root.plain) return []
    if (!(await stat(abs).catch(() => undefined))?.isDirectory()) return []
    return (await emptyDirs(abs, abs)).sort()
  }

  /** A new folder (missing parents are made) in a scratch or plain root: scratch, notes, knowledge; returns its path. */
  async makeFolder(deskId: string, dir: string, name: string): Promise<string> {
    const { abs, root } = this.resolveInside(deskId, dir)
    if (!root.scratch && !root.plain) throw new Error('Folders are made in scratch, notes and knowledge, not in a Branch folder (git does not keep empty folders)')
    const clean = name.trim().replace(/^\/+|\/+$/g, '')
    if (!clean || clean.split('/').some((p) => !p || p === '.' || p === '..')) throw new Error('That is not a folder name')
    const to = this.resolveInside(deskId, join(abs, clean)).abs
    if (await stat(to).catch(() => undefined)) throw new Error(`There is a file or folder called ${clean} already`)
    await mkdir(to, { recursive: true })
    this.touchedPaths(deskId, to)
    return to
  }

  /** A file into a folder of a root (made when it is not there yet, e.g. `knowledge/payments`): the same name; returns its new path. */
  async moveInto(deskId: string, path: string, rootPath: string, folder: string): Promise<string> {
    const { abs: rootAbs, root } = this.resolveInside(deskId, rootPath)
    if (!root.scratch && !root.plain) throw new Error('Files are moved into scratch, notes and knowledge, not into a Branch folder')
    const clean = folder.trim().replace(/^\/+|\/+$/g, '')
    if (clean.split('/').some((p) => p === '.' || p === '..' || (clean !== '' && !p))) throw new Error('That is not a folder name')
    const dir = this.resolveInside(deskId, join(rootAbs, clean)).abs
    await mkdir(dir, { recursive: true })
    return this.move(deskId, path, dir)
  }

  async read(deskId: string, path: string): Promise<FileContent> {
    const { abs } = this.resolveInside(deskId, path)
    const size = (await stat(abs)).size
    if (size > MAX_FILE_BYTES) return { content: '', size, refused: 'large' }
    const handle = await open(abs, 'r')
    try {
      const head = Buffer.alloc(Math.min(size, 8000))
      await handle.read(head, 0, head.length, 0)
      if (head.includes(0)) return { content: '', size, refused: 'binary' }
    } finally {
      await handle.close()
    }
    return { content: await readFile(abs, 'utf8'), size }
  }

  /** The bytes of a file that is not text (a PDF): the viewer shows them. Not above `MAX_BINARY_BYTES`. */
  async readBinary(deskId: string, path: string): Promise<Uint8Array> {
    const { abs } = this.resolveInside(deskId, path)
    const size = (await stat(abs)).size
    if (size > MAX_BINARY_BYTES) throw new Error(`This file is too large to open here (${Math.round(size / 1024 / 1024)} MB)`)
    return new Uint8Array(await readFile(abs))
  }

  async write(deskId: string, path: string, content: string): Promise<void> {
    const { abs, root } = this.resolveInside(deskId, path)
    await writeFile(abs, content, 'utf8')
    this.touched(root)
  }

  /** A new, empty scratch file named `untitled-N.md`; returns its path. */
  async newScratch(deskId: string): Promise<string> {
    const dir = deskId === GLOBAL_DESK && this.shared ? this.shared.scratch() : this.scratchDir(deskId)
    await mkdir(dir, { recursive: true })
    const taken = new Set(await readdir(dir))
    let n = 1
    while (taken.has(`untitled-${n}.md`)) n++
    const path = join(dir, `untitled-${n}.md`)
    await writeFile(path, '', { flag: 'wx' })
    this.touchedPaths(deskId, path)
    return path
  }

  /** a file inside a root, not the root itself */
  private file(deskId: string, path: string): string {
    const { abs, root } = this.resolveInside(deskId, path)
    if (abs === resolve(root.path)) throw new Error('That is a folder of the WorkDesk itself')
    return abs
  }

  /** `name copy.ext`, `name copy 2.ext`, … next to the file; returns the new path. */
  async duplicate(deskId: string, path: string): Promise<string> {
    const abs = this.file(deskId, path)
    const dir = dirname(abs)
    const ext = extname(abs)
    const base = basename(abs, ext)
    const taken = new Set(await readdir(dir))
    let name = `${base} copy${ext}`
    for (let n = 2; taken.has(name); n++) name = `${base} copy ${n}${ext}`
    await copyFile(abs, join(dir, name), 1 /* COPYFILE_EXCL */)
    this.touchedPaths(deskId, abs)
    return join(dir, name)
  }

  /** Another name for a file in the same folder (a name, not a path); returns the new path. */
  async rename(deskId: string, path: string, name: string): Promise<string> {
    const abs = this.file(deskId, path)
    const clean = name.trim()
    if (!clean || clean === '.' || clean === '..' || /[\\/]/.test(clean)) throw new Error('A file name has no slash and is not empty')
    const to = join(dirname(abs), clean)
    if (to === abs) return abs
    if (await stat(to).catch(() => undefined)) throw new Error(`There is a file called ${clean} already`)
    await rename(abs, to)
    this.touchedPaths(deskId, abs)
    return to
  }

  /** Takes a file out of the folder (to the Trash in the app). */
  async remove(deskId: string, path: string): Promise<void> {
    const abs = this.file(deskId, path)
    await this.trash(abs)
    this.touchedPaths(deskId, abs)
  }

  /** Takes a folder with everything in it out of scratch, notes or knowledge (to the Trash in the app); never a Branch folder or a root itself. */
  async removeFolder(deskId: string, path: string): Promise<void> {
    const abs = this.file(deskId, path)
    const { root } = this.resolveInside(deskId, path)
    if (!root.scratch && !root.plain) throw new Error('A folder of a Branch is not removed here: git and its worktree own it')
    if (!(await stat(abs).catch(() => undefined))?.isDirectory()) throw new Error('That folder is not there')
    await this.trash(abs)
    this.touchedPaths(deskId, abs)
  }

  /** A file into another folder of the WorkDesk's roots (the same name); returns its new path. */
  async move(deskId: string, path: string, destDir: string): Promise<string> {
    const abs = this.file(deskId, path)
    const dir = this.resolveInside(deskId, destDir).abs
    if (!(await stat(dir).catch(() => undefined))?.isDirectory()) throw new Error('That folder is not there')
    const to = join(dir, basename(abs))
    if (to === abs) return abs
    if (await stat(to).catch(() => undefined)) throw new Error(`There is a file called ${basename(abs)} there already`)
    try {
      await rename(abs, to)
    } catch (err) {
      // another disk: copy, then remove
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
      await copyFile(abs, to, 1)
      await rm(abs)
    }
    this.touchedPaths(deskId, abs, to)
    return to
  }

  /** A new empty file with this name in a folder of a root (missing folders are made); returns its path. */
  async create(deskId: string, dir: string, name: string): Promise<string> {
    const { abs } = this.resolveInside(deskId, dir)
    const clean = name.trim().replace(/^\/+/, '')
    if (!clean || clean.split('/').some((p) => !p || p === '..')) throw new Error('That is not a file name')
    const to = this.resolveInside(deskId, join(abs, clean)).abs
    if (await stat(to).catch(() => undefined)) throw new Error(`There is a file called ${clean} already`)
    await mkdir(dirname(to), { recursive: true })
    await writeFile(to, '', { flag: 'wx' })
    this.touchedPaths(deskId, to)
    return to
  }

  /** Remove a scratch file that was never written to (a Pane closed on an empty file); other files are never removed. */
  async dropEmptyScratch(deskId: string, path: string): Promise<boolean> {
    const { abs, root } = this.resolveInside(deskId, path)
    if (!root.scratch || (await stat(abs).catch(() => undefined))?.size !== 0) return false
    await rm(abs, { force: true })
    return true
  }

  async search(deskId: string, rootPath: string, q: SearchQuery): Promise<SearchHit[]> {
    const { abs, root } = this.resolveInside(deskId, rootPath)
    if (!q.text) return []
    // a folder that is not there (a scratch folder before the first scratch file) has nothing to find
    if (!(await stat(abs).catch(() => undefined))?.isDirectory()) return []
    if (root.scratch || root.plain) return searchFiles(abs, q)
    const args = ['-C', abs, '--work-tree=.', 'grep', '-n', '-I', '--null', '--untracked', q.regex ? '-E' : '-F']
    if (!q.caseSensitive) args.push('-i')
    args.push('-e', q.text, '--', ...globPathspecs(q.glob))
    try {
      const { stdout } = await run('git', args, { maxBuffer: 64 * 1024 * 1024 })
      return parseGrep(stdout)
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string }
      // 1: nothing found; anything else is a bad pattern or glob, which the user should see
      if (e.code === 1) return []
      throw new Error((e.stderr ?? '').split('\n')[0] || 'The search failed')
    }
  }

  /** Every whole-word match of a name in the files of a root (the grep finds the lines, the files are read for the exact matches). */
  async usages(deskId: string, rootPath: string, word: string, glob: string): Promise<UsageResult> {
    if (!isIdentifier(word)) throw new Error('That is not a name (letters, digits, _ and $; not starting with a digit)')
    const { abs } = this.resolveInside(deskId, rootPath)
    const hits = await this.search(deskId, rootPath, { text: wordLinePattern(word), regex: true, caseSensitive: true, glob })
    const paths = [...new Set(hits.map((h) => h.path))]
    const files: UsageFile[] = []
    for (const path of paths.slice(0, MAX_USAGE_FILES)) {
      const file = await this.read(deskId, join(abs, path)).catch(() => undefined)
      if (!file || file.refused) continue
      const lines = file.content.split('\n')
      const matches = findWordMatches(file.content, word).map((m): UsageMatch => ({ ...m, text: lines[m.line - 1].replace(/\r$/, '').slice(0, 400) }))
      if (matches.length > 0) files.push({ path, matches })
    }
    return { files, truncated: hits.length >= MAX_HITS || paths.length > MAX_USAGE_FILES }
  }

  /**
   * Writes the new name at the places given, nothing else. Files outside `roots` are refused; a place where the old name is not any more
   * (the file changed since it was searched) is left alone and counted as stale.
   */
  async renameSymbol(deskId: string, req: RenameRequest): Promise<RenameResult> {
    if (!isIdentifier(req.from) || !isIdentifier(req.to)) throw new Error('Both names have to be names (letters, digits, _ and $; not starting with a digit)')
    const roots = await Promise.all(req.roots.map((r) => realpath(resolve(r)).catch(() => resolve(r))))
    const result: RenameResult = { files: [] }
    for (const f of req.files) {
      try {
        const { abs } = this.resolveInside(deskId, f.path)
        // a link that leads out of the folder does not count as inside it
        const real = await realpath(abs)
        if (!roots.some((r) => real.startsWith(r + sep))) throw new Error('That file is outside the folders of the branch scope')
        const file = await this.read(deskId, abs)
        if (file.refused) throw new Error(file.refused === 'binary' ? 'Not a text file' : 'Too large to change here')
        const done = applyReplacements(file.content, req.from, req.to, f.edits)
        if (done.applied > 0) await this.write(deskId, abs, done.text)
        result.files.push({ path: f.path, applied: done.applied, stale: done.stale })
      } catch (e) {
        result.files.push({ path: f.path, applied: 0, stale: 0, error: (e as Error).message })
      }
    }
    return result
  }
}

/** The output of `git grep -n --null`: `path NUL line NUL text`. */
export function parseGrep(out: string): SearchHit[] {
  const hits: SearchHit[] = []
  for (const l of out.split('\n')) {
    if (!l) continue
    const [path, line, ...text] = l.split('\0')
    const n = Number(line)
    if (path && Number.isInteger(n)) hits.push({ path, line: n, text: text.join('\0').slice(0, 300) })
    if (hits.length >= MAX_HITS) break
  }
  return hits
}

async function walk(dir: string, base: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full, base)))
    else out.push(relative(base, full))
  }
  return out
}

/** The folders below `dir` that hold nothing at all (no file, no folder): what the file list cannot show. A folder with only an empty folder in it shows through that one. */
async function emptyDirs(dir: string, base: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue
    const full = join(dir, e.name)
    const inner = await emptyDirs(full, base)
    if (inner.length > 0) out.push(...inner)
    else if ((await readdir(full)).length === 0) out.push(relative(base, full))
  }
  return out
}

/** Search for the files of a folder that is not in git (the scratch folder). */
async function searchFiles(dir: string, q: SearchQuery): Promise<SearchHit[]> {
  let re: RegExp
  try {
    re = new RegExp(q.regex ? q.text : q.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), q.caseSensitive ? '' : 'i')
  } catch {
    throw new Error('That is not a valid regular expression')
  }
  const hits: SearchHit[] = []
  for (const rel of await walk(dir, dir)) {
    if (!globMatches(q.glob, rel)) continue
    const text = await readFile(join(dir, rel), 'utf8').catch(() => '')
    if (text.includes('\0')) continue
    text.split('\n').forEach((l, i) => {
      if (hits.length < MAX_HITS && re.test(l)) hits.push({ path: rel, line: i + 1, text: l.slice(0, 300) })
    })
  }
  return hits
}

export const fileName = (path: string): string => basename(path)
