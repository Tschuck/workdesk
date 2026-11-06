export interface CommandFinished {
  exitCode?: number
}

/**
 * Finds "command finished" marks (OSC 133;D[;exit]) in terminal output. Sequences may be split
 * across chunks. Only shells with prompt integration emit them.
 */
export class Osc133Scanner {
  private pending = ''

  push(chunk: string): CommandFinished[] {
    const text = this.pending + chunk
    const found: CommandFinished[] = []
    const re = /\x1b\]133;D(?:;(-?\d+))?(?:\x07|\x1b\\)/g
    let last = 0
    for (let m = re.exec(text); m; m = re.exec(text)) {
      found.push(m[1] === undefined ? {} : { exitCode: Number(m[1]) })
      last = re.lastIndex
    }
    const tail = text.slice(last)
    const start = tail.lastIndexOf('\x1b]133;')
    this.pending = start === -1 ? '' : tail.slice(start).slice(-40)
    return found
  }
}
