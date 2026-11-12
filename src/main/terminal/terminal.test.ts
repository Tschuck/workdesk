import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isAddress, moveEngine, normalizeUrl, orderEngines } from '../domain/url'
import { cycleTab, singleBrowserFavicon, DEFAULT_BROWSER_URL, findPane, newBrowserPane, setBrowserLocation, addTab, closeTab, type PaneTab, defaultLayout, newTerminalPane, paneIds, removePane, splitPane, tabPaneIds, movePane, mergeTab, duplicateTab, movePaneBeside, newFilePane, setFileLocation, singleFilePath, fullTabName, paneSummaries, togglePin, pinnedTabs, closeTab as closeTabOp, moveTab, setTabGroup, moveTabToGroup, moveGroup } from '../domain/layout'
import { LayoutService } from './layout-service'
import { TerminalManager, type Pty } from './manager'
import type { Tmux } from './tmux'
import { createTmux, realTmux } from './tmux'

describe('layout tree', () => {
  const root = newTerminalPane('a')
  it('splits and flattens same-direction splits', () => {
    expect(paneIds(splitPane(root, 'a', 'horizontal', newTerminalPane('z'), true))).toEqual(['z', 'a'])
    let n = splitPane(root, 'a', 'horizontal', newTerminalPane('b'))
    n = splitPane(n, 'b', 'horizontal', newTerminalPane('c'))
    expect(n).toMatchObject({ type: 'split', direction: 'horizontal' })
    expect(paneIds(n)).toEqual(['a', 'b', 'c'])
    expect((n as { children: unknown[] }).children).toHaveLength(3)
    n = splitPane(n, 'b', 'vertical', newTerminalPane('d'))
    expect(paneIds(n)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('collapses splits when a Pane is removed', () => {
    const n = splitPane(root, 'a', 'vertical', newTerminalPane('b'))
    expect(removePane(n, 'b')).toEqual(root)
    expect(removePane(root, 'a')).toBeUndefined()
  })

  it('manages Tabs', () => {
    let l = defaultLayout('t1', 'a')
    l = addTab(l, { kind: 'panes', id: 't2', name: 'Two', layout: newTerminalPane('b') })
    expect(l.activeTabId).toBe('t2')
    expect(tabPaneIds(l, 't2')).toEqual(['b'])
    l = closeTab(l, 't2')
    expect(l.activeTabId).toBe('t1')
    expect(() => closeTab(l, 't1')).toThrow()
  })

  it('opens a link in a browser Tab, and goes to that Tab when the page is already open', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workdesk-link-'))
    const svc = new LayoutService(root, new TerminalManager(new FakeTmux(), () => new FakePty(), () => {}))
    await svc.get('d')
    const first = await svc.addTab('d', 'browser', 'https://github.com/o/r/pull/1')
    await svc.addTab('d')
    const again = await svc.addTab('d', 'browser', 'https://github.com/o/r/pull/1')
    expect(again.tabs.filter((t) => t.kind === 'panes' && t.layout.type === 'pane' && t.layout.kind === 'browser')).toHaveLength(1)
    expect(again.activeTabId).toBe(first.activeTabId)
    await rm(root, { recursive: true, force: true })
  })

  it('opens several pages at once: one Tab each, none lost, the first one shown, repeated pages reused', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workdesk-links-'))
    const svc = new LayoutService(root, new TerminalManager(new FakeTmux(), () => new FakePty(), () => {}))
    const urls = ['https://github.com/o/r/pull/1', 'https://github.com/o/r/pull/2', 'https://github.com/o/r/pull/3']
    await svc.addTab('d', 'browser', urls[1]) // one of them is open already
    const layout = await svc.addBrowserTabs('d', [...urls, urls[0]])
    const browser = layout.tabs.filter((t) => t.kind === 'panes' && t.layout.type === 'pane' && t.layout.kind === 'browser')
    expect(browser.map((t) => (t.kind === 'panes' && t.layout.type === 'pane' && t.layout.kind === 'browser' ? t.layout.url : ''))).toEqual([urls[1], urls[0], urls[2]])
    expect(layout.activeTabId).toBe(browser[1].id)
    await rm(root, { recursive: true, force: true })
  })

  it('remembers the icon of a Browser Tab, keeps it on the same site, drops it on another, and refuses odd URLs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workdesk-icon-'))
    const svc = new LayoutService(root, new TerminalManager(new FakeTmux(), () => new FakePty(), () => {}))
    await svc.get('d')
    let l = await svc.addTab('d', 'browser', 'https://github.com/o/r')
    const tab = l.tabs[2]
    const pane = paneIds((tab as PaneTab).layout)[0]
    const icon = (x: typeof l) => singleBrowserFavicon(x.tabs[2] as PaneTab)
    l = await svc.setBrowserLocation('d', tab.id, pane, 'https://github.com/o/r', 'r', 'https://github.githubassets.com/favicon.svg')
    expect(icon(l)).toBe('https://github.githubassets.com/favicon.svg')
    // another page of the same site, no new icon yet: the old one stays
    l = await svc.setBrowserLocation('d', tab.id, pane, 'https://github.com/o/r/pull/1', 'PR')
    expect(icon(l)).toBe('https://github.githubassets.com/favicon.svg')
    // another site: no icon until that page announces one
    l = await svc.setBrowserLocation('d', tab.id, pane, 'https://notion.so/x', 'N')
    expect(icon(l)).toBeUndefined()
    // only https and image data URLs are shown
    l = await svc.setBrowserLocation('d', tab.id, pane, 'https://notion.so/x', 'N', 'javascript:alert(1)')
    expect(icon(l)).toBeUndefined()
    l = await svc.setBrowserLocation('d', tab.id, pane, 'https://notion.so/x', 'N', 'data:image/png;base64,AAAA')
    expect(icon(l)).toBe('data:image/png;base64,AAAA')
    await rm(root, { recursive: true, force: true })
  })

  it('has no Editor Tab: VS Code is a window of its own', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workdesk-editor-'))
    const svc = new LayoutService(root, new TerminalManager(new FakeTmux(), () => new FakePty(), () => {}))
    expect((await svc.get('d')).tabs.map((x) => x.kind)).toEqual(['details', 'panes'])
    await rm(root, { recursive: true, force: true })
  })
})

class FakeTmux implements Tmux {
  windows = new Set<string>()
  views: string[] = []
  async hasSession(s: string) { return [...this.windows].some((w) => w.startsWith(s + ':')) }
  async hasWindow(s: string, w: string) { return this.windows.has(`${s}:${w}`) }
  envs: (Record<string, string> | undefined)[] = []
  async ensureWindow(s: string, w: string, _cwd?: string, _command?: string, env?: Record<string, string>) { this.windows.add(`${s}:${w}`); this.envs.push(env) }
  async killWindow(s: string, w: string) { this.windows.delete(`${s}:${w}`) }
  async killSession() {}
  async panePids() { return [] as number[] }
  attachArgs(view: string) { return ['attach-session', '-t', view] }
  async createView(_s: string, v: string) { this.views.push(v) }
}

