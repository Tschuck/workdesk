import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkDeskService } from './service'
import { FakeGit } from './status/fake-git'

let root: string
let service: WorkDeskService
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workdesk-refs-'))
  service = new WorkDeskService(root, new FakeGit(), () => 1000)
  await service.load()
})
afterEach(async () => {
  service.status.autoCommit.dispose()
  await rm(root, { recursive: true, force: true })
})

describe('page references', () => {
  it('attaches pages to a WorkDesk and keeps them across a reload', async () => {
    await service.startPlainDesk([], 'Desk')
    await service.addPageRef({ kind: 'desk', id: 'desk' }, { url: 'https://github.com/a/b/pull/1', title: 'PR 1', favicon: 'https://github.com/f.png' })
    const s = await service.addPageRef({ kind: 'desk', id: 'desk' }, { url: 'https://github.com/a/b/pull/1#files', title: 'PR 1 files' })
    expect(s.desks[0].refs).toHaveLength(1)
    expect(s.desks[0].refs?.[0]).toMatchObject({ title: 'PR 1 files', favicon: 'https://github.com/f.png', addedAt: 1000 })
    const again = new WorkDeskService(root, new FakeGit())
    await again.load()
    expect(again.state().desks[0].refs?.[0].url).toBe('https://github.com/a/b/pull/1')
    again.status.autoCommit.dispose()
  })

  it('attaches pages to a Todo and detaches them', async () => {
    let s = await service.addTodo({ title: 'T', topics: [], list: 'today' })
    const id = s.todos[0].id
    s = await service.addPageRef({ kind: 'todo', id }, { url: 'https://a.dev/x', title: 'X' })
    expect(s.todos[0].refs?.map((r) => r.url)).toEqual(['https://a.dev/x'])
    s = await service.removePageRef({ kind: 'todo', id }, s.todos[0].refs![0].id)
    expect(s.todos[0].refs).toEqual([])
  })

  it('refuses pages that are not on the web and unknown targets', async () => {
    await service.startPlainDesk([], 'Desk')
    await expect(service.addPageRef({ kind: 'desk', id: 'desk' }, { url: 'about:blank' })).rejects.toThrow(/http/)
    await expect(service.addPageRef({ kind: 'desk', id: 'nope' }, { url: 'https://a.dev' })).rejects.toThrow(/Unknown WorkDesk/)
    await expect(service.addPageRef({ kind: 'todo', id: 'nope' }, { url: 'https://a.dev' })).rejects.toThrow(/Unknown Todo/)
  })
})
