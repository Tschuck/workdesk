import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { gitBranch, paneInfo, tildePath } from './pane-info'
import { createTmux } from './tmux'
import { createTmuxAdmin } from './tmux-admin'

Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' })
const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
const hasTmux = (() => { try { execFileSync('tmux', ['-V']); return true } catch { return false } })()

describe('the folder and branch shown above a terminal', () => {
  it('writes the home folder as ~', () => {
    expect(tildePath('/Users/me', '/Users/me')).toBe('~')
    expect(tildePath('/Users/me/projects/x', '/Users/me')).toBe('~/projects/x')
    expect(tildePath('/Users/mel/x', '/Users/me')).toBe('/Users/mel/x')
    expect(tildePath('/tmp/x', '/Users/me')).toBe('/tmp/x')
  })

  it('knows the branch of a git folder, a detached HEAD, and no branch outside git', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'workdesk-pi-')))
    try {
      expect(await gitBranch(dir)).toBeUndefined()
      sh(dir, 'init', '-b', 'feature/x')
      await writeFile(join(dir, 'f'), 'x')
      sh(dir, 'add', '.')
      sh(dir, 'commit', '-m', 'init')
      expect(await gitBranch(dir)).toBe('feature/x')
      const sub = join(dir, 'deep')
      await mkdir(sub)
      expect(await gitBranch(sub)).toBe('feature/x')
      sh(dir, 'checkout', '--detach')
      expect(await gitBranch(dir)).toMatch(/^\([0-9a-f]+\)$/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(!hasTmux)('follows the shell: the folder of a real tmux pane changes with cd, a gone pane has none', async () => {
    const socket = `workdesk-pi-test-${process.pid}`
    const tmux = createTmux(socket)
    const admin = createTmuxAdmin(socket)
    const a = await realpath(await mkdtemp(join(tmpdir(), 'workdesk-pa-')))
    const b = join(a, 'sub')
    await mkdir(b)
    try {
      await tmux.ensureWindow('workdesk-demo', 'p1', a, 'sleep 60')
      expect((await paneInfo(admin, 'demo', 'p1'))?.cwd).toBe(a)
      await tmux.killWindow('workdesk-demo', 'p1')
      await tmux.ensureWindow('workdesk-demo', 'p2', b)
      expect((await paneInfo(admin, 'demo', 'p2'))?.cwd).toBe(b)
      expect(await paneInfo(admin, 'demo', 'nope')).toBeUndefined()
    } finally {
      try { execFileSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' }) } catch { /* gone */ }
      await rm(a, { recursive: true, force: true })
    }
  })
})
