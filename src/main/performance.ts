import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import { findCodeBinary } from './editor/macos'
import { TMUX_SOCKET } from './terminal/tmux'

const run = promisify(execFile)

export interface ProcRow {
  pid: number
  ppid: number
  /** resident memory, KB */
  rssKb: number
  /** CPU time used so far, seconds */
  cpuSeconds: number
  /** executable path */
  command: string
}

/** A tmux pane: the session it is in and the process that tmux started in it. */
export interface PanePid {
  session: string
  window: string
  pid: number
  /** folder the pane is in */
  path?: string
}

/** A process and what it started. Memory and CPU are the process's own. */
export interface ProcNode {
  pid: number
  name: string
  memoryMb: number
  cpu: number
  children: ProcNode[]
  /** children left out because there are many */
  more: number
}

/** One terminal of a WorkDesk and everything running in it. */
export interface PaneTree extends PerfLine {
  window: string
  /** the folder it is in */
  label: string
  root?: ProcNode
}

export interface PerfLine {
  processes: number
  memoryMb: number
  /** percent of one core, since the previous sample */
  cpu: number
}

export interface DeskPerf extends PerfLine {
  deskId: string
  name: string
  terminals: number
  /** each terminal with the processes in it */
  tree: PaneTree[]
  /** the programs that use the most memory, e.g. claude 420 MB */
  top: { name: string; memoryMb: number; cpu: number }[]
}

/** One of the processes of the app itself: its main process, the window, the GPU, a browser Tab's page. */
export interface AppPart {
  name: string
  memoryMb: number
  /** percent of one core, as Chromium measures it since its previous look */
  cpu: number
}

/** A VS Code window by its title, with the processes `code --status` says belong to it. */
export interface CodeWindow {
  title: string
  pids: number[]
}

/**
 * `code --status` prints a table with `window [N] (title)`, `file-watcher [N]` and `extension-host [N]` rows,
 * each with its process id. Everything with the same N belongs to one window (the extension host's own
 * children are found through the process tree).
 */
export function parseCodeStatus(out: string): CodeWindow[] {
  const windows = new Map<string, CodeWindow>()
  let inTable = false
  for (const l of out.split('\n')) {
    if (/^CPU %\s+Mem MB\s+PID\s+Process/.test(l)) {
      inTable = true
      continue
    }
    const m = inTable ? /^\s*\S+\s+\S+\s+(\d+)\s+(.*)$/.exec(l) : null
    const label = m && /^(window|file-watcher|extension-host) \[(\d+)\](?: \((.*)\))?\s*$/.exec(m[2].trim())
    if (!m || !label) continue
    const w = windows.get(label[2]) ?? { title: '', pids: [] }
    if (label[1] === 'window') w.title = label[3] ?? ''
    w.pids.push(Number(m[1]))
    windows.set(label[2], w)
  }
  return [...windows.values()].filter((w) => w.title)
}

export interface PerfSnapshot {
  at: number
  total: PerfLine
  /** WorkDesk itself: its window, browser Tabs and helpers */
  app: PerfLine & { parts: AppPart[] }
  desks: DeskPerf[]
  /** every VS Code window, also ones that are not WorkDesk's */
  editor: PerfLine & { windows: (PerfLine & { title: string })[]; shared: PerfLine }
  /** the hidden Claude session that reads /usage */
  usage: PerfLine
  /** tmux itself, without the programs in it */
  tmuxServer: PerfLine
}

/** `ps` TIME: [days-][hh:]mm:ss.cc */
export function parseCpuTime(s: string): number {
  const [days, rest] = s.includes('-') ? s.split('-') : ['0', s]
  return rest.split(':').reduce((sum, part) => sum * 60 + Number(part), 0) + Number(days) * 86_400
}

export function parsePs(out: string): ProcRow[] {
  return out
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), cpuSeconds: parseCpuTime(m[4]), command: m[5] }))
}

/** The process and everything below it. */
export function descendants(rows: readonly ProcRow[], root: number): ProcRow[] {
  const children = new Map<number, ProcRow[]>()
  for (const r of rows) children.set(r.ppid, [...(children.get(r.ppid) ?? []), r])
  const byPid = new Map(rows.map((r) => [r.pid, r]))
  const found: ProcRow[] = []
  const seen = new Set<number>()
  const walk = (pid: number) => {
    if (seen.has(pid)) return
    seen.add(pid)
    const self = byPid.get(pid)
    if (self) found.push(self)
    for (const c of children.get(pid) ?? []) walk(c.pid)
  }
  walk(root)
  return found
}

const MAX_CHILDREN = 12