class FakePty implements Pty {
  killed = false
  written: string[] = []
  private data: (d: string) => void = () => {}
  private exit: () => void = () => {}
  onData(l: (d: string) => void) { this.data = l }
  onExit(l: () => void) { this.exit = l }
  write(d: string) { this.written.push(d) }
  resize() {}
  kill() { this.killed = true }
  emitData(d: string) { this.data(d) }
  emitExit() { this.exit() }
}

describe('TerminalManager', () => {
  it('gives a new window the environment of its WorkDesk (its Claude Account), and an existing one nothing', async () => {
    const tmux = new FakeTmux()
    const m = new TerminalManager(tmux, () => new FakePty(), () => {}, () => {}, () => {}, async () => undefined, undefined, (d): Record<string, string> => (d === 'd1' ? { CLAUDE_CONFIG_DIR: '/work' } : {}))
    await m.attach('d1', 'p1', '/x', 80, 24)
    await m.attach('d1', 'p1', '/x', 80, 24)
    await m.attach('d2', 'p2', '/x', 80, 24)
    expect(tmux.envs).toEqual([{ CLAUDE_CONFIG_DIR: '/work' }, undefined, {}])
  })

  it('keeps the shell in tmux when detaching and kills it when closing', async () => {
    const tmux = new FakeTmux()
    const ptys: FakePty[] = []
    const out: string[] = []
    const m = new TerminalManager(tmux, () => { const p = new FakePty(); ptys.push(p); return p }, (id, d) => out.push(`${id}:${d}`))

    await m.attach('d1', 'p1', '/x', 80, 24)
    ptys[0].emitData('hi')
    m.write('p1', 'ls')
    expect(out).toEqual(['p1:hi'])
    expect(ptys[0].written).toEqual(['ls'])
    expect(tmux.windows.has('workdesk-d1:p1')).toBe(true)

    await m.attach('d1', 'p1', '/x', 80, 24)
    expect(ptys[0].killed).toBe(true)
    expect(tmux.windows.has('workdesk-d1:p1')).toBe(true)

    m.detach('p1')
    expect(m.isAttached('p1')).toBe(false)
    await m.close('d1', 'p1')
    expect(tmux.windows.has('workdesk-d1:p1')).toBe(false)
  })

  it('shows a running window once more under a view id of its own, without touching the Pane, and never creates one', async () => {
    const tmux = new FakeTmux()
    const ptys: FakePty[] = []
    const out: string[] = []
    const finished: string[] = []
    const m = new TerminalManager(tmux, () => { const p = new FakePty(); ptys.push(p); return p }, (id, d) => out.push(`${id}:${d}`), () => {}, (d, p) => finished.push(`${d}:${p}`))
    await expect(m.attach('d1', 'p1', '/x', 80, 24, 'orch-p1')).rejects.toThrow('not running')
    await m.attach('d1', 'p1', '/x', 80, 24)
    await m.attach('d1', 'p1', '/x', 80, 24, 'orch-p1')
    expect(ptys[0].killed).toBe(false)
    expect(tmux.views).toEqual(['workdesk-view-d1-p1', 'workdesk-view-d1-orch-p1'])
    ptys[1].emitData('\x1b]133;D;0\x07')
    m.write('orch-p1', 'y')
    expect(out).toEqual(['orch-p1:\x1b]133;D;0\x07'])
    expect(ptys[1].written).toEqual(['y'])
    // what the commands did is told by the Pane's own terminal only
    expect(finished).toEqual([])
    m.detach('orch-p1')
    expect(m.isAttached('p1')).toBe(true)
  })

  it('types queued input into a new shell once, and never into one that already exists', async () => {
    const tmux = new FakeTmux()
    const ptys: FakePty[] = []
    const m = new TerminalManager(tmux, () => { const p = new FakePty(); ptys.push(p); return p }, () => {})
    m.queueInput('p1', 'pnpm install\r')
    await m.attach('d1', 'p1', '/x', 80, 24)
    expect(ptys[0].written).toEqual(['pnpm install\r'])
    await m.attach('d1', 'p1', '/x', 80, 24) // the window is there already: nothing is typed again
    expect(ptys[1].written).toEqual([])
    // queued for a window that exists already (e.g. after a restart): dropped, not typed into a running shell
    m.queueInput('p1', 'again\r')
    await m.attach('d1', 'p1', '/x', 80, 24)
    expect(ptys[2].written).toEqual([])
  })

  it('a setup Tab opens in the Branch folder and queues the chained commands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workdesk-setup-'))
    const tmux = new FakeTmux()
    const ptys: FakePty[] = []
    const m = new TerminalManager(tmux, () => { const p = new FakePty(); ptys.push(p); return p }, () => {})
    const svc = new LayoutService(root, m)
    await svc.get('d')
    const layout = await svc.addSetupTab('d', '/work/api', 'Setup api', ['pnpm install', 'pnpm build'])
    const tab = layout.tabs.find((t) => t.id === layout.activeTabId)!
    expect(tab).toMatchObject({ name: 'Setup api', layout: { kind: 'terminal', cwd: '/work/api' } })
    const pane = tab.kind === 'panes' && tab.layout.type === 'pane' ? tab.layout.id : ''
    await m.attach('d', pane, '/work/api', 80, 24)
    expect(ptys[0].written).toEqual(['pnpm install && pnpm build\r'])
    await rm(root, { recursive: true, force: true })
  })
})

describe('LayoutService persistence', () => {
  let root: string
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'workdesk-lay-')) })
  afterEach(() => rm(root, { recursive: true, force: true }))

  it('survives a restart', async () => {
    const tmux = new FakeTmux()
    const mk = () => new LayoutService(root, new TerminalManager(tmux, () => new FakePty(), () => {}))
    const first = mk()
    let l = await first.get('desk')
    const paneId = paneIds((l.tabs[1] as PaneTab).layout)[0]
    l = await first.splitPane('desk', l.tabs[1].id, paneId, 'horizontal')
    l = await first.addTab('desk')
    l = await first.renameTab('desk', l.tabs[2].id, 'Server')

    const restarted = await mk().get('desk')
    expect(restarted).toEqual(l)
    expect(restarted.tabs.map((t) => t.name)).toEqual(['Details', 'Terminal', 'Server'])
    expect(paneIds((restarted.tabs[1] as PaneTab).layout)).toHaveLength(2)
  })

  it('closing a Pane ends its tmux window; closing the last Pane of the only Tab leaves a new one', async () => {
    const tmux = new FakeTmux()
    const svc = new LayoutService(root, new TerminalManager(tmux, () => new FakePty(), () => {}))
    let l = await svc.get('desk')
    const tab = l.tabs[1].id
    const first = paneIds((l.tabs[1] as PaneTab).layout)[0]
    tmux.windows.add(`workdesk-desk:${first}`)
    l = await svc.splitPane('desk', tab, first, 'vertical')
    l = await svc.closePane('desk', tab, first)
    expect(tmux.windows.size).toBe(0)
    expect(paneIds((l.tabs[1] as PaneTab).layout)).toHaveLength(1)
    const last = paneIds((l.tabs[1] as PaneTab).layout)[0]
    l = await svc.closePane('desk', tab, last)
    expect(paneIds((l.tabs[1] as PaneTab).layout)).toHaveLength(1)
    expect(paneIds((l.tabs[1] as PaneTab).layout)[0]).not.toBe(last)
  })
})

