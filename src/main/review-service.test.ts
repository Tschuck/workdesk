import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FilesService } from './files'
import { ReviewService, type BaseStore } from './review-service'

describe('review of a Branch against a base', () => {
  let dir: string
  let repo: string
  let svc: ReviewService
  const store = new Map<string, string>()
  const bases: BaseStore = { get: (k) => store.get(k), set: (k, v) => void store.set(k, v) }
  const sh = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' }).toString()

  beforeEach(async () => {
    store.clear()
    dir = await mkdtemp(join(tmpdir(), 'workdesk-review-'))
    repo = join(dir, 'repo')
    await mkdir(repo)
    sh('init', '-q', '-b', 'main')
    sh('config', 'user.email', 'a@b.c')
    sh('config', 'user.name', 'n')
    sh('config', 'commit.gpgsign', 'false')
    await writeFile(join(repo, 'keep.txt'), 'k\n')
    await writeFile(join(repo, 'edit.txt'), 'old\n')
    await writeFile(join(repo, 'gone.txt'), 'g\n')
    sh('add', '.')
    sh('commit', '-q', '-m', 'base')
    sh('checkout', '-q', '-b', 'feature')
    await writeFile(join(repo, 'edit.txt'), 'new\n')
    await rm(join(repo, 'gone.txt'))
    await mkdir(join(repo, 'src'))
    await writeFile(join(repo, 'src', 'added.ts'), 'a\n')
    sh('add', '.')
    sh('commit', '-q', '-m', 'work')
    await writeFile(join(repo, 'untracked.txt'), 'u\n')
    svc = new ReviewService(new FilesService(() => [{ label: 'repo', path: repo }], () => join(dir, 'scratch')), bases)
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('starts from main and lists what changed since the merge base, plus untracked files', async () => {
    const s = await svc.state('d', repo)
    expect(s.base).toBe('main')
    expect(s.entries.map((e) => `${e.status} ${e.path}`).sort()).toEqual(['A src/added.ts', 'D gone.txt', 'M edit.txt', 'U untracked.txt'])
    expect(s.message).toBeUndefined()
  })

  it('lists the newest commits to pick one as the base: the review then shows what changed after it', async () => {
    const commits = await svc.commits('d', repo)
    expect(commits.map((c) => c.title)).toEqual(['work', 'base'])
    expect(commits[0].sha).toMatch(/^[0-9a-f]{40}$/)
    await svc.setBase('d', repo, commits[1].sha)
    const s = await svc.state('d', repo)
    expect(s.base).toBe(commits[1].sha)
    expect(s.entries.map((e) => e.path).sort()).toEqual(['edit.txt', 'gone.txt', 'src/added.ts', 'untracked.txt'])
    await svc.setBase('d', repo, commits[0].sha)
    expect((await svc.state('d', repo)).entries.map((e) => e.path)).toEqual(['untracked.txt'])
  })

  it('remembers a picked base per root, and says when it cannot compare', async () => {
    expect(await svc.branches('d', repo)).toEqual(['main', 'feature'])
    await svc.setBase('d', repo, 'feature')
    const s = await svc.state('d', repo)
    expect(s.base).toBe('feature')
    expect(s.entries.map((e) => e.path)).toEqual(['untracked.txt'])
    await expect(svc.setBase('d', repo, 'nope')).rejects.toThrow('no branch')
    await expect(svc.setBase('d', repo, '--evil')).rejects.toThrow()
  })

  it('gives the file at the merge base', async () => {
    expect((await svc.baseFile('d', repo, join(repo, 'edit.txt'))).content).toBe('old\n')
    expect((await svc.baseFile('d', repo, 'gone.txt')).content).toBe('g\n')
    expect((await svc.baseFile('d', repo, 'src/added.ts')).exists).toBe(false)
  })

  it('keeps comments in .review/comments.json (no markdown file) and out of git', async () => {
    const c = await svc.addComment('d', repo, join(repo, 'edit.txt'), 1, ' fix this\nsecond line ')
    expect(c).toMatchObject({ path: 'edit.txt', line: 1, text: 'fix this\nsecond line' })
    const json = readFileSync(join(repo, '.review', 'comments.json'), 'utf8')
    expect(JSON.parse(json)).toEqual([c])
    expect(json.endsWith('\n')).toBe(true)
    expect(existsSync(join(repo, '.review', 'comments.md'))).toBe(false)
    expect(readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8')).toContain('/.review/')
    expect(sh('status', '--porcelain')).not.toContain('.review')
    expect((await svc.state('d', repo)).comments).toEqual([c])

    await svc.updateComment('d', repo, c.id, 'changed')
    expect((await svc.state('d', repo)).comments[0].text).toBe('changed')
    await svc.setBase('d', repo, 'feature')
    expect((await svc.state('d', repo)).base).toBe('feature')
    await svc.removeComment('d', repo, c.id)
    expect((await svc.state('d', repo)).comments).toEqual([])
  })

  it('reads comments.json as somebody else wrote it', async () => {
    const c = await svc.addComment('d', repo, 'edit.txt', 1, 'old')
    writeFileSync(join(repo, '.review', 'comments.json'), JSON.stringify([{ ...c, text: 'new from outside' }], null, 2) + '\n')
    expect((await svc.state('d', repo)).comments[0].text).toBe('new from outside')
  })

  it('keeps comments on the review as a whole apart from the ones on lines', async () => {
    const n = await svc.addNote('d', repo, ' about all of it ')
    expect(n.text).toBe('about all of it')
    expect(JSON.parse(readFileSync(join(repo, '.review', 'notes.json'), 'utf8'))).toEqual([n])
    expect(existsSync(join(repo, '.review', 'comments.json'))).toBe(false)
    expect((await svc.state('d', repo)).notes).toEqual([n])
    await svc.updateNote('d', repo, n.id, 'changed')
    expect((await svc.state('d', repo)).notes[0].text).toBe('changed')
    await svc.addComment('d', repo, 'edit.txt', 1, 'a')
    await svc.clearComments('d', repo)
    expect((await svc.state('d', repo)).notes).toEqual([])
    const m = await svc.addNote('d', repo, 'x')
    await svc.removeNote('d', repo, m.id)
    expect((await svc.state('d', repo)).notes).toEqual([])
  })

  it('clears all comments', async () => {
    await svc.addComment('d', repo, 'edit.txt', 1, 'a')
    await svc.addComment('d', repo, 'keep.txt', 1, 'b')
    await svc.clearComments('d', repo)
    expect((await svc.state('d', repo)).comments).toEqual([])
  })

  it('refuses a file outside the folder and an empty comment', async () => {
    await expect(svc.addComment('d', repo, '../x', 1, 'a')).rejects.toThrow()
    await expect(svc.addComment('d', repo, 'edit.txt', 1, ' ')).rejects.toThrow()
    await expect(svc.addComment('d', repo, 'edit.txt', 0, 'a')).rejects.toThrow()
  })
})
