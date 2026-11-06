import { execFileSync, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { TerminalManager } from './manager'
import { endProcesses, realProcesses, withDescendants } from './processes'
import { createTmux } from './tmux'

const N = 100_000 + (process.pid % 800_000)
const hasTmux = (() => { try { execFileSync('tmux', ['-V']); return true } catch { return false } })()
const running = (pattern: string): boolean => {
  try {
    return execFileSync('pgrep', ['-f', pattern], { encoding: 'utf8' }).trim() !== ''
  } catch {
    return false
  }
}

describe('ending the commands of a terminal', () => {
  it('finds a process and everything below it', () => {
    const table = [{ pid: 2, ppid: 1 }, { pid: 3, ppid: 2 }, { pid: 4, ppid: 3 }, { pid: 5, ppid: 1 }, { pid: 6, ppid: 5 }]
    expect(withDescendants([2], table).sort()).toEqual([2, 3, 4])
    expect(withDescendants([2, 5], table).sort()).toEqual([2, 3, 4, 5, 6])
    expect(withDescendants([], table)).toEqual([])
  })

  it('stops a process that ignores the hangup and the polite request, and spares the app', async () => {
    const child = spawn('sh', ['-c', `trap "" HUP TERM; sleep ${N}1`], { stdio: 'ignore', detached: true })
    child.unref()
    await new Promise((r) => setTimeout(r, 300))
    expect(running(`sleep ${N}1`)).toBe(true)
    const tree = await realProcesses.tree([child.pid!])
    expect(tree.length).toBeGreaterThanOrEqual(2)
    await endProcesses([...tree, process.pid, 1], 300, 50)
    await new Promise((r) => setTimeout(r, 200))
    expect(running(`sleep ${N}1`)).toBe(false)
  })

  it.skipIf(!hasTmux)('parking ends a command that survives the hangup, and closing a Pane does too', async () => {
    const socket = `wd-proc-${process.pid}`
    const tmux = createTmux(socket)
    const pty = () => ({ write() {}, resize() {}, kill() {}, onData() {}, onExit() {} }) as never
    const manager = new TerminalManager(tmux, pty, () => {}, () => {}, () => {}, async () => undefined, {
      tree: realProcesses.tree,
      end: (pids) => endProcesses(pids, 300, 50)
    })
    try {
      await tmux.ensureWindow('workdesk-d', 'p1', tmpdir(), `sh -c 'trap "" HUP TERM; sleep ${N}2'`)
      await tmux.ensureWindow('workdesk-d', 'p2', tmpdir(), `sh -c 'trap "" HUP TERM; sleep ${N}3'`)
      await new Promise((r) => setTimeout(r, 400))
      expect(running(`sleep ${N}2`) && running(`sleep ${N}3`)).toBe(true)
      await manager.close('d', 'p2')
      expect(running(`sleep ${N}3`)).toBe(false)
      expect(running(`sleep ${N}2`)).toBe(true)
      await manager.parkDesk('d', ['p1'])
      await new Promise((r) => setTimeout(r, 200))
      expect(running(`sleep ${N}2`)).toBe(false)
    } finally {
      try { execFileSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' }) } catch { /* gone */ }
      try { execFileSync('pkill', ['-9', '-f', `sleep ${N}[23]`]) } catch { /* none left */ }
    }
  })
})