const hasTmux = (() => { try { execFileSync('tmux', ['-V']); return true } catch { return false } })()
describe.skipIf(!hasTmux)('real tmux', () => {
  it('uses its own server and shows only the chosen window in a view', async () => {
    // a throw-away socket, so the test touches neither the app's nor the user's tmux server
    const socket = `workdesk-test-${process.pid}`
    const tmux = createTmux(socket)
    const session = 'wd-test'
    const sh = (...a: string[]) => execFileSync('tmux', ['-L', socket, ...a]).toString().trim()
    try {
      await tmux.ensureWindow(session, 'p1', tmpdir())
      await tmux.ensureWindow(session, 'p2', tmpdir())
      expect(await tmux.hasWindow(session, 'p1')).toBe(true)
      await tmux.createView(session, `${session}-v`, 'p2')
      expect(sh('display-message', '-p', '-t', `${session}-v:`, '#{window_name}')).toBe('p2')
      expect(tmux.attachArgs('v')).toEqual(['-L', socket, 'attach-session', '-t', 'v', ';', 'set-option', 'destroy-unattached', 'on'])
      await tmux.killWindow(session, 'p1')
      expect(await tmux.hasWindow(session, 'p1')).toBe(false)
      // the default server was not used
      expect(() => execFileSync('tmux', ['has-session', '-t', session], { stdio: 'ignore' })).toThrow()
    } finally {
      try { sh('kill-server') } catch { /* already gone */ }
    }
  })

  it('ends the view of a Pane whose window ends, instead of showing another Pane there', async () => {
    const socket = `workdesk-test-end-${process.pid}`
    const tmux = createTmux(socket)
    const session = 'wd-end'
    const sh = (...a: string[]) => execFileSync('tmux', ['-L', socket, ...a]).toString().trim()
    try {
      await tmux.ensureWindow(session, 'p1', tmpdir())
      await tmux.ensureWindow(session, 'p2', tmpdir())
      await tmux.createView(session, 'v1', 'p1')
      await tmux.createView(session, 'v2', 'p2')
      expect(sh('list-windows', '-t', '=v1', '-F', '#{window_name}')).toBe('p1')
      await tmux.killWindow(session, 'p1')
      const sessions = sh('list-sessions', '-F', '#{session_name}').split('\n')
      expect(sessions).toContain('v2')
      expect(sessions).not.toContain('v1')
      expect(sh('list-windows', '-t', '=v2', '-F', '#{window_name}')).toBe('p2')
    } finally {
      try { sh('kill-server') } catch { /* already gone */ }
    }
  })

  it('the app talks to the "workdesk" socket', () => {
    expect(realTmux.attachArgs('v').slice(0, 2)).toEqual(['-L', 'workdesk'])
  })
})

describe('Browser Panes', () => {
  it('mix with Terminals and remember their location', () => {
    let n = splitPane(newTerminalPane('t'), 't', 'horizontal', newBrowserPane('b'))
    expect(findPane(n, 'b')).toMatchObject({ kind: 'browser', url: DEFAULT_BROWSER_URL })
    n = setBrowserLocation(n, 'b', 'https://github.com/x/y', 'x/y')
    n = setBrowserLocation(n, 't', 'https://nope', 'ignored')
    expect(findPane(n, 'b')).toMatchObject({ url: 'https://github.com/x/y', title: 'x/y' })
    expect(findPane(n, 't')).toEqual(newTerminalPane('t'))
    expect(paneIds(n, 'terminal')).toEqual(['t'])
    expect(paneIds(n, 'browser')).toEqual(['b'])
  })

  it('normalizes what is typed in the address bar', () => {
    expect(normalizeUrl('github.com/foo')).toBe('https://github.com/foo')
    expect(normalizeUrl('localhost:3000')).toBe('http://localhost:3000')
    expect(normalizeUrl('https://a.b')).toBe('https://a.b')
    expect(normalizeUrl('  ')).toBe('about:blank')
    expect(normalizeUrl('how to rebase')).toBe('https://www.startpage.com/do/search?q=how%20to%20rebase')
    expect(normalizeUrl('how to rebase', 'duckduckgo')).toBe('https://duckduckgo.com/?q=how%20to%20rebase')
    expect(normalizeUrl('a b', 'nope')).toBe('https://www.startpage.com/do/search?q=a%20b')
    expect(isAddress('github.com/foo')).toBe(true)
    expect(isAddress('how to')).toBe(false)
  })

  it('persists the location and only closes terminal windows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workdesk-br-'))
    const tmux = new FakeTmux()
    const mk = () => new LayoutService(root, new TerminalManager(tmux, () => new FakePty(), () => {}))
    const svc = mk()
    let l = await svc.get('d')
    const tab = l.tabs[1].id
    const t = paneIds((l.tabs[1] as PaneTab).layout)[0]
    l = await svc.splitPane('d', tab, t, 'horizontal', 'browser')
    const b = paneIds((l.tabs[1] as PaneTab).layout, 'browser')[0]
    await svc.setBrowserLocation('d', tab, b, 'https://github.com/pulls', 'Pull requests')
    const again = await mk().get('d')
    expect(findPane((again.tabs[1] as PaneTab).layout, b)).toMatchObject({ url: 'https://github.com/pulls', title: 'Pull requests' })
    tmux.windows.add(`workdesk-d:${t}`)
    await svc.closePane('d', tab, b)
    expect(tmux.windows.size).toBe(1)
    await rm(root, { recursive: true, force: true })
  })
})

describe('Tabs of either kind', () => {
  it('adds terminal and browser Tabs with their own numbering', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workdesk-tabs-'))
    const svc = new LayoutService(root, new TerminalManager(new FakeTmux(), () => new FakePty(), () => {}))
    await svc.get('d')
    await svc.addTab('d', 'browser')
    await svc.addTab('d', 'browser')
    const l = await svc.addTab('d')
    expect(l.tabs.map((t) => [t.kind, t.name])).toEqual([['details', 'Details'], ['panes', 'Terminal'], ['panes', 'Browser 1'], ['panes', 'Browser 2'], ['panes', 'Terminal 2']])
    const browser = l.tabs[2]
    expect(browser.kind === 'panes' && browser.layout).toMatchObject({ kind: 'browser', url: DEFAULT_BROWSER_URL })
    await rm(root, { recursive: true, force: true })
  })
})

