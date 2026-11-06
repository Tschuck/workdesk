import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ParkAll } from './park-all'
import { WorkDeskService } from './service'
import { FakeGit } from './status/fake-git'
import type { PaneInfo } from './terminal/tmux-admin'

describe('park all and bring them back', () => {
  let root: string
  let service: WorkDeskService
  let panes: PaneInfo[]
  let resumable: Set<string>
  let shutDowns: string[]
  let parkAll: ParkAll

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'workdesk-parkall-'))
    service = new WorkDeskService(root, new FakeGit())
    await service.load()
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      let s = await service.addTodo({ title: name, topics: [], list: 'today' })
      await service.startPlainDesk([s.todos[s.todos.length - 1].id], name)
    }
    panes = []
    resumable = new Set()
    shutDowns = []
    parkAll = new ParkAll({
      service, root,
      panes: async () => panes,
      resumeCommand: async (d, p) => (resumable.has(`${d}/${p}`) ? `claude --resume x` : undefined),
      shutDown: async (id) => void shutDowns.push(id)
    })
  })
  afterEach(async () => {
    service.status.autoCommit.dispose()
    await rm(root, { recursive: true, force: true })
  })

  it('lists what runs in each WorkDesk and warns about Claude that cannot be resumed', async () => {
    panes = [
      { session: 'workdesk-alpha', command: 'zsh', window: 'p1' },
      { session: 'workdesk-alpha', command: 'claude', window: 'p2' },
      { session: 'workdesk-alpha', command: 'claude', window: 'p3' },
      { session: 'workdesk-beta', command: 'node', window: 'q1' },
      { session: 'workdesk-view-alpha-p2', command: 'claude', window: 'p2' },
      { session: 'workdesk-other', command: 'claude', window: 'z' }
    ]
    resumable.add('alpha/p2')
    await service.parkDesk('gamma')
    expect(await parkAll.preflight()).toEqual([
      { deskId: 'alpha', name: 'Alpha', terminals: 3, programs: ['claude'], claudeWithoutSession: 1 },
      { deskId: 'beta', name: 'Beta', terminals: 1, programs: ['node'], claudeWithoutSession: 0 }
    ])
  })

  it('parks every WorkDesk that is not parked, remembers the open one, and brings everything back', async () => {
    await service.activateDesk('beta')
    await service.parkDesk('gamma')
    const parked = await parkAll.parkAll()
    expect(shutDowns).toEqual(['alpha', 'beta'])
    expect(parked.desks.map((d) => d.presence)).toEqual(['parked', 'parked', 'parked'])
    expect(await parkAll.remembered()).toBe(true)

    // survives the restart: the WorkDesks and the memory are on disk, a new service starts from them
    const reloaded = new WorkDeskService(root, new FakeGit())
    await reloaded.load()
    expect(reloaded.state().desks.map((d) => d.presence)).toEqual(['parked', 'parked', 'parked'])
    const after = new ParkAll({ service: reloaded, root, panes: async () => [], resumeCommand: async () => undefined, shutDown: async () => undefined })
    expect(await after.remembered()).toBe(true)
    const back = await after.reactivateAll()
    expect(back.opened).toBe('beta')
    expect(back.state.desks.map((d) => [d.id, d.presence])).toEqual([['alpha', 'inactive'], ['beta', 'active'], ['gamma', 'inactive']])
    expect(await after.remembered()).toBe(false)
    expect((await after.reactivateAll()).opened).toBeUndefined()
    reloaded.status.autoCommit.dispose()
  })

  it('works when nothing was open, and when everything is parked already', async () => {
    const s = await parkAll.parkAll()
    expect(s.desks.every((d) => d.presence === 'parked')).toBe(true)
    expect(await parkAll.remembered()).toBe(false)
    expect(shutDowns).toEqual(['alpha', 'beta', 'gamma'])
    shutDowns.length = 0
    await parkAll.parkAll()
    expect(shutDowns).toEqual([])
    const back = await parkAll.reactivateAll()
    expect(back.opened).toBeUndefined()
    expect(back.state.desks.every((d) => d.presence === 'inactive')).toBe(true)
  })

  it('parks only the WorkDesks it is given (the waiting ones), and does not remember the open one for Reactivate all', async () => {
    await service.activateDesk('alpha')
    panes = [{ session: 'workdesk-alpha', command: 'zsh', window: 'p1' }, { session: 'workdesk-beta', command: 'zsh', window: 'q1' }]
    expect((await parkAll.preflight(['beta'])).map((d) => d.deskId)).toEqual(['beta'])
    const s = await parkAll.parkAll(['beta', 'gamma'])
    expect(shutDowns).toEqual(['beta', 'gamma'])
    expect(s.desks.map((d) => [d.id, d.presence])).toEqual([['alpha', 'active'], ['beta', 'parked'], ['gamma', 'parked']])
    expect(await parkAll.remembered()).toBe(false)
  })

  it('reactivates only the parked WorkDesks it is given, and leaves what Reactivate all remembers alone', async () => {
    await service.activateDesk('alpha')
    await parkAll.parkAll()
    expect(await parkAll.remembered()).toBe(true)
    const part = await parkAll.reactivateAll(['beta'])
    expect(part.opened).toBeUndefined()
    expect(part.state.desks.map((d) => [d.id, d.presence])).toEqual([['alpha', 'parked'], ['beta', 'inactive'], ['gamma', 'parked']])
    expect(await parkAll.remembered()).toBe(true)
  })
})
