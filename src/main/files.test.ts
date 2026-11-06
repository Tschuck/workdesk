import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FilesService, GLOBAL_DESK, globMatches, globPathspecs, parseGrep } from './files'

describe('globs', () => {
  it('make pathspecs: a bare name matches anywhere, a path from the root, ! leaves files out', () => {
    expect(globPathspecs('*.ts, src/**/*.tsx ,!dist/**')).toEqual([':(glob)**/*.ts', ':(glob)src/**/*.tsx', ':(exclude,glob)dist/**'])
    expect(globPathspecs('  ')).toEqual([])
  })
  it('match paths the same way for folders that are not in git', () => {
    expect(globMatches('*.md', 'a.md')).toBe(true)
    expect(globMatches('*.md', 'sub/dir/a.md')).toBe(true)
    expect(globMatches('src/*.md', 'src/a.md')).toBe(true)
    expect(globMatches('src/*.md', 'src/deep/a.md')).toBe(false)
    expect(globMatches('src/**/*.md', 'src/deep/a.md')).toBe(true)
    expect(globMatches('*.md,!draft*', 'draft.md')).toBe(false)
    expect(globMatches('', 'anything')).toBe(true)
  })
})

describe('git grep output', () => {
  it('is path, line and text, cut off at the limit', () => {
    expect(parseGrep('a.txt\x001\x00hello\nsub/b.md\x0012\x00x:y\n')).toEqual([{ path: 'a.txt', line: 1, text: 'hello' }, { path: 'sub/b.md', line: 12, text: 'x:y' }])
    expect(parseGrep('\nnonsense\n')).toEqual([])
  })
})