describe('Tab names', () => {
  it('follows the page title of a Browser Tab until it is renamed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workdesk-name-'))
    const svc = new LayoutService(root, new TerminalManager(new FakeTmux(), () => new FakePty(), () => {}))
    await svc.get('d')
    let l = await svc.addTab('d', 'browser')
    const tab = l.tabs[2]
    const pane = paneIds((tab as PaneTab).layout)[0]
    expect(tab.name).toBe('Browser 1')

    l = await svc.setBrowserLocation('d', tab.id, pane, 'https://github.com/o/backend', 'acme-api:   Identity')
    expect(l.tabs[2].name).toBe('acme-api: Identity')
    l = await svc.setBrowserLocation('d', tab.id, pane, 'https://x.y', 'A very long page title that does not fit into a tab')
    expect(l.tabs[2].name).toBe('A very long page title that…')
    l = await svc.setBrowserLocation('d', tab.id, pane, 'https://x.y', '')
    expect(l.tabs[2].name).toBe('A very long page title that…')

    l = await svc.renameTab('d', tab.id, 'github backend')
    expect(l.tabs[2]).toMatchObject({ name: 'github backend', autoName: false })
    l = await svc.setBrowserLocation('d', tab.id, pane, 'https://z.y', 'Another page')
    expect(l.tabs[2].name).toBe('github backend')

    l = await svc.renameTab('d', tab.id, '')
    expect(l.tabs[2]).toMatchObject({ name: 'Another page', autoName: true })
    l = await svc.setBrowserLocation('d', tab.id, pane, 'https://z.y', 'Third')
    expect(l.tabs[2].name).toBe('Third')

    // a terminal Tab needs a name
    await expect(svc.renameTab('d', l.tabs[1].id, ' ')).rejects.toThrow(/needs a name/)
    expect((await svc.renameTab('d', l.tabs[1].id, 'Server')).tabs[1]).toMatchObject({ name: 'Server', autoName: false })
    await rm(root, { recursive: true, force: true })
  })
})

describe('remembering the Tab a WorkDesk was left on', () => {
  it('keeps the active Tab per WorkDesk across restarts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workdesk-active-'))
    const mk = () => new LayoutService(root, new TerminalManager(new FakeTmux(), () => new FakePty(), () => {}))
    const first = mk()
    const a = await first.addTab('a', 'browser')
    const b = await first.get('b')
    const aTabs = a.tabs.map((t) => t.id)
    // 'a' is left on its first Terminal Tab, 'b' stays on its Details
    await first.setActiveTab('a', aTabs[1])

    const restarted = mk()
    expect((await restarted.get('a')).activeTabId).toBe(aTabs[1])
    expect((await restarted.get('b')).activeTabId).toBe(b.tabs[0].id)
    await restarted.setActiveTab('a', aTabs[2])
    expect((await mk().get('a')).activeTabId).toBe(aTabs[2])
    await rm(root, { recursive: true, force: true })
  })
})

describe('The Details Tab', () => {
  it('is always the first Tab, cannot be closed or renamed, and are added to older layouts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workdesk-details-'))
    const mk = () => new LayoutService(root, new TerminalManager(new FakeTmux(), () => new FakePty(), () => {}))
    const svc = mk()
    let l = await svc.get('d')
    expect(l.tabs.map((t) => t.kind)).toEqual(['details', 'panes'])
    // a new WorkDesk starts on its Details
    expect(l.activeTabId).toBe(l.tabs[0].id)
    l = await svc.addTab('d', 'browser')
    expect(l.tabs.slice(0, 1).map((t) => t.kind)).toEqual(['details'])
    await expect(svc.closeTab('d', l.tabs[0].id)).rejects.toThrow(/Details/)
    await expect(svc.renameTab('d', l.tabs[0].id, 'Mine')).rejects.toThrow(/Details/)

    // a layout saved before either existed, and one that only has Details
    const { mkdir, writeFile } = await import('node:fs/promises')
    const save = async (desk: string, layout: unknown) => {
      await mkdir(join(root, desk, '.workdesk'), { recursive: true })
      await writeFile(join(root, desk, '.workdesk', 'state.json'), JSON.stringify({ layout }))
    }
    await save('legacy', defaultLayout('t1', 'p1', '/x'))
    const migrated = await mk().get('legacy')
    expect(migrated.tabs.map((t) => t.kind)).toEqual(['details', 'panes'])
    expect(migrated.activeTabId).toBe('t1')
    // saved, so they keep their ids
    expect((await mk().get('legacy')).tabs.slice(0, 2).map((t) => t.id)).toEqual(migrated.tabs.slice(0, 2).map((t) => t.id))

    await save('half', defaultLayout('t2', 'p2', '/x', 'details-1'))
    expect((await mk().get('half')).tabs.map((t) => [t.kind, t.id === 'details-1'])).toEqual([['details', true], ['panes', false]])

    // a layout saved while the Editor was a Tab: the Tab goes, the others stay, and the active Tab is still valid
    const old = defaultLayout('t3', 'p3', '/x')
    const withEditor = { tabs: [...old.tabs, { kind: 'editor', id: 'e3', name: 'Editor' }], activeTabId: 'e3' }
    await save('editor', withEditor)
    const dropped = await mk().get('editor')
    expect(dropped.tabs.map((t) => t.kind)).toEqual(['details', 'panes'])
    expect(dropped.tabs.some((t) => t.id === dropped.activeTabId)).toBe(true)
    await rm(root, { recursive: true, force: true })
  })
})

