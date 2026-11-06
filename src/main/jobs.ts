/** What the app is loading right now: a named job per background read, with when it started (shown on the refresh button's hover). */
export interface JobInfo {
  id: number
  label: string
  /** epoch ms */
  since: number
}

class Jobs {
  private next = 1
  private readonly running = new Map<number, JobInfo>()
  private listener?: (jobs: JobInfo[]) => void

  /** runs `fn` and lists it while it runs */
  async track<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const id = this.next++
    this.running.set(id, { id, label, since: Date.now() })
    this.changed()
    try {
      return await fn()
    } finally {
      this.running.delete(id)
      this.changed()
    }
  }

  snapshot(): JobInfo[] {
    return [...this.running.values()]
  }

  onChange(listener: (jobs: JobInfo[]) => void): void {
    this.listener = listener
  }

  private changed(): void {
    this.listener?.(this.snapshot())
  }
}

export const jobs = new Jobs()
