import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AutoCommitter } from './autocommit'
import { FakeGit } from './fake-git'
import { StatusRepo } from './status-repo'
import type { Todo, WorkDesk } from '../domain/types'

describe('AutoCommitter', () => {
  let git: FakeGit
  beforeEach(() => {
    vi.useFakeTimers()
    git = new FakeGit()
    git.changes = true
  })
  afterEach(() => vi.useRealTimers())

  it('debounces: commits once, ~60 s after the last change', async () => {
    const c = new AutoCommitter('/x', git)
    c.notifyChange()
    await vi.advanceTimersByTimeAsync(50_000)
    c.notifyChange()
    await vi.advanceTimersByTimeAsync(50_000)
    expect(git.calls).toEqual([])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(git.calls).toEqual(['commit:chore:'])
  })

  it('does not commit or push without changes or a remote', async () => {
    git.changes = false
    const c = new AutoCommitter('/x', git)
    await c.flush()
    expect(git.calls).toEqual([])
    git.changes = true
    await c.flush()
    expect(git.calls).toEqual(['commit:chore:'])
  })

  it('pushes only with a remote and at most every 5 minutes', async () => {
    git.remote = true
    const c = new AutoCommitter('/x', git)
    await c.flush()
    expect(git.calls).toEqual(['commit:chore:', 'pull-rebase', 'push'])

    git.calls = []
    git.changes = true
    await vi.advanceTimersByTimeAsync(60_000)
    await c.flush()
    expect(git.calls).toEqual(['commit:chore:'])

    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(git.calls).toEqual(['commit:chore:', 'pull-rebase', 'push'])
  })

  it('stops and asks for attention on a rebase conflict', async () => {
    git.remote = true
    git.rebase = 'conflict'
    const onAttention = vi.fn()
    const c = new AutoCommitter('/x', git, { onAttention })
    await c.flush()
    expect(c.state).toBe('attention')
    expect(onAttention).toHaveBeenCalledOnce()

    git.calls = []
    git.changes = true
    c.notifyChange()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(git.calls).toEqual([])

    git.rebase = 'ok'
    c.resolveAttention()
    await vi.advanceTimersByTimeAsync(0)
    expect(git.calls).toEqual(['pull-rebase', 'push'])
  })
})

describe('StatusRepo', () => {
  let root: string
  let git: FakeGit
  let repo: StatusRepo
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'workdesk-'))
    git = new FakeGit()
    repo = new StatusRepo(root, git)
    await repo.ensure()
  })
  afterEach(async () => {
    repo.autoCommit.dispose()
    await rm(root, { recursive: true, force: true })
  })

  const todo: Todo = { id: 't1', title: 'A', topics: [], list: 'today', resolved: false, createdAt: 1 }
  const desk: WorkDesk = {
    id: 'd1',
    name: 'D',
    
    stage: 'testing',
    stageOverridden: false,
    priority: 0,
    presence: 'inactive',
    todoIds: ['t1'],
    branches: [],
    signals: [{ id: 's', type: 'ci-finished', at: 1, read: false }],
    createdAt: 1
  }

  it('a remote is checked first, set, and everything is pushed right away', async () => {
    git.changes = true
    await repo.setRemote(' git@example.com:me/status.git ')
    expect(git.calls).toEqual(['init', 'check-remote:git@example.com:me/status.git', 'set-remote:git@example.com:me/status.git', 'commit:chore:', 'pull-rebase', 'push'])
    expect(await repo.remote()).toBe('git@example.com:me/status.git')
  })

  it('an unreachable remote changes nothing', async () => {
    git.unreachable = 'Repository not found.'
    await expect(repo.setRemote('git@example.com:me/typo.git')).rejects.toThrow('Repository not found.')
    expect(await repo.remote()).toBeUndefined()
    expect(git.calls).not.toContain('push')
  })

  it('an empty text removes the remote without pushing', async () => {
    await repo.setRemote('git@example.com:me/status.git')
    git.calls = []
    await repo.setRemote('')
    expect(git.calls).toEqual(['set-remote:'])
    expect(await repo.remote()).toBeUndefined()
  })

  it('git inits once and creates the layout', async () => {
    expect(git.calls).toEqual(['init'])
    await repo.ensure()
    expect(git.calls).toEqual(['init'])
    expect((await readdir(repo.dir)).sort()).toEqual(['archive', 'desks', 'knowledge', 'sources'])
  })

  it('round-trips todos and desks, dropping Signals', async () => {
    expect(await repo.readTodos()).toEqual([])
    await repo.writeTodos([todo])
    await repo.writeDesk(desk)
    expect(await repo.readTodos()).toEqual([todo])
    const [stored] = await repo.readDesks()
    expect(stored.id).toBe('d1')
    expect('signals' in stored).toBe(false)
  })

  it('archives notes and the final Stage, then removes the live desk', async () => {
    await repo.writeDesk(desk)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(repo.notesDir('d1'), 'a.md'), 'hello')
    const target = await repo.archiveDesk(desk, ['sess-1'], '2026-10-27')
    expect(target.endsWith('archive/2026-10-27-d1')).toBe(true)
    expect(await readFile(join(target, 'notes', 'a.md'), 'utf8')).toBe('hello')
    const summary = JSON.parse(await readFile(join(target, 'summary.json'), 'utf8'))
    expect(summary).toMatchObject({ finalStage: 'testing', claudeSessionIds: ['sess-1'] })
    expect(await repo.readDesks()).toEqual([])
  })

  it('archives into the folder of a clear that stopped half way, and keeps what is in it', async () => {
    await repo.writeDesk(desk)
    const { writeFile, mkdir } = await import('node:fs/promises')
    // the first try moved a note there and then failed
    const target = join(repo.dir, 'archive', '2026-10-27-d1')
    await mkdir(join(target, 'notes'), { recursive: true })
    await writeFile(join(target, 'notes', 'old.md'), 'from the first try')
    await writeFile(join(target, 'notes', 'same.md'), 'same')
    await writeFile(join(target, 'notes', 'clash.md'), 'first')
    await writeFile(join(repo.notesDir('d1'), 'same.md'), 'same')
    await writeFile(join(repo.notesDir('d1'), 'clash.md'), 'second')
    await writeFile(join(repo.notesDir('d1'), 'new.md'), 'new')
    await repo.archiveDesk(desk, [], '2026-10-27')
    expect(await readFile(join(target, 'notes', 'old.md'), 'utf8')).toBe('from the first try')
    expect(await readFile(join(target, 'notes', 'new.md'), 'utf8')).toBe('new')
    expect(await readFile(join(target, 'notes', 'clash.md'), 'utf8')).toBe('first')
    expect(await readFile(join(target, 'notes', 'clash-2.md'), 'utf8')).toBe('second')
    expect(await readdir(join(target, 'notes'))).not.toContain('same-2.md')
  })

  it('auto-commits writes after the debounce', async () => {
    vi.useFakeTimers()
    try {
      git.changes = true
      await repo.writeTodos([todo])
      await vi.advanceTimersByTimeAsync(60_000)
      expect(git.calls).toContain('commit:chore:')
    } finally {
      vi.useRealTimers()
    }
  })
})