describe('Resorting Tabs', () => {
  const names = (l: { tabs: { name: string }[] }) => l.tabs.map((t) => t.name)

  it('moves Tabs before or after each other, keeps Details and Todos in front, and keeps the active Tab', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workdesk-sort-'))
    const mk = () => new LayoutService(root, new TerminalManager(new FakeTmux(), () => new FakePty(), () => {}))
    const svc = mk()
    await svc.get('d')
    await svc.addTab('d', 'browser')
    let l = await svc.addTab('d')
    expect(names(l)).toEqual(['Details', 'Terminal', 'Browser 1', 'Terminal 2'])
    const id = (n: string) => l.tabs.find((t) => t.name === n)!.id
    const active = l.activeTabId

    l = await svc.moveTab('d', id('Browser 1'), id('Terminal'), false)
    expect(names(l)).toEqual(['Details', 'Browser 1', 'Terminal', 'Terminal 2'])
    l = await svc.moveTab('d', id('Browser 1'), id('Terminal 2'), true)
    expect(names(l)).toEqual(['Details', 'Terminal', 'Terminal 2', 'Browser 1'])
    l = await svc.moveTab('d', id('Terminal 2'), id('Terminal'), false)
    expect(names(l)).toEqual(['Details', 'Terminal 2', 'Terminal', 'Browser 1'])

    // dropping on a fixed Tab puts it first among the others; the fixed ones never move
    l = await svc.moveTab('d', id('Terminal'), id('Details'), true)
    expect(names(l)).toEqual(['Details', 'Terminal', 'Terminal 2', 'Browser 1'])
    l = await svc.moveTab('d', id('Browser 1'), id('Details'), false)
    expect(names(l)).toEqual(['Details', 'Browser 1', 'Terminal', 'Terminal 2'])
    await expect(svc.moveTab('d', id('Details'), id('Terminal'), true)).rejects.toThrow(/cannot be moved/)
    await expect(svc.moveTab('d', id('Details'), id('Terminal'), true)).rejects.toThrow(/cannot be moved/)
    await expect(svc.moveTab('d', 'nope', id('Terminal'), true)).rejects.toThrow(/Unknown Tab/)
    await expect(svc.moveTab('d', id('Terminal'), 'nope', true)).rejects.toThrow(/Unknown Tab/)
    // onto itself changes nothing
    expect(names(await svc.moveTab('d', id('Terminal'), id('Terminal'), true))).toEqual(names(l))

    expect(l.activeTabId).toBe(active)
    expect(names(await mk().get('d'))).toEqual(['Details', 'Browser 1', 'Terminal', 'Terminal 2'])
    await rm(root, { recursive: true, force: true })
  })
})

describe('moving a Tab in a list by branch', () => {
  it('keeps its own group, which the Tabs around it say nothing about, and the branch it was put under', () => {
    let l = defaultLayout('t1', 'p1')
    l = addTab(l, { kind: 'panes', id: 't2', name: 'Two', layout: newTerminalPane('p2'), group: 'work' })
    l = addTab(l, { kind: 'panes', id: 't3', name: 'Three', layout: newTerminalPane('p3') })
    expect((moveTab(l, 't3', 't2', false).tabs.find((t) => t.id === 't3') as PaneTab).group).toBe('work')
    expect((moveTab(l, 't2', 't3', true, true).tabs.find((t) => t.id === 't2') as PaneTab).group).toBe('work')
    expect((moveTab(l, 't3', 't2', false, true).tabs.find((t) => t.id === 't3') as PaneTab).group).toBeUndefined()
  })
})

describe('cycling through Tabs', () => {
  it('goes to the next or previous Tab and wraps around', () => {
    const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(cycleTab(tabs, 'a', 1)).toBe('b')
    expect(cycleTab(tabs, 'c', 1)).toBe('a')
    expect(cycleTab(tabs, 'a', -1)).toBe('c')
    expect(cycleTab(tabs, 'b', -1)).toBe('a')
    expect(cycleTab(tabs, 'unknown', 1)).toBe('b')
    expect(cycleTab([{ id: 'only' }], 'only', 1)).toBeUndefined()
    expect(cycleTab([], 'x', 1)).toBeUndefined()
  })
})

describe('a browser Tab that starts on a page', () => {
  it('opens the given address and becomes the active Tab', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workdesk-url-'))
    const svc = new LayoutService(root, new TerminalManager(new FakeTmux(), () => new FakePty(), () => {}))
    await svc.get('d')
    const l = await svc.addTab('d', 'browser', 'https://github.com/o/r/pull/7/files')
    const tab = l.tabs.find((t) => t.id === l.activeTabId)!
    expect(tab.kind === 'panes' && tab.layout).toMatchObject({ kind: 'browser', url: 'https://github.com/o/r/pull/7/files' })
    await rm(root, { recursive: true, force: true })
  })
})

describe('moving a Pane to another Tab', () => {
  const two = (): PaneTab => ({ kind: 'panes', id: 't1', name: 'Terminal', layout: splitPane(newTerminalPane('a'), 'a', 'horizontal', newBrowserPane('b')) })
  const other = (): PaneTab => ({ kind: 'panes', id: 't2', name: 'Terminal 2', layout: newTerminalPane('c') })

  it('makes a new Tab of it, keeping the Pane id', () => {
    const next = movePane({ tabs: [two(), other()], activeTabId: 't1' }, 't1', 'b', undefined, 'new')
    expect(next.tabs.map((t) => t.id)).toEqual(['t1', 't2', 'new'])
    expect(next.activeTabId).toBe('new')
    expect(tabPaneIds(next, 't1')).toEqual(['a'])
    expect(paneIds((next.tabs[2] as PaneTab).layout)).toEqual(['b'])
    expect(next.tabs[2]).toMatchObject({ name: 'Browser 3', autoName: true })
  })
  it('adds it next to the Panes of another Tab, and a Tab left empty goes away', () => {
    const next = movePane({ tabs: [other(), { kind: 'panes', id: 't3', name: 'x', layout: newTerminalPane('d') }], activeTabId: 't2' }, 't3', 'd', 't2', 'n')
    expect(next.tabs.map((t) => t.id)).toEqual(['t2'])
    expect(tabPaneIds(next, 't2')).toEqual(['c', 'd'])
    expect(next.activeTabId).toBe('t2')
  })
  it('leaves a lone Pane alone when it would only get a new Tab', () => {
    const layout = { tabs: [other()], activeTabId: 't2' }
    expect(movePane(layout, 't2', 'c', undefined, 'n')).toBe(layout)
  })
})

describe('dropping a Tab on a Pane of another Tab', () => {
  const a = (): PaneTab => ({ kind: 'panes', id: 't1', name: 'Terminal', layout: splitPane(newTerminalPane('a'), 'a', 'horizontal', newTerminalPane('b')) })
  const c = (): PaneTab => ({ kind: 'panes', id: 't2', name: 'Browser', layout: newBrowserPane('c', 'https://x.test') })
  const layout = () => ({ tabs: [{ kind: 'details' as const, id: 'd', name: 'Details' }, a(), c()], activeTabId: 't2' })

  it('puts what the Tab shows beside the Pane, drops the Tab, and shows the Tab that was dropped on', () => {
    const next = mergeTab(layout(), 't2', 't1', 'b', 'horizontal', false)
    expect(next.tabs.map((t) => t.id)).toEqual(['d', 't1'])
    expect(paneIds((next.tabs[1] as PaneTab).layout)).toEqual(['a', 'b', 'c'])
    expect(next.activeTabId).toBe('t1')
  })
  it('splits the other way and puts it first when dropped above or to the left', () => {
    const above = mergeTab(layout(), 't2', 't1', 'a', 'vertical', true)
    const root = (above.tabs[1] as PaneTab).layout
    expect(root.type === 'split' && root.direction).toBe('horizontal')
    expect(paneIds(root)).toEqual(['c', 'a', 'b'])
    const left = mergeTab(layout(), 't2', 't1', 'a', 'horizontal', true)
    expect(paneIds((left.tabs[1] as PaneTab).layout)).toEqual(['c', 'a', 'b'])
  })
  it('keeps a Tab with several Panes together, and refuses a Pane that is not there', () => {
    const next = mergeTab({ ...layout(), activeTabId: 't1' }, 't1', 't2', 'c', 'vertical', false)
    expect(paneIds((next.tabs[1] as PaneTab).layout)).toEqual(['c', 'a', 'b'])
    expect(() => mergeTab(layout(), 't2', 't1', 'zzz', 'horizontal', false)).toThrow()
    const same = layout()
    expect(mergeTab(same, 't1', 't1', 'a', 'horizontal', false)).toBe(same)
  })
})

