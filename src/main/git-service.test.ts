import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FilesService } from './files'
import { GitService } from './git-service'

describe('git for a Branch folder', () => {
  let dir: string
  let repo: string
  let git: GitService
  const sh = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' }).toString()

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'workdesk-git-'))
    repo = join(dir, 'repo')
    await mkdir(repo)
    sh('init', '-q')
    sh('config', 'user.email', 'a@b.c')
    sh('config', 'user.name', 'n')
    sh('config', 'commit.gpgsign', 'false')
    await writeFile(join(repo, 'a.txt'), 'one\n')
    await mkdir(join(repo, 'sub'))
    await writeFile(join(repo, 'sub', 'b.txt'), 'b\n')
    sh('add', '.')
    sh('commit', '-q', '-m', 'first')
    const files = new FilesService(() => [{ label: 'repo', path: repo }], () => join(dir, 'scratch'))
    git = new GitService(files)
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('lists changes: modified, untracked, deleted', async () => {
    await writeFile(join(repo, 'a.txt'), 'two\n')
    await writeFile(join(repo, 'new.txt'), 'n\n')
    await rm(join(repo, 'sub', 'b.txt'))
    const s = await git.status('d', repo)
    expect(s.map((e) => `${e.x}${e.y} ${e.path}`)).toEqual([' M a.txt', '?? new.txt', ' D sub/b.txt'])
  })

  it('gives the file at HEAD, or nothing for a new file', async () => {
    await writeFile(join(repo, 'a.txt'), 'two\n')
    await writeFile(join(repo, 'new.txt'), 'n\n')
    expect(await git.head('d', repo, join(repo, 'a.txt'))).toEqual({ exists: true, content: 'one\n', refused: undefined })
    expect(await git.head('d', repo, join(repo, 'new.txt'))).toEqual({ exists: false, content: '' })
  })

  it('stages, unstages and commits', async () => {
    await writeFile(join(repo, 'a.txt'), 'two\n')
    await writeFile(join(repo, 'new.txt'), 'n\n')
    await git.stage('d', repo, [join(repo, 'a.txt'), 'new.txt'])
    expect((await git.status('d', repo)).map((e) => `${e.x}${e.y} ${e.path}`)).toEqual(['M  a.txt', 'A  new.txt'])
    await git.unstage('d', repo, ['new.txt'])
    expect((await git.status('d', repo)).map((e) => `${e.x}${e.y} ${e.path}`)).toEqual(['M  a.txt', '?? new.txt'])
    const line = await git.commit('d', repo, 'second')
    expect(line).toContain('second')
    expect(sh('log', '-1', '--format=%s').trim()).toBe('second')
    expect((await git.status('d', repo)).map((e) => e.path)).toEqual(['new.txt'])
  })

  it('shows git\'s own error when there is nothing to commit, and refuses an empty message', async () => {
    await expect(git.commit('d', repo, 'x')).rejects.toThrow(/nothing to commit|nothing added/)
    await expect(git.commit('d', repo, '  ')).rejects.toThrow('needs a message')
  })

  it('shows git\'s error when signing fails, and commits nothing', async () => {
    sh('config', 'commit.gpgsign', 'true')
    sh('config', 'gpg.format', 'openpgp')
    sh('config', 'user.signingkey', 'ABCDEF')
    sh('config', 'gpg.program', '/usr/bin/false')
    await writeFile(join(repo, 'a.txt'), 'two\n')
    await git.stage('d', repo, ['a.txt'])
    // vitest.config switches signing off for fixtures through the environment; this test needs the repo's own setting
    const count = process.env.GIT_CONFIG_COUNT
    process.env.GIT_CONFIG_COUNT = '0'
    try {
      await expect(git.commit('d', repo, 'signed')).rejects.toThrow(/gpg|sign/i)
    } finally {
      process.env.GIT_CONFIG_COUNT = count
    }
    expect(sh('log', '-1', '--format=%s').trim()).toBe('first')
  })

  it('keeps to the folders of the WorkDesk', async () => {
    await expect(git.stage('d', repo, ['/etc/hosts'])).rejects.toThrow()
    await expect(git.status('d', dir)).rejects.toThrow()
  })
})
