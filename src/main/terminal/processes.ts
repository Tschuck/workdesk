import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface ProcessRow {
  pid: number
  ppid: number
}

/** Every process of the machine with its parent. */
export async function processTable(): Promise<ProcessRow[]> {
  const { stdout } = await run('ps', ['-axo', 'pid=,ppid='], { maxBuffer: 16 * 1024 * 1024 })
  return stdout
    .split('\n')
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isInteger))
    .map(([pid, ppid]) => ({ pid, ppid }))
}

/** The roots and everything below them, from a process table. */
export function withDescendants(roots: readonly number[], table: readonly ProcessRow[]): number[] {
  const seen = new Set<number>(roots)
  let grew = true
  while (grew) {
    grew = false
    for (const p of table) {
      if (seen.has(p.ppid) && !seen.has(p.pid)) {
        seen.add(p.pid)
        grew = true
      }
    }
  }
  return [...seen]
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // no permission still means it exists
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * End processes: ask them to stop (SIGTERM), give them a moment, then end what is still there (SIGKILL). Never the app
 * itself, its parent or the init process.
 */
export async function endProcesses(pids: readonly number[], graceMs = 2500, step = 100): Promise<void> {
  const targets = [...new Set(pids)].filter((p) => p > 1 && p !== process.pid && p !== process.ppid)
  const signal = (sig: NodeJS.Signals) => {
    for (const p of targets) {
      try {
        process.kill(p, sig)
      } catch {
        // already gone
      }
    }
  }
  signal('SIGTERM')
  for (let waited = 0; waited < graceMs && targets.some(alive); waited += step) await new Promise((r) => setTimeout(r, step))
  if (targets.some(alive)) signal('SIGKILL')
}

/** What the terminal manager uses to make sure that a command really ends; replaced in tests. */
export interface Processes {
  /** the processes below these roots (the roots included), found before their shells are ended */
  tree(roots: readonly number[]): Promise<number[]>
  end(pids: readonly number[]): Promise<void>
}

export const realProcesses: Processes = {
  async tree(roots) {
    return roots.length === 0 ? [] : withDescendants(roots, await processTable().catch(() => []))
  },
  end: (pids) => endProcesses(pids)
}
