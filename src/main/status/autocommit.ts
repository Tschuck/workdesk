import type { Git } from './git'

export interface AutoCommitOptions {
  /** quiet time after the last change before committing (default ~60 s) */
  debounceMs?: number
  /** minimum time between pushes (default ~5 min) */
  pushIntervalMs?: number
  onAttention?: (reason: string) => void
}

export type AutoCommitState = 'idle' | 'attention'

/**
 * Commits Status Repo changes locally after a quiet period and pushes
 * (only if a remote is configured) at most once per push interval.
 * On a rebase conflict it stops and asks for attention.
 */
export class AutoCommitter {
  state: AutoCommitState = 'idle'
  private commitTimer?: ReturnType<typeof setTimeout>
  private pushTimer?: ReturnType<typeof setTimeout>
  private lastPush = -Infinity
  private pushPending = false
  private running: Promise<void> = Promise.resolve()
  private readonly debounceMs: number
  private readonly pushIntervalMs: number

  constructor(
    private readonly dir: string,
    private readonly git: Git,
    private readonly options: AutoCommitOptions = {}
  ) {
    this.debounceMs = options.debounceMs ?? 60_000
    this.pushIntervalMs = options.pushIntervalMs ?? 5 * 60_000
  }

  /** Call after every write to the Status Repo. */
  notifyChange(): void {
    if (this.state === 'attention') return
    clearTimeout(this.commitTimer)
    this.commitTimer = setTimeout(() => void this.flush(), this.debounceMs)
  }

  /** Commit (and push if due) right now, e.g. on quit. */
  flush(): Promise<void> {
    clearTimeout(this.commitTimer)
    this.running = this.running.then(() => this.commitAndPush())
    return this.running
  }

  /** Push everything now, e.g. right after a remote was set; a failing push is thrown to the caller. */
  syncNow(): Promise<void> {
    this.pushPending = true
    this.lastPush = -Infinity
    return this.flush()
  }

  /** Resume after the user resolved a conflict. */
  resolveAttention(): void {
    this.state = 'idle'
    if (this.pushPending) this.schedulePush(0)
  }

  dispose(): void {
    clearTimeout(this.commitTimer)
    clearTimeout(this.pushTimer)
  }

  private async commitAndPush(): Promise<void> {
    if (this.state === 'attention') return
    if (await this.git.hasChanges(this.dir)) {
      await this.git.commitAll(this.dir, `chore: update status ${new Date().toISOString()}`)
      this.pushPending = true
    }
    if (this.pushPending && (await this.git.hasRemote(this.dir))) {
      const wait = this.lastPush + this.pushIntervalMs - Date.now()
      if (wait > 0) this.schedulePush(wait)
      else await this.push()
    }
  }

  private schedulePush(delayMs: number): void {
    clearTimeout(this.pushTimer)
    this.pushTimer = setTimeout(() => {
      this.running = this.running.then(() => this.push())
    }, delayMs)
  }

  private async push(): Promise<void> {
    if (this.state === 'attention' || !this.pushPending) return
    if ((await this.git.pullRebase(this.dir)) === 'conflict') {
      this.state = 'attention'
      this.options.onAttention?.('Rebase conflict in the Status Repo')
      return
    }
    await this.git.push(this.dir)
    this.lastPush = Date.now()
    this.pushPending = false
  }
}
