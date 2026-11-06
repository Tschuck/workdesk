import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { RunningSummary } from './terminal/tmux-admin'

/** What to do with the terminals when the app quits. */
export type QuitBehavior = 'ask' | 'keep' | 'stop'

/** Which parts at the bottom of the left panel are open; a closed one stops what it watches. */
export interface SidebarPanels {
  activity: boolean
  claude: boolean
  performance: boolean
  /** the parts of the left panel that list the WorkDesks */
  desks: boolean
  waiting: boolean
  planned: boolean
  postponed: boolean
  closable: boolean
}

export const OPEN_PANELS: SidebarPanels = { activity: true, claude: true, performance: true, desks: true, waiting: true, planned: true, postponed: false, closable: true }

export interface AppSettings {
  quit: QuitBehavior
  panels: SidebarPanels
  /** the pages visited in the browser are remembered, for suggestions */
  history: boolean
  /** the pages visited are forgotten after this many days; 0 keeps them */
  historyDays: number
}

/** Small settings of the app itself (not of your work), in the app's user data folder. */
export class Settings {
  private value: AppSettings = { quit: 'ask', panels: { ...OPEN_PANELS }, history: true, historyDays: 0 }

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      const j = JSON.parse(await readFile(this.file, 'utf8')) as Partial<AppSettings>
      if (j.quit === 'ask' || j.quit === 'keep' || j.quit === 'stop') this.value.quit = j.quit
      if (typeof j.history === 'boolean') this.value.history = j.history
      if (Number.isInteger(j.historyDays) && j.historyDays! >= 0 && j.historyDays! <= 3650) this.value.historyDays = j.historyDays!
      for (const k of Object.keys(OPEN_PANELS) as (keyof SidebarPanels)[]) if (typeof j.panels?.[k] === 'boolean') this.value.panels[k] = j.panels[k]
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err
    }
  }

  get quit(): QuitBehavior {
    return this.value.quit
  }

  get panels(): SidebarPanels {
    return { ...this.value.panels }
  }

  get history(): boolean {
    return this.value.history
  }

  get historyDays(): number {
    return this.value.historyDays
  }

  async setHistoryDays(days: number): Promise<void> {
    this.value = { ...this.value, historyDays: Number.isInteger(days) && days >= 0 && days <= 3650 ? days : 0 }
    await this.save()
  }

  async setHistory(history: boolean): Promise<void> {
    this.value = { ...this.value, history }
    await this.save()
  }

  async setQuit(quit: QuitBehavior): Promise<void> {
    this.value = { ...this.value, quit }
    await this.save()
  }

  async setPanels(patch: Partial<SidebarPanels>): Promise<SidebarPanels> {
    const next = { ...this.value.panels }
    for (const k of Object.keys(OPEN_PANELS) as (keyof SidebarPanels)[]) if (typeof patch[k] === 'boolean') next[k] = patch[k]
    this.value = { ...this.value, panels: next }
    await this.save()
    return this.panels
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(this.value, null, 2) + '\n')
  }
}

export type QuitChoice = { action: 'keep' | 'stop' | 'cancel'; remember: boolean }

export interface QuitDeps {
  settings: Pick<Settings, 'quit' | 'setQuit'>
  running: () => Promise<RunningSummary>
  /** ask the user what to do with the terminals that are still running */
  ask: (running: RunningSummary) => Promise<QuitChoice>
  /** end the tmux server and everything in it */
  stopAll: () => Promise<void>
}

/**
 * Quitting the app leaves the terminals (and Claude in them) running in tmux, which is what you want for long
 * runs. This decides, once, whether to ask, keep them or stop them, and carries it out.
 */
export class QuitController {
  constructor(private readonly d: QuitDeps) {}

  /** `forced` is the explicit "Quit and Stop Terminals" menu item: no question. */
  async decide(forced?: 'stop'): Promise<'quit' | 'cancel'> {
    if (forced === 'stop') {
      await this.d.stopAll()
      return 'quit'
    }
    const behavior = this.d.settings.quit
    if (behavior === 'keep') return 'quit'
    if (behavior === 'stop') {
      await this.d.stopAll()
      return 'quit'
    }
    const running = await this.d.running()
    if (running.terminals === 0) return 'quit'
    const choice = await this.d.ask(running)
    if (choice.action === 'cancel') return 'cancel'
    if (choice.remember) await this.d.settings.setQuit(choice.action)
    if (choice.action === 'stop') await this.d.stopAll()
    return 'quit'
  }
}

/** The text of the question. */
export function describeRunning(r: RunningSummary): string {
  const terminals = `${r.terminals} terminal${r.terminals === 1 ? ' is' : 's are'} open`
  const programs = r.programs.length > 0 ? `, running ${r.programs.join(', ')}` : ''
  return `${terminals}${programs}.`
}