describe('the order of the search engines', () => {
  it('is Startpage first until it is sorted, drops what is unknown and appends what is missing', () => {
    expect(orderEngines().map((e) => e.id)[0]).toBe('startpage')
    expect(orderEngines(['google', 'nope', 'bing', 'google']).map((e) => e.id).slice(0, 3)).toEqual(['google', 'bing', 'startpage'])
    expect(orderEngines(['google']).map((e) => e.id)).toHaveLength(7)
  })
  it('moves one engine to a place', () => {
    expect(moveEngine(['a', 'b', 'c'] as never, 'c' as never, 0)).toEqual(['c', 'a', 'b'])
    expect(moveEngine(['a', 'b', 'c'] as never, 'a' as never, 2)).toEqual(['b', 'c', 'a'])
    expect(moveEngine(['a', 'b'] as never, 'a' as never, 9)).toEqual(['b', 'a'])
  })
})

describe('duplicating a Tab with pages', () => {
  it('copies the Tab right after it with new Pane ids and the same pages, and shows the copy', () => {
    let n = 0
    const tab: PaneTab = { kind: 'panes', id: 't1', name: 'Pages', layout: splitPane(newTerminalPane('a', '/work'), 'a', 'horizontal', { ...newBrowserPane('b', 'https://x.test'), hibernated: true }) }
    const layout = { tabs: [{ kind: 'details' as const, id: 'd', name: 'Details' }, tab, { kind: 'panes' as const, id: 't2', name: 'Other', layout: newTerminalPane('c') }], activeTabId: 't2' }
    const next = duplicateTab(layout, 't1', 'copy', () => `n${++n}`)
    expect(next.tabs.map((t) => t.id)).toEqual(['d', 't1', 'copy', 't2'])
    expect(next.activeTabId).toBe('copy')
    const copy = next.tabs[2] as PaneTab
    expect(paneIds(copy.layout)).toEqual(['n1', 'n2'])
    expect(findPane(copy.layout, 'n2')).toMatchObject({ kind: 'browser', url: 'https://x.test' })
    expect(findPane(copy.layout, 'n2')).not.toMatchObject({ hibernated: true })
    expect(findPane(copy.layout, 'n1')).toMatchObject({ kind: 'terminal', cwd: '/work' })
    expect(paneIds(tab.layout)).toEqual(['a', 'b'])
    expect(() => duplicateTab(layout, 'd', 'x', () => 'y')).toThrow()
  })
})

describe('dropping a Pane beside another Pane', () => {
  const t1 = (): PaneTab => ({ kind: 'panes', id: 't1', name: 'One', layout: splitPane(newTerminalPane('a'), 'a', 'horizontal', newBrowserPane('b', 'https://x.test')) })
  const t2 = (): PaneTab => ({ kind: 'panes', id: 't2', name: 'Two', layout: newTerminalPane('c') })
  const layout = () => ({ tabs: [t1(), t2()], activeTabId: 't1' })

  it('takes the Pane out of its Tab and puts it beside the other one, in another Tab', () => {
    const next = movePaneBeside(layout(), 't1', 'b', 't2', 'c', 'vertical', true)
    expect(paneIds((next.tabs[0] as PaneTab).layout)).toEqual(['a'])
    expect(paneIds((next.tabs[1] as PaneTab).layout)).toEqual(['b', 'c'])
    expect(next.activeTabId).toBe('t2')
    const root = (next.tabs[1] as PaneTab).layout
    expect(root.type === 'split' && root.direction).toBe('vertical')
  })
  it('re-arranges inside one Tab', () => {
    const next = movePaneBeside(layout(), 't1', 'b', 't1', 'a', 'horizontal', true)
    expect(paneIds((next.tabs[0] as PaneTab).layout)).toEqual(['b', 'a'])
    expect(next.tabs).toHaveLength(2)
  })
  it('lets a Tab that is left empty go, and ignores a Pane dropped on itself', () => {
    const next = movePaneBeside(layout(), 't2', 'c', 't1', 'a', 'horizontal', false)
    expect(next.tabs.map((t) => t.id)).toEqual(['t1'])
    expect(paneIds((next.tabs[0] as PaneTab).layout)).toEqual(['a', 'c', 'b'])
    const same = layout()
    expect(movePaneBeside(same, 't1', 'a', 't1', 'a', 'horizontal', false)).toBe(same)
    expect(() => movePaneBeside(layout(), 't1', 'a', 't2', 'zzz', 'horizontal', false)).toThrow()
  })
})

describe('File Panes', () => {
  it('remember which file they show, and a Tab with only that Pane knows its path', () => {
    const pane = newFilePane('f1')
    expect(pane).toEqual({ type: 'pane', id: 'f1', kind: 'file' })
    const shown = setFileLocation(pane, 'f1', '/work/a.ts', 12)
    expect(shown).toMatchObject({ kind: 'file', path: '/work/a.ts', line: 12 })
    expect(singleFilePath({ layout: shown })).toBe('/work/a.ts')
    // another file without a line forgets the line; no path shows the file tree again
    expect(setFileLocation(shown, 'f1', '/work/b.ts')).toEqual({ type: 'pane', id: 'f1', kind: 'file', path: '/work/b.ts' })
    expect(setFileLocation(shown, 'f1', undefined)).toEqual({ type: 'pane', id: 'f1', kind: 'file' })
    expect(setFileLocation(shown, 'other', '/x')).toBe(shown)
    expect(singleFilePath({ layout: splitPane(shown, 'f1', 'horizontal', newTerminalPane('t')) })).toBeUndefined()
  })

  it('open in a Tab of their own, named after the file; the same file again shows its Tab; a Pane can be split off', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workdesk-file-'))
    const svc = new LayoutService(root, new TerminalManager(new FakeTmux(), () => new FakePty(), () => {}))
    await svc.get('d')
    const first = await svc.addTab('d', 'file', '/work/src/index.ts')
    const tab = first.tabs.find((t) => t.id === first.activeTabId)!
    expect(tab).toMatchObject({ name: 'index.ts', autoName: true })
    await svc.addTab('d')
    const again = await svc.addTab('d', 'file', '/work/src/index.ts')
    expect(again.activeTabId).toBe(first.activeTabId)
    expect(again.tabs.filter((t) => t.kind === 'panes' && singleFilePath(t))).toHaveLength(1)
    // showing another file renames a Tab that follows its file
    const moved = await svc.setFileLocation('d', tab.id, paneIds((tab as PaneTab).layout)[0], '/work/README.md')
    expect(moved.tabs.find((t) => t.id === tab.id)).toMatchObject({ name: 'README.md' })
    const split = await svc.splitPane('d', tab.id, paneIds((tab as PaneTab).layout)[0], 'horizontal', 'file')
    expect(paneIds((split.tabs.find((t) => t.id === tab.id) as PaneTab).layout, 'file')).toHaveLength(2)
    await rm(root, { recursive: true, force: true })
  })
})

