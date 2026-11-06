import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LayoutService } from './terminal/layout-service'
import { TerminalManager, type Pty } from './terminal/manager'
import type { Tmux } from './terminal/tmux'
import { paneIds, type PaneTab } from './domain/layout'
import { WorkDeskService } from './service'
import { FakeGit } from './status/fake-git'
import { checkTools, missingRequired } from './tools'

class FakeTmux implements Tmux {
  windows = new Map<string, string | undefined>() // "session:window" -> start command
  sessions = new Set<string>()
  async hasSession(s: string) { return this.sessions.has(s) }
  async hasWindow(s: string, w: string) { return this.windows.has(`${s}:${w}`) }
  async ensureWindow(s: string, w: string, _cwd: string, command?: string) { this.sessions.add(s); this.windows.set(`${s}:${w}`, command) }
  async killWindow(s: string, w: string) { this.windows.delete(`${s}:${w}`) }
  async killSession(s: string) {
    this.sessions.delete(s)
    for (const k of [...this.windows.keys()]) if (k.startsWith(s + ':')) this.windows.delete(k)
  }
  async panePids() { return [] as number[] }
  attachArgs(view: string) { return ['attach-session', '-t', view] }
  async createView(_s: string, v: string) { this.sessions.add(v) }
}
const pty = (): Pty => ({ onData() {}, onExit() {}, write() {}, resize() {}, kill() {} })

describe('parking', () => {
  let root: string
  let service: WorkDeskService
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'workdesk-park-'))
    service = new WorkDeskService(root, new FakeGit())
    await service.load()
  })
  afterEach(async () => {
    service.status.autoCommit.dispose()
    await rm(root, { recursive: true, force: true })
  })

  it('parks and reactivates, and a parked desk cannot be activated', async () => {
    let s = await service.addTodo({ title: 'A', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'A')
    s = await service.activateDesk('a')
    s = await service.parkDesk('a')
    expect(s.desks[0].presence).toBe('parked')
    await expect(service.activateDesk('a')).rejects.toThrow(/parked/)
    s = await service.reactivateDesk('a')
    expect(s.desks[0].presence).toBe('inactive')
    s = await service.activateDesk('a')
    expect(s.desks[0].presence).toBe('active')

    await service.parkDesk('a')
    const reloaded = new WorkDeskService(root, new FakeGit())
    await reloaded.load()
    expect(reloaded.state().desks[0].presence).toBe('parked')
    reloaded.status.autoCommit.dispose()
  })

  it('restores Tabs, Panes and the Claude session after parking killed tmux', async () => {
    let s = await service.addTodo({ title: 'A', topics: [], list: 'today' })
    s = await service.startPlainDesk([s.todos[0].id], 'A')
    const tmux = new FakeTmux()
    const terminals = new TerminalManager(tmux, pty, () => {}, () => {}, () => {}, (d, p) => service.claudeSessions.resumeCommand(d, p))
    const layouts = new LayoutService(root, terminals)

    let layout = await layouts.get('a')
    const tab = layout.tabs[1].id
    const first = paneIds((layout.tabs[1] as PaneTab).layout)[0]
    layout = await layouts.splitPane('a', tab, first, 'horizontal')
    layout = await layouts.addTab('a')
    const before = JSON.stringify(layout)
    const all = layout.tabs.flatMap((t) => (t.kind === 'panes' ? paneIds(t.layout) : []))
    for (const p of all) await terminals.attach('a', p, root, 80, 24)
    await service.handleHook({ event: 'SessionStart', sessionId: 'sess-1', cwd: join(root, 'a'), paneId: first })
    expect(tmux.sessions.has('workdesk-a')).toBe(true)

    await terminals.parkDesk('a', all)
    await service.parkDesk('a')
    expect(tmux.sessions.size).toBe(0)
    expect(tmux.windows.size).toBe(0)

    await service.reactivateDesk('a')
    expect(JSON.stringify(await new LayoutService(root, terminals).get('a'))).toBe(before)
    for (const p of all) await terminals.attach('a', p, root, 80, 24)
    expect(tmux.windows.get(`workdesk-a:${first}`)).toBe(`cd '${join(root, 'a')}' 2>/dev/null; claude --resume 'sess-1'; exec "$SHELL"`)
    const others = all.filter((p) => p !== first)
    expect(others.every((p) => tmux.windows.get(`workdesk-a:${p}`) === undefined)).toBe(true)
  })
})

describe('first-run tool checks', () => {
  it('reports missing required tools with hints', async () => {
    const exec = async (file: string) => {
      if (file === 'tmux' || file === 'gh') throw new Error('nope')
      return `${file} 1.0`
    }
    const checks = await checkTools(exec, () => 'code')
    expect(checks.map((c) => [c.name, c.ok])).toEqual([['git', true], ['tmux', false], ['code', true], ['gh', false]])
    expect(missingRequired(checks).map((c) => c.name)).toEqual(['tmux'])
    expect(checks[1].hint).toContain('brew install tmux')
    const noCode = await checkTools(async () => 'v', () => { throw new Error('not found') })
    expect(noCode.find((c) => c.name === 'code')!.ok).toBe(false)
  })
})

describe('tool PATH', () => {
  it('appends Homebrew folders to a minimal GUI PATH without duplicates', async () => {
    const { withToolPaths } = await import('./env')
    expect(withToolPaths('/usr/bin:/bin')).toBe('/usr/bin:/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/sbin')
    expect(withToolPaths(undefined).startsWith('/opt/homebrew/bin')).toBe(true)
    expect(withToolPaths('/opt/homebrew/bin:/x').split(':').filter((d) => d === '/opt/homebrew/bin')).toHaveLength(1)
  })
})
