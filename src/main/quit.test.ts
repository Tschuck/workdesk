import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeRunning, QuitController, Settings, type QuitChoice } from './quit'
import { createTmux } from './terminal/tmux'
import { createTmuxAdmin, runningIn, summarize } from './terminal/tmux-admin'

describe('what is running', () => {
  it('counts WorkDesk terminals and the programs in them, not views or the usage reader', () => {
    const s = summarize([
      { session: 'workdesk-a', command: 'zsh', window: 'p1' },
      { session: 'workdesk-a', command: 'claude', window: 'p2' },
      { session: 'workdesk-b', command: 'node', window: 'p3' },
      { session: 'workdesk-view-a-p1', command: 'claude', window: 'p1' },
      { session: '_workdesk-usage', command: 'claude', window: 'x' },
      { session: 'workdesk-c', command: 'zsh', window: 'p4' }
    ])
    expect(s).toEqual({ terminals: 4, programs: ['claude', 'node'] })
    expect(summarize([])).toEqual({ terminals: 0, programs: [] })
  })

  it('lists the programs running in given Panes only, shells and views not counted', () => {
    const panes = [
      { session: 'workdesk-a', command: 'zsh', window: 'p1' },
      { session: 'workdesk-a', command: 'claude', window: 'p2' },
      { session: 'workdesk-a', command: 'node', window: 'p3' },
      { session: 'workdesk-view-a-p2', command: 'claude', window: 'p2' }
    ]
    expect(runningIn(panes, ['p1'])).toEqual([])
    expect(runningIn(panes, ['p1', 'p2'])).toEqual(['claude'])
    expect(runningIn(panes, ['p2', 'p3'])).toEqual(['claude', 'node'])
    expect(runningIn(panes, [])).toEqual([])
  })

  it('words the question', () => {
    expect(describeRunning({ terminals: 3, programs: ['claude', 'node'] })).toBe('3 terminals are open, running claude, node.')
    expect(describeRunning({ terminals: 1, programs: [] })).toBe('1 terminal is open.')
  })
})

describe('quitting', () => {
  let stopped: number
  let asked: number
  let saved: string[]
  let behavior: 'ask' | 'keep' | 'stop'
  let terminals: number
  let choice: QuitChoice
  let controller: QuitController

  beforeEach(() => {
    stopped = 0
    asked = 0
    saved = []
    behavior = 'ask'
    terminals = 2
    choice = { action: 'keep', remember: false }
    controller = new QuitController({
      settings: { get quit() { return behavior }, setQuit: async (q) => void (saved.push(q), (behavior = q)) },
      running: async () => ({ terminals, programs: ['claude'] }),
      ask: async () => (asked++, choice),
      stopAll: async () => void stopped++
    })
  })

  it('asks when terminals are running and leaves them running when you keep them', async () => {
    expect(await controller.decide()).toBe('quit')
    expect(asked).toBe(1)
    expect(stopped).toBe(0)
  })

  it('stops everything when you choose to, and can remember either choice', async () => {
    choice = { action: 'stop', remember: true }
    expect(await controller.decide()).toBe('quit')
    expect(stopped).toBe(1)
    expect(saved).toEqual(['stop'])
    // remembered: no question, same result
    expect(await controller.decide()).toBe('quit')
    expect(asked).toBe(1)
    expect(stopped).toBe(2)

    behavior = 'keep'
    expect(await controller.decide()).toBe('quit')
    expect(asked).toBe(1)
    expect(stopped).toBe(2)
  })

  it('does not ask when nothing is running, and cancels without changing anything', async () => {
    terminals = 0
    expect(await controller.decide()).toBe('quit')
    expect(asked).toBe(0)

    terminals = 2
    choice = { action: 'cancel', remember: true }
    expect(await controller.decide()).toBe('cancel')
    expect(saved).toEqual([])
    expect(stopped).toBe(0)
  })

  it('"Quit and Stop Terminals" never asks', async () => {
    expect(await controller.decide('stop')).toBe('quit')
    expect(asked).toBe(0)
    expect(stopped).toBe(1)
  })
})

describe('app settings', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'workdesk-settings-')) })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('asks by default, remembers a choice and ignores a damaged file', async () => {
    const file = join(dir, 'sub', 'settings.json')
    const s = new Settings(file)
    await s.load()
    expect(s.quit).toBe('ask')
    await s.setQuit('keep')
    const again = new Settings(file)
    await again.load()
    expect(again.quit).toBe('keep')
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ quit: 'keep' })

    await writeFile(file, '{ nope')
    const broken = new Settings(file)
    await broken.load()
    expect(broken.quit).toBe('ask')
  })

  it('remembers whether the visited pages are kept, over a restart', async () => {
    const file = join(dir, 'settings.json')
    const s = new Settings(file)
    await s.load()
    expect(s.history).toBe(true)
    await s.setHistory(false)
    const again = new Settings(file)
    await again.load()
    expect(again.history).toBe(false)
  })

  it('remembers which parts of the left panel are closed, over a restart', async () => {
    const file = join(dir, 'settings.json')
    const s = new Settings(file)
    await s.load()
    expect(s.panels).toEqual({ activity: true, claude: true, performance: true, desks: true, waiting: true, planned: true, postponed: false, closable: true })
    await s.setPanels({ claude: false, performance: false, postponed: true, activity: 'x' as never })
    const again = new Settings(file)
    await again.load()
    expect(again.panels).toEqual({ activity: true, claude: false, performance: false, desks: true, waiting: true, planned: true, postponed: true, closable: true })
  })
})

const hasTmux = (() => { try { execFileSync('tmux', ['-V']); return true } catch { return false } })()
describe.skipIf(!hasTmux)('stopping the real tmux server', () => {
  it('lists the panes of a throw-away server and ends everything in it', async () => {
    const socket = `workdesk-quit-test-${process.pid}`
    const tmux = createTmux(socket)
    const admin = createTmuxAdmin(socket)
    try {
      expect(await admin.panes()).toEqual([])
      await tmux.ensureWindow('workdesk-demo', 'p1', tmpdir(), 'sleep 60')
      await tmux.ensureWindow('workdesk-demo', 'p2', tmpdir())
      const panes = await admin.panes()
      expect(panes.map((p) => p.session)).toEqual(['workdesk-demo', 'workdesk-demo'])
      expect(summarize(panes)).toMatchObject({ terminals: 2, programs: ['sleep'] })
      await admin.killServer()
      expect(await admin.panes()).toEqual([])
      // stopping again when nothing runs is fine
      await admin.killServer()
    } finally {
      try { execFileSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' }) } catch { /* already gone */ }
    }
  })
})

describe('history days setting', () => {
  it('is kept over a restart and refuses nonsense', async () => {
    const dir2 = await mkdtemp(join(tmpdir(), 'wd-set-'))
    const file = join(dir2, 'settings.json')
    const s = new Settings(file)
    await s.load()
    expect(s.historyDays).toBe(0)
    await s.setHistoryDays(30)
    const again = new Settings(file)
    await again.load()
    expect(again.historyDays).toBe(30)
    await again.setHistoryDays(-5)
    expect(again.historyDays).toBe(0)
    await rm(dir2, { recursive: true, force: true })
  })
})
