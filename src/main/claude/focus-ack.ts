/** Clears a Pane's Signals once the Pane has been visible and focused for a while. */
export class FocusAcknowledger {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly acknowledge: (deskId: string, paneId: string) => void,
    private readonly delayMs = 2000
  ) {}

  setFocused(deskId: string, paneId: string, focused: boolean): void {
    const key = `${deskId}/${paneId}`
    clearTimeout(this.timers.get(key))
    this.timers.delete(key)
    if (!focused) return
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key)
        this.acknowledge(deskId, paneId)
      }, this.delayMs)
    )
  }

  dispose(): void {
    this.timers.forEach(clearTimeout)
    this.timers.clear()
  }
}
