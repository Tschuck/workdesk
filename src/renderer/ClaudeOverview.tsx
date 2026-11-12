import { useEffect, useState } from 'react'
import type { AppState } from '../shared/api'
import { agoLabel, STATE_LABEL, type ClaudeRow } from '../main/domain/claude-overview'
import './claude-accounts.css'

interface Props {
  state: AppState
  openDesk: (id: string) => void
  /** to the WorkDesk and the Tab that has the Pane */
  openTab: (deskId: string, tabId: string) => void
  /** Panes started by the orchestrator: marked in the list */
  marked?: ReadonlySet<string>
  /** a click shows the session here instead of going to its WorkDesk (the orchestrator) */
  onPick?: (row: ClaudeRow) => void
}

/**
 * Every Claude session running in the terminals of the WorkDesks in use: which WorkDesk and Account, what it is doing,
 * how long ago it last said something. A click goes to its WorkDesk and Tab. Parked and planned WorkDesks run nothing.
 */
export function ClaudeOverview({ state, openDesk, openTab, marked, onPick }: Props) {
  const [rows, setRows] = useState<ClaudeRow[]>([])
  const [now, setNow] = useState(Date.now())

  // read again when the WorkDesks change (a Signal, a park) and every few seconds while the Dashboard is open
  useEffect(() => {
    let alive = true
    // the sessions of the WorkDesks in view (the main process answers for all of them)
    const inView = new Set(state.desks.map((d) => d.id))
    const load = () => void window.workdesk.claudeOverview().then((r) => alive && (setRows(r.filter((row) => inView.has(row.deskId))), setNow(Date.now())), () => undefined)
    load()
    const timer = setInterval(load, 5000)
    return () => (alive = false, clearInterval(timer))
  }, [state.desks])

  return (
    <div className="panel claude-overview">
      <h3>Claude sessions ({rows.length})</h3>
      {rows.length === 0 ? (
        <p className="empty">No Claude session is running in a WorkDesk.</p>
      ) : (
        <ul className="overview-list">
          {rows.map((r) => (
            <li key={r.deskId + r.paneId}>
              <button
                className={'overview-row ' + r.state}
                title={r.message ?? `${STATE_LABEL[r.state]} · ${r.deskName}${r.tabName ? ` · ${r.tabName}` : ''}`}
                onClick={() => (onPick ? onPick(r) : r.tabId ? openTab(r.deskId, r.tabId) : openDesk(r.deskId))}
              >
                <span className="overview-dot" />
                <span className="overview-desk">{r.deskName}{r.tabName ? <small className="hint"> · {r.tabName}</small> : null}{marked?.has(r.paneId) && <small className="overview-orch" title="Started by the orchestrator"> orchestrator</small>}</span>
                <span className="overview-meta">
                  <span className="hint">{r.accountName}</span>
                  <span className="overview-state">{STATE_LABEL[r.state]}</span>
                  <span className="overview-msg">{r.message ?? ''}</span>
                </span>
                <span className="overview-ago">{agoLabel(r.since, now)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
