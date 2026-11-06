/**
 * When the Claude usage is read. A reading starts a hidden Claude session, so it is not done while nobody could look at
 * the result: not while the screen is locked or the machine sleeps, and not once the window has been out of focus for a
 * long time. Coming back reads once at once; so does a focus after a longer time than the interval.
 */
export class UsageSchedule {
  private locked = false
  private focused = true
  private blurredAt?: number
  private lastRefresh = 0

  constructor(
    /** read all accounts now */
    private readonly refresh: () => void,
    private readonly now: () => number = Date.now,
    public intervalMs = 5 * 60_000,
    private readonly idleMs = 30 * 60_000
  ) {}

  paused(): boolean {
    return this.locked || (!this.focused && this.blurredAt !== undefined && this.now() - this.blurredAt > this.idleMs)
  }

  /** The reading itself (a timer, a button) happened: the next focus does not need another. */
  noteRefresh(): void {
    this.lastRefresh = this.now()
  }

  /** The timer ticked: reads, unless paused. */
  tick(): void {
    if (this.paused()) return
    this.run()
  }

  setLocked(locked: boolean): void {
    const was = this.paused()
    this.locked = locked
    if (was && !this.paused()) this.run()
  }

  setFocused(focused: boolean): void {
    const was = this.paused()
    if (focused === this.focused) return
    this.focused = focused
    this.blurredAt = focused ? undefined : this.now()
    if (!focused || this.paused()) return
    if (was || this.now() - this.lastRefresh > this.intervalMs) this.run()
  }

  private run(): void {
    this.lastRefresh = this.now()
    this.refresh()
  }
}