describe('pinned Tabs', () => {
  const tab = (id: string, layout: PaneTab['layout'] = newTerminalPane(id + 'p')): PaneTab => ({ kind: 'panes', id, name: id.toUpperCase(), layout })
  const base = () => ({ tabs: [{ kind: 'details' as const, id: 'd', name: 'Details' }, tab('a'), tab('b'), tab('c')], activeTabId: 'a' })
  const ids = (l: { tabs: { id: string }[] }) => l.tabs.map((t) => t.id)

  it('go right after Details, in the order they were pinned, and an unpinned Tab is the first of the others', () => {
    const one = togglePin(base(), 'c')
    expect(ids(one)).toEqual(['d', 'c', 'a', 'b'])
    const two = togglePin(one, 'b')
    expect(ids(two)).toEqual(['d', 'c', 'b', 'a'])
    expect((two.tabs[1] as PaneTab).pinned).toBe(true)
    const back = togglePin(two, 'c')
    expect(ids(back)).toEqual(['d', 'b', 'c', 'a'])
    expect('pinned' in back.tabs[2]).toBe(false)
    expect(() => togglePin(base(), 'd')).toThrow(/Panes/)
  })

  it('cannot be closed, and stay among the pinned ones when dragged', () => {
    const l = togglePin(togglePin(base(), 'a'), 'b')
    expect(() => closeTabOp(l, 'a')).toThrow(/Unpin/)
    expect(ids(closeTabOp(l, 'c'))).toEqual(['d', 'a', 'b'])
    // an open Tab dropped before a pinned one, and a pinned one after an open one, snap back
    expect(ids(moveTab(l, 'c', 'a', false))).toEqual(['d', 'a', 'b', 'c'])
    expect(ids(moveTab(l, 'a', 'c', true))).toEqual(['d', 'b', 'a', 'c'])
  })

  it('are summed up for the left panel: an icon by what they show, the favicon of a page', () => {
    const l = {
      tabs: [
        { kind: 'details' as const, id: 'd', name: 'Details' },
        { ...tab('t'), pinned: true },
        { ...tab('w', { ...newBrowserPane('w1', 'https://x.test'), favicon: 'data:image/png;base64,AA' }), pinned: true },
        { ...tab('f', newFilePane('f1', '/x/a.ts')), pinned: true },
        { ...tab('m', splitPane(newTerminalPane('m1'), 'm1', 'horizontal', newBrowserPane('m2'))), pinned: true },
        tab('open')
      ],
      activeTabId: 't'
    }
    expect(pinnedTabs(l)).toEqual([
      { tabId: 't', name: 'T', icon: 'terminal' },
      { tabId: 'w', name: 'W', icon: 'browser', favicon: 'data:image/png;base64,AA' },
      { tabId: 'f', name: 'F', icon: 'file' },
      { tabId: 'm', name: 'M', icon: 'terminal' }
    ])
  })

  it('are kept by the service: not closed with their last Pane, listed per WorkDesk, announced when they change, and a copy is not pinned', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workdesk-pin-'))
    const svc = new LayoutService(root, new TerminalManager(new FakeTmux(), () => new FakePty(), () => {}))
    let told = 0
    svc.onPinsChanged = () => told++
    const first = await svc.get('d')
    const terminal = first.tabs.find((t) => t.kind === 'panes')!
    const pinned = await svc.togglePin('d', terminal.id)
    expect((pinned.tabs.find((t) => t.id === terminal.id) as PaneTab).pinned).toBe(true)
    expect(told).toBeGreaterThan(0)
    const before = told
    await svc.addTab('d', 'browser')
    expect(told).toBe(before)
    await expect(svc.closePane('d', terminal.id, paneIds((terminal as PaneTab).layout)[0])).rejects.toThrow(/Unpin/)
    await expect(svc.closeTab('d', terminal.id)).rejects.toThrow(/Unpin/)
    expect(Object.keys(await svc.pins(['d', 'never-opened']))).toEqual(['d'])
    const copied = await svc.duplicateTab('d', terminal.id)
    expect(copied.tabs.filter((t) => t.kind === 'panes' && t.pinned)).toHaveLength(1)
    await svc.togglePin('d', terminal.id)
    expect(await svc.pins(['d'])).toEqual({})
    await rm(root, { recursive: true, force: true })
  })
})

describe('the name of a Tab in full', () => {
  const page = (title: string, over: object = {}): PaneTab => ({ kind: 'panes', id: 't', name: 'Release v0.2.14 🚀 · spheri…', layout: { ...newBrowserPane('p', 'https://x.test'), title }, ...over })
  it('is the whole page title for a Tab that follows its page, else its name', () => {
    expect(fullTabName(page('Release v0.2.14 🚀 · acme/acme-api  ', { autoName: true }))).toBe('Release v0.2.14 🚀 · acme/acme-api')
    // renamed by hand: the name stays
    expect(fullTabName(page('Whole title', { autoName: false, name: 'Mine' }))).toBe('Mine')
    expect(fullTabName({ kind: 'panes', id: 't', name: 'Terminal 1', autoName: true, layout: newTerminalPane('a') })).toBe('Terminal 1')
    expect(fullTabName(page('', { autoName: true }))).toBe('Release v0.2.14 🚀 · spheri…')
  })
})

