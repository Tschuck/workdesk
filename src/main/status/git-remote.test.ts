import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { realGit } from './git'

const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()

/** the real git against a bare repository on disk: the first push into an empty remote, and a second machine */
describe('realGit with a remote', () => {
  let dir: string
  let bare: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wd-remote-'))
    bare = join(dir, 'remote.git')
    execFileSync('git', ['init', '--bare', bare])
    for (const name of ['a', 'b']) {
      execFileSync('git', ['init', '-b', 'main', join(dir, name)])
      git(join(dir, name), 'config', 'user.email', 't@example.com')
      git(join(dir, name), 'config', 'user.name', 't')
    }
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('accepts an empty repository, rejects one that does not exist', async () => {
    await expect(realGit.checkRemote(bare)).resolves.toBeUndefined()
    await expect(realGit.checkRemote(join(dir, 'missing.git'))).rejects.toThrow()
  })

  it('sets, changes and removes origin', async () => {
    const a = join(dir, 'a')
    expect(await realGit.remoteUrl(a)).toBeUndefined()
    await realGit.setRemote(a, bare)
    expect(await realGit.remoteUrl(a)).toBe(bare)
    await realGit.setRemote(a, join(dir, 'other.git'))
    expect(await realGit.remoteUrl(a)).toBe(join(dir, 'other.git'))
    await realGit.setRemote(a, undefined)
    expect(await realGit.remoteUrl(a)).toBeUndefined()
  })

  it('pushes into an empty remote, then rebases onto what another machine pushed', async () => {
    const [a, b] = [join(dir, 'a'), join(dir, 'b')]
    await writeFile(join(a, 'todos.json'), '[]')
    await realGit.commitAll(a, 'one')
    await realGit.setRemote(a, bare)
    expect(await realGit.pullRebase(a)).toBe('ok') // nothing there yet
    await realGit.push(a)
    expect(git(bare, 'log', '--format=%s', 'main')).toBe('one')

    await realGit.setRemote(b, bare)
    expect(await realGit.pullRebase(b)).toBe('ok')
    await writeFile(join(b, 'notes.md'), 'x')
    await realGit.commitAll(b, 'two')
    await realGit.push(b)

    await writeFile(join(a, 'more.md'), 'y')
    await realGit.commitAll(a, 'three')
    expect(await realGit.pullRebase(a)).toBe('ok')
    await realGit.push(a)
    expect(git(bare, 'log', '--format=%s', 'main')).toBe('three\ntwo\none')
  })
})