describe('files of a WorkDesk', () => {
  let dir: string
  let repo: string
  let scratch: string
  let svc: FilesService
  const git = (...a: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.email=a@b', '-c', 'user.name=n', ...a], { stdio: 'ignore' })

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'workdesk-files-'))
    repo = join(dir, 'repo')
    scratch = join(dir, 'scratch')
    await mkdir(join(repo, 'sub'), { recursive: true })
    git('init', '-q')
    await writeFile(join(repo, 'a.txt'), 'hello World\nfoo bar\nHELLO again\n')
    await writeFile(join(repo, 'sub', 'b.md'), 'hello sub\n')
    await writeFile(join(repo, '.gitignore'), 'ignored.txt\n')
    git('add', '.')
    git('commit', '-qm', 'x')
    await writeFile(join(repo, 'c.txt'), 'untracked hello\n')
    await writeFile(join(repo, 'ignored.txt'), 'hello ignored\n')
    svc = new FilesService(() => [{ label: 'repo', path: repo }], () => scratch)
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('lists tracked and untracked files but not ignored ones', async () => {
    expect(await svc.list('d', repo)).toEqual(['.gitignore', 'a.txt', 'c.txt', 'sub/b.md'])
  })

  it('searches text, regex and case, with globs, in tracked and untracked files', async () => {
    const q = { text: 'hello', regex: false, caseSensitive: false, glob: '' }
    expect((await svc.search('d', repo, q)).map((h) => `${h.path}:${h.line}`)).toEqual(['a.txt:1', 'a.txt:3', 'c.txt:1', 'sub/b.md:1'])
    expect((await svc.search('d', repo, { ...q, caseSensitive: true })).map((h) => `${h.path}:${h.line}`)).toEqual(['a.txt:1', 'c.txt:1', 'sub/b.md:1'])
    expect((await svc.search('d', repo, { ...q, text: 'hel+o s', regex: true })).map((h) => h.path)).toEqual(['sub/b.md'])
    expect((await svc.search('d', repo, { ...q, glob: '*.md' })).map((h) => h.path)).toEqual(['sub/b.md'])
    expect((await svc.search('d', repo, { ...q, glob: '*.txt,!c.txt' })).map((h) => h.path)).toEqual(['a.txt', 'a.txt'])
    expect(await svc.search('d', repo, { ...q, text: 'nothing like it' })).toEqual([])
    await expect(svc.search('d', repo, { ...q, text: '(', regex: true })).rejects.toThrow()
  })

  it('duplicates, renames, removes and creates files, inside the folders of the WorkDesk only', async () => {
    const trashed: string[] = []
    const ops = new FilesService(() => [{ label: 'repo', path: repo }], () => scratch, async (abs) => void trashed.push(abs))
    const copy = await ops.duplicate('d', join(repo, 'a.txt'))
    expect(copy.endsWith('/a copy.txt')).toBe(true)
    expect(await readFile(copy, 'utf8')).toContain('foo bar')
    expect((await ops.duplicate('d', join(repo, 'a.txt'))).endsWith('/a copy 2.txt')).toBe(true)
    const renamed = await ops.rename('d', copy, 'b.txt')
    expect(renamed.endsWith('/b.txt')).toBe(true)
    await expect(ops.rename('d', renamed, 'a.txt')).rejects.toThrow(/already/)
    await expect(ops.rename('d', renamed, '../x')).rejects.toThrow(/slash/)
    await expect(ops.rename('d', repo, 'x')).rejects.toThrow(/folder of the WorkDesk/)
    await ops.remove('d', renamed)
    expect(trashed).toEqual([renamed])
    const made = await ops.create('d', join(repo, 'sub'), 'deep/new.md')
    expect(made.endsWith('/sub/deep/new.md')).toBe(true)
    await expect(ops.create('d', join(repo, 'sub'), 'deep/new.md')).rejects.toThrow(/already/)
    await expect(ops.create('d', join(repo, 'sub'), '../out.md')).rejects.toThrow()
    await expect(ops.duplicate('d', join(dir, 'outside.txt'))).rejects.toThrow(/not in a folder/)
  })

  it('lists the notes next to scratch, and moves a file from one folder to another', async () => {
    const notes = join(dir, 'notes')
    const both = new FilesService(() => [{ label: 'repo', path: repo }], () => scratch, undefined, () => notes)
    expect(both.roots('d').map((r) => r.label)).toEqual(['repo', 'notes', 'scratch'])
    // no notes folder yet: nothing in it
    expect(await both.list('d', notes)).toEqual([])
    await mkdir(notes)
    await writeFile(join(notes, 'old.md'), 'old note about hello')
    expect(await both.list('d', notes)).toEqual(['old.md'])
    expect((await both.search('d', notes, { text: 'HELLO', regex: false, caseSensitive: false, glob: '' })).map((h) => h.path)).toEqual(['old.md'])
    const draft = await both.newScratch('d')
    await both.write('d', draft, 'to keep')
    const moved = await both.move('d', draft, notes)
    expect(moved).toBe(join(notes, 'untitled-1.md'))
    expect(await readFile(moved, 'utf8')).toBe('to keep')
    expect(await both.list('d', scratch)).toEqual([])
    // the same name there already, a folder that is not there, a folder outside the WorkDesk
    const again = await both.newScratch('d')
    await expect(both.move('d', again, notes)).rejects.toThrow(/already/)
    await expect(both.move('d', again, join(notes, 'nope'))).rejects.toThrow(/not there/)
    await expect(both.move('d', again, dir)).rejects.toThrow(/not in a folder/)
    // within a folder: nothing happens
    expect(await both.move('d', moved, notes)).toBe(moved)
  })

  it('has roots without a WorkDesk (the Status Repo: knowledge and a scratch folder), also offered in every WorkDesk, and tells the Status Repo when a file changed', async () => {
    const knowledge = join(dir, 'status', 'knowledge')
    const sharedScratch = join(dir, 'status', 'scratch')
    await mkdir(knowledge, { recursive: true })
    await writeFile(join(knowledge, 'learned.md'), 'lessons about hello')
    let told = 0
    const g = new FilesService(() => [{ label: 'repo', path: repo }], () => scratch, undefined, undefined, { roots: () => [{ label: 'knowledge', path: knowledge }], scratch: () => sharedScratch }, () => told++)
    expect(g.roots(GLOBAL_DESK).map((r) => r.label)).toEqual(['knowledge', 'scratch'])
    expect(g.roots('d').map((r) => r.label)).toEqual(['repo', 'scratch', 'knowledge', 'global scratch'])
    expect(await g.list(GLOBAL_DESK, knowledge)).toEqual(['learned.md'])
    // the Branch folders are not part of the global ones
    await expect(g.read(GLOBAL_DESK, join(repo, 'a.txt'))).rejects.toThrow(/not in a folder/)
    const note = await g.newScratch(GLOBAL_DESK)
    expect(note).toBe(join(sharedScratch, 'untitled-1.md'))
    expect(told).toBe(1)
    await g.write(GLOBAL_DESK, note, 'kept')
    expect(told).toBe(2)
    // a file of a Branch is not the Status Repo's business
    await g.write('d', join(repo, 'a.txt'), 'x')
    expect(told).toBe(2)
    expect((await g.search('d', knowledge, { text: 'LESSONS', regex: false, caseSensitive: false, glob: '' })).map((h) => h.path)).toEqual(['learned.md'])
  })

  it('makes folders in scratch and knowledge, lists the empty ones, and moves a file into a topic folder of the knowledge', async () => {
    const knowledge = join(dir, 'status', 'knowledge')
    await mkdir(knowledge, { recursive: true })
    let told = 0
    const g = new FilesService(() => [{ label: 'repo', path: repo }], () => scratch, undefined, undefined, { roots: () => [{ label: 'knowledge', path: knowledge }], scratch: () => join(dir, 'status', 'scratch') }, () => told++)
    // a folder (and its parents) in the knowledge, told to the Status Repo
    const made = await g.makeFolder('d', knowledge, 'payments/specs')
    expect(made).toBe(join(knowledge, 'payments', 'specs'))
    expect(told).toBe(1)
    expect(await g.emptyFolders('d', knowledge)).toEqual(['payments/specs'])
    await expect(g.makeFolder('d', knowledge, 'payments/specs')).rejects.toThrow(/already/)
    await expect(g.makeFolder('d', knowledge, '../out')).rejects.toThrow(/not a folder name/)
    // not in a Branch folder: git keeps no empty folders
    await expect(g.makeFolder('d', repo, 'x')).rejects.toThrow(/Branch folder/)
    expect(await g.emptyFolders('d', repo)).toEqual([])
    // a scratch file kept for good: into knowledge/payments, made when missing
    const note = await g.newScratch('d')
    await g.write('d', note, 'requirements document')
    const to = await g.moveInto('d', note, knowledge, 'payments')
    expect(to).toBe(join(knowledge, 'payments', basename(note)))
    expect(await readFile(to, 'utf8')).toBe('requirements document')
    expect(await g.list('d', scratch)).toEqual([])
    // a folder with a file is not empty any more
    await g.moveInto('d', to, knowledge, 'payments/specs')
    expect(await g.emptyFolders('d', knowledge)).toEqual([])
    await expect(g.moveInto('d', join(knowledge, 'payments', 'specs', basename(note)), knowledge, '../x')).rejects.toThrow(/not a folder name/)
    // a folder with everything in it goes to the Trash (not a root, not a Branch folder)
    const gone: string[] = []
    const t = new FilesService(() => [{ label: 'repo', path: repo }], () => scratch, async (abs) => void gone.push(abs), undefined, { roots: () => [{ label: 'knowledge', path: knowledge }], scratch: () => join(dir, 'status', 'scratch') }, () => undefined)
    await t.removeFolder('d', join(knowledge, 'payments'))
    expect(gone).toEqual([join(knowledge, 'payments')])
    await expect(t.removeFolder('d', knowledge)).rejects.toThrow(/folder of the WorkDesk itself/)
    await expect(t.removeFolder('d', join(repo, 'sub'))).rejects.toThrow(/Branch/)
  })

  it('has no files and no hits in a folder that is gone', async () => {
    const gone = new FilesService(() => [{ label: 'gone', path: join(dir, 'gone') }], () => scratch)
    expect(await gone.list('d', join(dir, 'gone'))).toEqual([])
    expect(await gone.search('d', join(dir, 'gone'), { text: 'x', regex: false, caseSensitive: false, glob: '' })).toEqual([])
    // the scratch folder is made with the first scratch file
    expect(await svc.search('d', scratch, { text: 'x', regex: false, caseSensitive: false, glob: '' })).toEqual([])
  })

  it('reads and writes files, and refuses binary and foreign ones', async () => {
    expect((await svc.read('d', join(repo, 'a.txt'))).content).toContain('foo bar')
    await writeFile(join(repo, 'bin.dat'), Buffer.from([1, 0, 2]))
    expect(await svc.read('d', join(repo, 'bin.dat'))).toMatchObject({ refused: 'binary' })
    await svc.write('d', join(repo, 'a.txt'), 'changed')
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('changed')
    await expect(svc.read('d', join(dir, 'outside.txt'))).rejects.toThrow(/not in a folder/)
    await expect(svc.read('d', join(repo, '..', 'outside.txt'))).rejects.toThrow(/not in a folder/)
  })

  it('makes scratch files, finds them, and drops only empty scratch files', async () => {
    const first = await svc.newScratch('d')
    const second = await svc.newScratch('d')
    expect([first, second].map((p) => p.split('/').pop())).toEqual(['untitled-1.md', 'untitled-2.md'])
    await svc.write('d', second, 'notes about hello')
    expect(await svc.list('d', scratch)).toEqual(['untitled-1.md', 'untitled-2.md'])
    expect((await svc.search('d', scratch, { text: 'HELLO', regex: false, caseSensitive: false, glob: '*.md' })).map((h) => h.path)).toEqual(['untitled-2.md'])
    expect(await svc.dropEmptyScratch('d', first)).toBe(true)
    expect(await svc.dropEmptyScratch('d', second)).toBe(false)
    expect(await svc.dropEmptyScratch('d', join(repo, 'a.txt'))).toBe(false)
    expect(await svc.list('d', scratch)).toEqual(['untitled-2.md'])
  })

  it('lists and searches a Branch folder of a bare clone that has worktreeConfig, where git thinks the folder is bare', async () => {
    const bare = join(dir, 'p.git')
    const tree = join(dir, 'tree')
    const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.email=a@b', '-c', 'user.name=n', ...a], { stdio: 'ignore' })
    execFileSync('git', ['clone', '-q', '--bare', repo, bare], { stdio: 'ignore' })
    g(bare, 'config', 'extensions.worktreeConfig', 'true')
    g(bare, 'worktree', 'add', '-q', tree, 'HEAD')
    // the folder has no config.worktree that says core.bare = false
    await rm(join(bare, 'worktrees', 'tree', 'config.worktree'), { force: true })
    const branch = new FilesService(() => [{ label: 'tree', path: tree }], () => scratch)
    expect(await branch.list('d', tree)).toContain('a.txt')
    expect((await branch.search('d', tree, { text: 'hello', regex: false, caseSensitive: false, glob: '' })).map((h) => h.path)).toContain('a.txt')
  })
  it('finds the usages of a name by whole word, with the lines and columns, in tracked and untracked files', async () => {
    await writeFile(join(repo, 'sub', 'u.ts'), "const name = 1\nconst rename = name + name // name\nconst größe = 'name'\n")
    await writeFile(join(repo, 'c.txt'), 'untracked name\n')
    const r = await svc.usages('d', repo, 'name', '')
    expect(r.truncated).toBe(false)
    expect(r.files.map((f) => f.path)).toEqual(['c.txt', 'sub/u.ts'])
    const u = r.files[1].matches
    expect(u.map((m) => [m.line, m.column, m.nonCode])).toEqual([[1, 6, false], [2, 15, false], [2, 22, false], [2, 30, true], [3, 15, true]])
    expect(u[1].text).toBe('const rename = name + name // name')
    expect((await svc.usages('d', repo, 'name', '*.txt')).files.map((f) => f.path)).toEqual(['c.txt'])
    expect((await svc.usages('d', repo, 'nomatch', '')).files).toEqual([])
    await expect(svc.usages('d', repo, 'a b', '')).rejects.toThrow()
  })

  it('renames at the places given only, counts places that changed, and refuses files outside the scope or the WorkDesk', async () => {
    await writeFile(join(repo, 'sub', 'u.ts'), 'name(name) // name\n')
    const other = join(dir, 'other')
    await mkdir(other)
    await writeFile(join(other, 'x.ts'), 'name\n')
    const wide = new FilesService(() => [{ label: 'repo', path: repo }, { label: 'other', path: other }], () => scratch)
    const res = await wide.renameSymbol('d', {
      roots: [repo],
      from: 'name',
      to: 'title',
      files: [
        { path: join(repo, 'sub', 'u.ts'), edits: [{ line: 1, column: 0 }, { line: 1, column: 5 }, { line: 1, column: 14 }] },
        { path: join(repo, 'a.txt'), edits: [{ line: 1, column: 0 }] },
        { path: join(other, 'x.ts'), edits: [{ line: 1, column: 0 }] },
        { path: join(dir, 'elsewhere.ts'), edits: [{ line: 1, column: 0 }] }
      ]
    })
    expect(res.files.map((f) => [f.applied, f.stale, !!f.error])).toEqual([[3, 0, false], [0, 1, false], [0, 0, true], [0, 0, true]])
    expect(await readFile(join(repo, 'sub', 'u.ts'), 'utf8')).toBe('title(title) // title\n')
    expect(await readFile(join(other, 'x.ts'), 'utf8')).toBe('name\n')
    await expect(wide.renameSymbol('d', { roots: [repo], from: 'name', to: 'a-b', files: [] })).rejects.toThrow()
  })
})
