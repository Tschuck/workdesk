import { createContext, useContext } from 'react'

/** Is the terminal on screen (its WorkDesk and Tab are the ones shown)? Hidden terminals keep the shell running but do not draw. */
export const TerminalActiveContext = createContext(true)
export const useTerminalActive = (): boolean => useContext(TerminalActiveContext)

/**
 * What a hidden terminal was sent meanwhile: kept up to a limit, then given up. A terminal that gave up is drawn again from tmux
 * (a resize makes tmux repaint the whole screen) when it is shown.
 */
export class HiddenOutput {
  private chunks: string[] = []
  private size = 0
  /** too much came in: what was kept is not the screen any more */
  overflowed = false

  constructor(private readonly limit = 512 * 1024) {}

  push(data: string): void {
    if (this.overflowed) return
    this.size += data.length
    if (this.size > this.limit) {
      this.overflowed = true
      this.chunks = []
      return
    }
    this.chunks.push(data)
  }

  /** What to write now, or undefined when the screen has to be repainted instead. Empties the buffer either way. */
  take(): { write: string } | { repaint: true } | undefined {
    const out = this.overflowed ? ({ repaint: true } as const) : this.chunks.length > 0 ? { write: this.chunks.join('') } : undefined
    this.chunks = []
    this.size = 0
    this.overflowed = false
    return out
  }
}