/** The process tree below `pid`, biggest first, with a cap on very wide levels. */
export function procTree(rows: readonly ProcRow[], pid: number, cpuOf: (p: ProcRow) => number): ProcNode | undefined {
  const byPid = new Map(rows.map((r) => [r.pid, r]))
  const children = new Map<number, ProcRow[]>()
  for (const r of rows) children.set(r.ppid, [...(children.get(r.ppid) ?? []), r])
  const seen = new Set<number>()
  const build = (p: number): ProcNode | undefined => {
    const r = byPid.get(p)
    if (!r || seen.has(p)) return undefined
    seen.add(p)
    const kids = [...(children.get(p) ?? [])].sort((a, b) => b.rssKb - a.rssKb)
    return {
      pid: p,
      name: basename(r.command).replace(/^-/, ''),
      memoryMb: Math.round(r.rssKb / 1024),
      cpu: Math.round(cpuOf(r) * 10) / 10,
      children: kids.slice(0, MAX_CHILDREN).flatMap((k) => build(k.pid) ?? []),
      more: Math.max(0, kids.length - MAX_CHILDREN)
    }
  }
  return build(pid)
}

const line = (procs: readonly ProcRow[], cpuOf: (p: ProcRow) => number): PerfLine => ({
  processes: procs.length,
  memoryMb: Math.round(procs.reduce((n, p) => n + p.rssKb, 0) / 1024),
  cpu: Math.round(procs.reduce((n, p) => n + cpuOf(p), 0) * 10) / 10
})

export interface SnapshotInput {
  rows: readonly ProcRow[]
  appPid: number
  tmuxPid?: number
  panes: readonly PanePid[]
  desks: readonly { id: string; name: string }[]
  /** VS Code windows with their processes, when known */
  codeWindows?: readonly CodeWindow[]
  /** what the app knows about its own processes (Electron); empty when not asked */
  appParts?: readonly AppPart[]
  /** CPU percent of each process since the previous sample */
  cpuOf: (p: ProcRow) => number
  now: number
}

/** Pure: who uses how much, grouped into the app, each WorkDesk's terminals, VS Code and tmux. */
export function buildSnapshot(i: SnapshotInput): PerfSnapshot {
  const app = descendants(i.rows, i.appPid)
  const own = (session: string) => i.panes.filter((p) => p.session === session)
  const procsOf = (panes: readonly PanePid[]) => {
    const byPid = new Map<number, ProcRow>()
    for (const p of panes) for (const r of descendants(i.rows, p.pid)) byPid.set(r.pid, r)
    return [...byPid.values()]
  }
  const desks: DeskPerf[] = i.desks.map((d) => {
    const panes = own(`workdesk-${d.id}`)
    const procs = procsOf(panes)
    const programs = new Map<string, { rssKb: number; cpu: number }>()
    for (const p of procs) {
      const name = basename(p.command).replace(/^-/, '')
      const was = programs.get(name) ?? { rssKb: 0, cpu: 0 }
      programs.set(name, { rssKb: was.rssKb + p.rssKb, cpu: was.cpu + i.cpuOf(p) })
    }
    const top = [...programs.entries()]
      .sort((a, b) => b[1].rssKb - a[1].rssKb)
      .slice(0, 4)
      .map(([name, v]) => ({ name, memoryMb: Math.round(v.rssKb / 1024), cpu: Math.round(v.cpu * 10) / 10 }))
    const seenWindows = new Set<string>()
    const tree: PaneTree[] = panes
      .filter((p) => !seenWindows.has(p.window) && !!seenWindows.add(p.window))
      .map((p) => ({ window: p.window, label: p.path ? basename(p.path) || p.path : p.window, root: procTree(i.rows, p.pid, i.cpuOf), ...line(procsOf([p]), i.cpuOf) }))
    return { deskId: d.id, name: d.name, terminals: tree.length, tree, top, ...line(procs, i.cpuOf) }
  })
  // the hidden readers of the usage, one session per Account and only while one is read
  const usage = procsOf(i.panes.filter((p) => p.session.startsWith('_workdesk-usage')))
  const tmuxServer = i.tmuxPid === undefined ? [] : i.rows.filter((r) => r.pid === i.tmuxPid)
  const editor = i.rows.filter((r) => r.command.includes('/Visual Studio Code.app/'))
  const inWindows = new Map<number, ProcRow>()
  const windows = (i.codeWindows ?? []).map((w) => {
    const procs = [...new Map(w.pids.flatMap((pid) => descendants(i.rows, pid)).map((r) => [r.pid, r])).values()]
    for (const r of procs) inWindows.set(r.pid, r)
    return { title: w.title, ...line(procs, i.cpuOf) }
  })
  const shared = editor.filter((r) => !inWindows.has(r.pid))
  // programs a window's extensions started count for VS Code too, so the windows add up to the total
  const editorAll = [...new Map([...editor, ...inWindows.values()].map((r) => [r.pid, r])).values()]
  const all = [...app, ...procsOf(i.panes.filter((p) => !p.session.startsWith('workdesk-view-'))), ...tmuxServer, ...editorAll]
  const unique = [...new Map(all.map((r) => [r.pid, r])).values()]
  return {
    at: i.now,
    total: line(unique, i.cpuOf),
    app: { ...line(app, i.cpuOf), parts: [...(i.appParts ?? [])].sort((a, b) => b.cpu - a.cpu || b.memoryMb - a.memoryMb) },
    desks: desks.sort((a, b) => b.memoryMb - a.memoryMb),
    editor: { ...line(editorAll, i.cpuOf), windows, shared: line(shared, i.cpuOf) },
    usage: line(usage, i.cpuOf),
    tmuxServer: line(tmuxServer, i.cpuOf)
  }
}

