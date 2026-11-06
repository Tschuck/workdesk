import { Fragment, useEffect, useRef, useState } from 'react'
import type { AppState } from '../shared/api'
import type { PerfLine, PerfSnapshot, ProcNode } from '../main/performance'

interface Props {
  state: AppState
  run: (action: () => Promise<AppState>) => Promise<void>
}

const mb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`)
const cpu = (n: number) => `${n.toFixed(1)}%`

/** a part of the row above it: one window of VS Code, one process of the app */
function SubRow({ name, memoryMb, cpu: cpuNow, peak }: { name: string; memoryMb: number; cpu: number; peak?: number }) {
  return (
    <tr className="perf-sub">
      <td>{name}</td>
      <td />
      <td className="num">{mb(memoryMb)}</td>
      <td className="num">{cpu(cpuNow)}</td>
      <td className="perf-actions">{peak !== undefined && peak >= 5 ? <small className="hint" title="Highest CPU seen while this page was open">peak {cpu(peak)}</small> : null}</td>
    </tr>
  )
}

/** a process and what it started, indented */
function Tree({ node, depth }: { node: ProcNode; depth: number }) {
  return (
    <>
      <tr className="perf-sub perf-proc">
        <td style={{ paddingLeft: 28 + depth * 16 }}>
          <span className="perf-branch">{depth > 0 ? '↳ ' : ''}</span>
          <code>{node.name}</code> <small className="hint">{node.pid}</small>
        </td>
        <td />
        <td className="num">{mb(node.memoryMb)}</td>
        <td className="num">{cpu(node.cpu)}</td>
        <td />
      </tr>
      {node.children.map((c) => <Tree key={c.pid} node={c} depth={depth + 1} />)}
      {node.more > 0 && (
        <tr className="perf-sub"><td style={{ paddingLeft: 28 + (depth + 1) * 16 }}><small className="hint">+{node.more} more</small></td><td /><td /><td /><td /></tr>
      )}
    </>
  )
}

function Row({ name, hint, line, children }: { name: React.ReactNode; hint?: string; line: PerfLine; children?: React.ReactNode }) {
  return (
    <tr>
      <td>
        {name}
        {hint && <small className="hint perf-hint">{hint}</small>}
      </td>
      <td className="num">{line.processes}</td>
      <td className="num">{mb(line.memoryMb)}</td>
      <td className="num">{cpu(line.cpu)}</td>
      <td className="perf-actions">{children}</td>
    </tr>
  )
}

/** What WorkDesk, its terminals and VS Code use right now, so you can see what to park. */
export function PerformanceView({ state, run }: Props) {
  const api = window.workdesk
  const [snap, setSnap] = useState<PerfSnapshot>()
  const [error, setError] = useState<string>()
  // the highest CPU each part of the app showed while the page was open: a spike is gone before you can look
  // WorkDesks whose terminals are shown: closed each time the page opens
  const [expanded, setExpanded] = useState<string[]>([])
  // the parked WorkDesks use nothing: their list is folded until you open it
  const [showParked, setShowParked] = useState(false)
  const peaks = useRef(new Map<string, number>())
  const [usageMin, setUsageMin] = useState(5)
  useEffect(() => void api.accountsState().then((s) => setUsageMin(s.intervalMin)), [api])

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const s = await api.performance()
        for (const p of s.app.parts) peaks.current.set(p.name, Math.max(peaks.current.get(p.name) ?? 0, p.cpu))
        if (!stop) (setSnap(s), setError(undefined))
      } catch (e) {
        if (!stop) setError((e as Error).message)
      }
      if (!stop) timer = setTimeout(() => void tick(), 3000)
    }
    void tick()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [api])

  const presence = (id: string) => state.desks.find((d) => d.id === id)?.presence
  // `isParked` is below: the rows need it
  const deskRow = (d: PerfSnapshot['desks'][number]) => {
                const parkedNow = isParked(d.deskId)
                const open = expanded.includes(d.deskId)
                return (
                  <Fragment key={d.deskId}>
                  <Row
                    name={
                      <>
                        {d.tree.length > 0 && (
                          <button className="chevron-btn" title={open ? 'Hide its processes' : 'Show its processes'} onClick={() => setExpanded((f) => (f.includes(d.deskId) ? f.filter((x) => x !== d.deskId) : [...f, d.deskId]))}>
                            {open ? '▾' : '▸'}
                          </button>
                        )}
                        <strong>{d.name}</strong>
                      </>
                    }
                    hint={parkedNow ? 'parked' : d.tree.length === 0 ? 'no terminals running' : open ? undefined : d.top.map((t) => `${t.name} ${mb(t.memoryMb)}`).join(' · ')}
                    line={d}
                  >
                    {!parkedNow && d.terminals > 0 && <button title="End its terminals and close its editor to free this" onClick={() => void run(() => api.parkDesk(d.deskId))}>Park</button>}
                  </Row>
                  {open &&
                    d.tree.map((t) => (
                      <Fragment key={t.window}>
                        <tr className="perf-sub perf-pane">
                          <td>terminal · {t.label}</td>
                          <td className="num">{t.processes}</td>
                          <td className="num">{mb(t.memoryMb)}</td>
                          <td className="num">{cpu(t.cpu)}</td>
                          <td />
                        </tr>
                        {t.root && <Tree node={t.root} depth={1} />}
                      </Fragment>
                    ))}
                  </Fragment>
                )
  }
  const isParked = (id: string) => presence(id) === 'parked'
  const running = (snap?.desks ?? []).filter((d) => !isParked(d.deskId))
  const parked = (snap?.desks ?? []).filter((d) => isParked(d.deskId))

  return (
    <section className="performance-page">
      <h2>Performance</h2>
      <p className="hint">
        Memory and CPU of everything WorkDesk has started, refreshed every few seconds. CPU is in percent of one core. Parking a WorkDesk ends its
        terminals and closes its editor window to free what it uses here.
      </p>
      {error && <div className="error">{error}</div>}
      {!snap && !error && <p className="empty">Measuring…</p>}
      {snap && (
        <div className="panel">
          <table className="perf">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Processes</th>
                <th className="num">Memory</th>
                <th className="num">CPU</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <Row name="WorkDesk (the app)" hint="window, browser Tabs and helpers" line={snap.app} />
              {snap.app.parts.map((p, i) => (
                <SubRow key={p.name + i} name={p.name} memoryMb={p.memoryMb} cpu={p.cpu} peak={peaks.current.get(p.name)} />
              ))}
              {running.map(deskRow)}
              {parked.length > 0 && (
                <>
                  <tr className="perf-group">
                    <td colSpan={5}>
                      <button className="chevron-btn" aria-expanded={showParked} title={showParked ? 'Hide the parked WorkDesks' : 'Show the parked WorkDesks'} onClick={() => setShowParked(!showParked)}>
                        {showParked ? '▾' : '▸'}
                      </button>
                      Parked WorkDesks ({parked.length}) <span className="hint">use nothing: their terminals and editor are shut down</span>
                    </td>
                  </tr>
                  {showParked && parked.map(deskRow)}
                </>
              )}
              <Row name="VS Code" hint="all windows, also ones that are not WorkDesk's" line={snap.editor} />
              {snap.editor.windows.map((w, i) => (
                <SubRow key={w.title + i} name={w.title} memoryMb={w.memoryMb} cpu={w.cpu} />
              ))}
              {snap.editor.windows.length > 0 && snap.editor.shared.processes > 0 && (
                <SubRow name="shared by all windows (GPU, pty host, …)" memoryMb={snap.editor.shared.memoryMb} cpu={snap.editor.shared.cpu} />
              )}
              <Row name="Claude usage reader" hint={snap.usage.processes === 0 ? `idle (starts every ${usageMin} min)` : 'hidden session that reads /usage (one at a time, ends after the reading)'} line={snap.usage} />
              <Row name="tmux server" hint="keeps the terminals alive, without what runs in them" line={snap.tmuxServer} />
              <tr className="perf-total">
                <td><strong>Total</strong></td>
                <td className="num">{snap.total.processes}</td>
                <td className="num"><strong>{mb(snap.total.memoryMb)}</strong></td>
                <td className="num"><strong>{cpu(snap.total.cpu)}</strong></td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
