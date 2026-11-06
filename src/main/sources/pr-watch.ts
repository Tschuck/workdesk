import { prReadiness, type PrTodoState, type Readiness } from '../domain/prs'
import type { WorkDesk } from '../domain/types'
import type { WorkDeskService } from '../service'
import type { WatchedPrState } from './github/api'

export type PrTodoStates = Record<string, PrTodoState>

/** A Pull Request a WorkDesk is about. */
export interface WatchedPr {
  /** `owner/repo#number` */
  id: string
  deskId: string
  title: string
}

export interface PrWatchDeps {
  service: WorkDeskService
  /** the state of the watched Pull Requests, from one request for all of them */
  batch: () => Promise<Map<string, WatchedPrState>>
  /** a Pull Request of a WorkDesk that was not ready to merge is now */
  onReady: (pr: WatchedPr, state: PrTodoState) => void
  onChange?: (states: PrTodoStates) => void
  /** everything one request read, with the pull requests it was for: for what is new on the pull requests of your own */
  onRead?: (read: ReadonlyMap<string, WatchedPrState>, targets: readonly WatchedPr[]) => void
  now?: () => number
}

/** The Pull Requests the WorkDesks are about (parked ones too: parking keeps the tabs, it does not stop you hearing the author answered): their work items and the review a Review WorkDesk covers. */
export function watchedPrs(desks: readonly WorkDesk[]): WatchedPr[] {
  const found = new Map<string, WatchedPr>()
  for (const d of desks) {
    if (d.presence === 'planned') continue
    for (const i of d.items ?? []) if (i.kind === 'pr') found.set(i.id, { id: i.id, deskId: d.id, title: i.title })
    for (const r of d.reviews ?? []) {
      const id = `${r.owner}/${r.repo}#${r.number}`
      found.set(id, { id, deskId: d.id, title: d.reviews!.length > 1 ? `${d.name} (#${r.number})` : d.name })
    }
  }
  return [...found.values()]
}

/**
 * Keeps the state of the Pull Requests the WorkDesks are about (their work items and the review a Review WorkDesk
 * covers) up to date, so a WorkDesk can show "approved, checks running" and then "ready to merge". Each is polled
 * until it is merged or closed, and "ready to merge" is announced. Pull Requests that are merged or closed are not
 * asked about again.
 */
export class PrWatch {
  private states: PrTodoStates = {}
  private readiness = new Map<string, Readiness>()
  private running = false

  constructor(private readonly d: PrWatchDeps) {}

  snapshot(): PrTodoStates {
    return this.states
  }

  /** Read the Pull Requests of the WorkDesks (one request for all of them). Failures are ignored: the last known state stays. */
  async refresh(): Promise<PrTodoStates> {
    if (this.running) return this.states
    this.running = true
    try {
      const targets = watchedPrs(this.d.service.getState().desks).filter((p) => this.states[p.id]?.state !== 'merged' && this.states[p.id]?.state !== 'closed')
      if (targets.length === 0) return this.states
      let read: Map<string, WatchedPrState>
      try {
        read = await this.d.batch()
      } catch {
        return this.states
      }
      let changed = false
      for (const pr of targets) {
        const next = read.get(pr.id)?.state
        if (!next) continue
        const before = this.readiness.get(pr.id)
        const after = prReadiness(next)
        this.states = { ...this.states, [pr.id]: next }
        this.readiness.set(pr.id, after)
        changed = true
        // the first look does not announce anything; only a change into "ready" does
        if (before !== undefined && before !== 'ready' && after === 'ready') this.d.onReady(pr, next)
      }
      if (changed) this.d.onChange?.(this.states)
      this.d.onRead?.(read, targets)
      return this.states
    } finally {
      this.running = false
    }
  }
}