/** Samples the machine; CPU is worked out from the CPU time used between two samples. */
export class PerformanceSampler {
  private previous?: { at: number; seconds: Map<number, number> }

  constructor(
    private readonly desks: () => readonly { id: string; name: string }[],
    private readonly socket: string = TMUX_SOCKET,
    private readonly appPid: number = process.pid,
    private readonly appParts: () => readonly AppPart[] = () => [],
    private readonly codeStatus: () => Promise<string> = defaultCodeStatus
  ) {}

  private codeWindows: CodeWindow[] = []
  private codeAt = 0
  private codeLoading?: Promise<void>

  /** `code --status` takes a second or two: the windows are looked up every 20 seconds, not on every sample */
  private async windowsOfCode(hasCode: boolean): Promise<CodeWindow[]> {
    if (!hasCode) return []
    if (Date.now() - this.codeAt > 20_000 && !this.codeLoading) {
      this.codeAt = Date.now()
      this.codeLoading = this.codeStatus()
        .then((out) => void (this.codeWindows = parseCodeStatus(out)))
        .catch(() => void (this.codeWindows = []))
        .finally(() => void (this.codeLoading = undefined))
      // the first look waits for the answer, later ones use the last one
      if (this.codeWindows.length === 0) await this.codeLoading
    }
    return this.codeWindows
  }

  private async ps(): Promise<ProcRow[]> {
    return parsePs((await run('ps', ['-axo', 'pid=,ppid=,rss=,time=,comm='], { maxBuffer: 16 * 1024 * 1024 })).stdout)
  }

  private async tmux(args: string[]): Promise<string | undefined> {
    try {
      return (await run('tmux', ['-L', this.socket, ...args])).stdout
    } catch {
      // no server running: nothing is running in it
      return undefined
    }
  }

  /** `light` leaves out the VS Code windows (`code --status` starts a VS Code process): enough for the totals. */
  async sample(light = false): Promise<PerfSnapshot> {
    if (!this.previous) {
      // the first look has nothing to compare with: take a second one right after
      const rows = await this.ps()
      this.previous = { at: Date.now(), seconds: new Map(rows.map((r) => [r.pid, r.cpuSeconds])) }
      await new Promise((r) => setTimeout(r, 1000))
    }
    const rows = await this.ps()
    const at = Date.now()
    const before = this.previous
    const elapsed = Math.max((at - before.at) / 1000, 0.001)
    const cpuOf = (p: ProcRow) => {
      const was = before.seconds.get(p.pid)
      return was === undefined ? 0 : (Math.max(p.cpuSeconds - was, 0) / elapsed) * 100
    }
    this.previous = { at, seconds: new Map(rows.map((r) => [r.pid, r.cpuSeconds])) }
    const listing = await this.tmux(['list-panes', '-a', '-F', '#{session_name}\t#{window_name}\t#{pane_pid}\t#{pane_current_path}'])
    const panes = (listing ?? '').split('\n').filter(Boolean).map((l) => {
      const [session, window, pid, path] = l.split('\t')
      return { session, window, pid: Number(pid), path }
    })
    const tmuxPid = Number((await this.tmux(['display-message', '-p', '#{pid}']))?.trim()) || undefined
    return buildSnapshot({ rows, appPid: this.appPid, tmuxPid, panes, desks: this.desks(), cpuOf, now: at, appParts: this.appParts(), codeWindows: light ? [] : await this.windowsOfCode(rows.some((r) => r.command.includes('/Visual Studio Code.app/'))) })
  }
}

async function defaultCodeStatus(): Promise<string> {
  return (await run(findCodeBinary(), ['--status'], { timeout: 15_000, maxBuffer: 16 * 1024 * 1024 })).stdout
}