describe('the Panes of a Tab, listed', () => {
  it('are named by what they show, in the order of the layout', () => {
    const layout = splitPane(
      splitPane(newTerminalPane('t', '/work/api/'), 't', 'horizontal', { ...newBrowserPane('b', 'https://github.com/o/r/pull/1'), title: 'Fix  login\nredirect' }),
      'b',
      'vertical',
      newFilePane('f', '/work/notes/todo.md')
    )
    expect(paneSummaries({ kind: 'panes', id: 'x', name: 'X', layout })).toEqual([
      { paneId: 't', kind: 'terminal', label: 'Terminal' },
      { paneId: 'b', kind: 'browser', label: 'Fix login redirect' },
      { paneId: 'f', kind: 'file', label: 'todo.md' }
    ])
  })
  it('have a plain name when nothing says more', () => {
    const layout = splitPane(splitPane(newTerminalPane('t'), 't', 'horizontal', newBrowserPane('b', 'about:blank')), 'b', 'horizontal', newFilePane('f'))
    expect(paneSummaries({ kind: 'panes', id: 'x', name: 'X', layout }).map((p) => p.label)).toEqual(['Terminal', 'Browser', 'File'])
    expect(paneSummaries({ kind: 'panes', id: 'y', name: 'Y', layout: { ...newBrowserPane('p', 'https://docs.test/a') } }).map((p) => p.label)).toEqual(['docs.test'])
  })
})

describe('bringing back what was closed', () => {
  it('reopens the last closed Tab on its page, and a closed Pane beside the one it was next to, newest first', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workdesk-reopen-'))
    const svc = new LayoutService(root, new TerminalManager(new FakeTmux(), () => new FakePty(), () => {}))
    const first = await svc.get('d')
    const terminal = first.tabs.find((t) => t.kind === 'panes')!
    const withPage = await svc.addTab('d', 'browser', 'https://example.com/x')
    const pageTab = withPage.tabs.find((t) => t.id === withPage.activeTabId) as PaneTab
    // nothing closed yet: nothing changes
    expect(await svc.reopenClosed('d')).toEqual(withPage)
    await svc.closeTab('d', pageTab.id)
    // a Pane closed out of a split
    const termPane = paneIds((terminal as PaneTab).layout)[0]
    const split = await svc.splitPane('d', terminal.id, termPane, 'horizontal', 'browser', false, 'https://docs.test')
    const extra = paneIds((split.tabs.find((t) => t.id === terminal.id) as PaneTab).layout, 'browser')[0]
    await svc.closePane('d', terminal.id, extra)
    const back = await svc.reopenClosed('d')
    expect(paneIds((back.tabs.find((t) => t.id === terminal.id) as PaneTab).layout, 'browser')).toHaveLength(1)
    const again = await svc.reopenClosed('d')
    const revived = again.tabs.find((t) => t.kind === 'panes' && t.id === again.activeTabId) as PaneTab
    expect(revived.layout).toMatchObject({ kind: 'browser', url: 'https://example.com/x' })
    expect(revived.id).not.toBe(pageTab.id)
    // nothing left to bring back
    expect(await svc.reopenClosed('d')).toEqual(again)
    await rm(root, { recursive: true, force: true })
  })
})

describe('groups of Tabs', () => {
  const tab = (id: string): PaneTab => ({ kind: 'panes', id, name: id.toUpperCase(), layout: newTerminalPane(id + 'p') })
  const base = () => ({ tabs: [{ kind: 'details' as const, id: 'd', name: 'Details' }, tab('a'), tab('b'), tab('c'), tab('e')], activeTabId: 'a' })
  const ids = (l: { tabs: { id: string }[] }) => l.tabs.map((t) => t.id)

  it('keep their Tabs together, after the Tabs without a group, in the order the groups began', () => {
    let l = setTabGroup(base(), 'a', ' research ')
    expect(ids(l)).toEqual(['d', 'b', 'c', 'e', 'a'])
    l = setTabGroup(l, 'c', 'prs')
    l = setTabGroup(l, 'e', 'research')
    expect(ids(l)).toEqual(['d', 'b', 'e', 'a', 'c'])
    expect((l.tabs[2] as PaneTab).group).toBe('research')
    // out of its group again
    l = setTabGroup(l, 'a', '  ')
    expect(ids(l)).toEqual(['d', 'b', 'a', 'e', 'c'])
    expect('group' in l.tabs[2]).toBe(false)
    expect(() => setTabGroup(base(), 'd', 'x')).toThrow()
  })
  it('are left when a Tab is pinned, and pinned Tabs stay in front', () => {
    const l = togglePin(setTabGroup(base(), 'c', 'prs'), 'c')
    expect(ids(l)).toEqual(['d', 'c', 'a', 'b', 'e'])
    expect('group' in l.tabs[1]).toBe(false)
  })
})

describe('dragging tabs and groups in a list of tabs', () => {
  const tab = (id: string, group?: string): PaneTab => ({ kind: 'panes', id, name: id.toUpperCase(), layout: newTerminalPane(id + 'p'), ...(group ? { group } : {}) })
  const base = () => ({ tabs: [{ kind: 'details' as const, id: 'd', name: 'Details' }, tab('a'), tab('b'), tab('x', 'prs'), tab('y', 'prs'), tab('r', 'research')], activeTabId: 'a' })
  const ids = (l: { tabs: { id: string }[] }) => l.tabs.map((t) => t.id)
  const group = (l: { tabs: { id: string }[] }, id: string) => (l.tabs.find((t) => t.id === id) as PaneTab).group

  it('a Tab dropped on a Tab of a group joins it; among the Tabs without a group it leaves', () => {
    const joined = moveTab(base(), 'a', 'y', false)
    expect(group(joined, 'a')).toBe('prs')
    expect(ids(joined)).toEqual(['d', 'b', 'x', 'a', 'y', 'r'])
    const left = moveTab(base(), 'x', 'b', true)
    expect(group(left, 'x')).toBeUndefined()
    expect(ids(left)).toEqual(['d', 'a', 'b', 'x', 'y', 'r'])
  })
  it('a Tab dropped on the heading of a group is its last Tab; an empty name leaves the group', () => {
    const l = moveTabToGroup(base(), 'a', 'prs')
    expect(ids(l)).toEqual(['d', 'b', 'x', 'y', 'a', 'r'])
    expect(group(l, 'a')).toBe('prs')
    expect(group(moveTabToGroup(l, 'x', ''), 'x')).toBeUndefined()
    expect(() => moveTabToGroup(togglePin(base(), 'a'), 'a', 'prs')).toThrow(/pinned/)
  })
  it('a group moves before or after another group, all its Tabs together', () => {
    expect(ids(moveGroup(base(), 'research', 'prs', false))).toEqual(['d', 'a', 'b', 'r', 'x', 'y'])
    expect(ids(moveGroup(base(), 'prs', 'research', true))).toEqual(['d', 'a', 'b', 'r', 'x', 'y'])
    expect(ids(moveGroup(base(), 'prs', 'prs', true))).toEqual(ids(base()))
    expect(ids(moveGroup(base(), 'nope', 'prs', true))).toEqual(ids(base()))
  })
})
