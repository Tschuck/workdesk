import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppState } from '../shared/api'
import type { WorkDeskService } from './service'
import { sessionName } from './terminal/manager'
import type { PaneInfo } from './terminal/tmux-admin'

/** What is running in one WorkDesk, and what parking it would not bring back. */
export interface DeskRunning {
  deskId: string
  name: string
  terminals: number
  /** programs other than a shell prompt, e.g. claude or a dev server */
  programs: string[]
  /** Claude is running in a pane that has no recorded session, so it cannot be resumed after parking */
  claudeWithoutSession: number
}

export interface ParkAllDeps {
  service: WorkDeskService
  root: string
  panes: () => Promise<PaneInfo[]>
  /** `claude --resume …` for a Pane that had a Claude session recorded */
  resumeCommand: (deskId: string, paneId: string) => Promise<string | undefined>
  /** stop terminals and close the editor of a WorkDesk */
  shutDown: (deskId: string) => Promise<void>
}

const SHELLS = new Set(['zsh', 'bash', 'fish', 'sh', 'dash', 'ksh', 'tcsh', 'login', '-zsh', '-bash'])
const isClaude = (command: string): boolean => /(^|\/)claude$/.test(command) || /^\d+\.\d+\.\d+$/.test(command)

/**
 * Park every WorkDesk, e.g. before restarting the machine, and bring them all back afterwards. Parking keeps
 * Tabs, notes and branches, and Claude sessions are resumed when a pane is shown again; the WorkDesk that was
 * open is remembered, so it opens again too.
 */
export class ParkAll {
  private readonly file: string

  constructor(private readonly d: ParkAllDeps) {
    this.file = join(d.root, '.workdesk-parked.json')
  }

  /** the WorkDesks that are running (not parked, not planned), or only those of `ids` */
  private running(ids?: readonly string[]) {
    return this.d.service.getState().desks.filter((x) => x.presence !== 'parked' && x.presence !== 'planned' && (!ids || ids.includes(x.id)))
  }

  /** What would end, per WorkDesk that is not parked yet (of `ids`, when given). */
  async preflight(ids?: readonly string[]): Promise<DeskRunning[]> {
    const panes = await this.d.panes()
    const result: DeskRunning[] = []
    for (const desk of this.running(ids)) {
      const own = panes.filter((p) => p.session === sessionName(desk.id))
      let claudeWithoutSession = 0
      for (const p of own.filter((x) => isClaude(x.command))) {
        if (!(await this.d.resumeCommand(desk.id, p.window))) claudeWithoutSession++
      }
      result.push({
        deskId: desk.id,
        name: desk.name,
        terminals: own.length,
        programs: [...new Set(own.map((p) => p.command).filter((c) => c && !SHELLS.has(c)))].sort(),
        claudeWithoutSession
      })
    }
    return result
  }

  /** Park every running WorkDesk, or only those of `ids` (the waiting ones): the open one is then not remembered for Reactivate all. */
  async parkAll(ids?: readonly string[]): Promise<AppState> {
    const desks = this.d.service.getState().desks
    const active = desks.find((x) => x.presence === 'active')
    if (active && !ids) {
      await mkdir(this.d.root, { recursive: true })
      await writeFile(this.file, JSON.stringify({ active: active.id }) + '\n')
    }
    for (const desk of this.running(ids)) {
      await this.d.shutDown(desk.id)
      await this.d.service.parkDesk(desk.id)
    }
    return this.d.service.getState()
  }

  /** All parked WorkDesks (or only those of `ids`) become inactive again; without `ids` the one that was open is opened too. */
  async reactivateAll(ids?: readonly string[]): Promise<{ state: AppState; opened?: string }> {
    for (const desk of this.d.service.getState().desks.filter((x) => x.presence === 'parked' && (!ids || ids.includes(x.id)))) {
      await this.d.service.reactivateDesk(desk.id)
    }
    if (ids) return { state: this.d.service.getState() }
    let opened: string | undefined
    try {
      const remembered = (JSON.parse(await readFile(this.file, 'utf8')) as { active?: string }).active
      if (remembered && this.d.service.getState().desks.some((x) => x.id === remembered)) {
        await this.d.service.activateDesk(remembered)
        opened = remembered
      }
    } catch {
      // nothing remembered
    }
    await rm(this.file, { force: true })
    return { state: this.d.service.getState(), opened }
  }

  /** Whether a "park all" is waiting to be undone. */
  async remembered(): Promise<boolean> {
    return readFile(this.file, 'utf8').then(() => true, () => false)
  }
}
