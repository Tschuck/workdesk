import { useEffect, useState } from 'react'
import type { AppState } from '../shared/api'
import type { OrchestratorEntry } from '../main/orchestrator'
import { clock } from './accounts'
import { useAccounts } from './accounts'
import { ClaudeOverview } from './ClaudeOverview'
import { TerminalPane } from './TerminalPane'
import './orchestrator.css'

type Where = Awaited<ReturnType<Window['workdesk']['orchestratorState']>>
/** a session of a WorkDesk shown in the orchestrator's page, beside its own terminal */
interface Looking {
  deskId: string
  paneId: string
  tabId?: string
  name: string
}

/**
 * The orchestrator: one Claude of its own, shown as a terminal, that looks over the WorkDesks and (for now) suggests what to start.
 * At the left what runs in the WorkDesks; its Claude Account is chosen above the terminal.
 */
export function OrchestratorView({ state, openDesk, openTab }: { state: AppState; openDesk: (id: string) => void; openTab: (deskId: string, tabId: string) => void }) {
  const api = window.workdesk
  const accounts = useAccounts()
  const [where, setWhere] = useState<Where>()
  // a new mount of the terminal after a restart starts Claude again
  const [run, setRun] = useState(0)
  const [note, setNote] = useState<string>()
  useEffect(() => void api.orchestratorState().then(setWhere), [api])
  // what it started, newest first
  const [history, setHistory] = useState<OrchestratorEntry[]>([])
  useEffect(() => {
    void api.orchestratorHistory().then(setHistory)
    return api.onOrchestratorHistory(setHistory)
  }, [api])
  const marked = new Set(history.map((h) => h.paneId))
  // a WorkDesk's Claude, shown here (its own terminal in the WorkDesk stays as it is); none: the orchestrator's
  const [looking, setLooking] = useState<Looking>()

  if (!where) return null
  const chosen = where.accountId && accounts?.accounts.some((a) => a.account.id === where.accountId) ? where.accountId : ''
  const restart = async () => {
    await api.orchestratorRestart()
    setNote(undefined)
    setRun((n) => n + 1)
  }
  return (
    <section className="orch-page">
      <aside className="orch-side">
        <ClaudeOverview
          state={state}
          openDesk={openDesk}
          openTab={openTab}
          marked={marked}
          onPick={(r) => setLooking({ deskId: r.deskId, paneId: r.paneId, tabId: r.tabId, name: `${r.deskName}${r.tabName ? ` · ${r.tabName}` : ''}` })}
        />
        <div className="panel orch-history">
          <h3>History ({history.length})</h3>
          {history.length === 0 ? (
            <p className="empty">Nothing started by the orchestrator yet.</p>
          ) : (
            <ul>
              {history.map((h) => (
                <li key={h.id}>
                  <button type="button" title={h.prompt} onClick={() => setLooking({ deskId: h.deskId, paneId: h.paneId, tabId: h.tabId, name: h.deskName })}>
                    <span className="hint">{clock(h.at)}</span>
                    <span className="orch-h-desk">{h.deskName}</span>
                    <span className="orch-h-what">started Claude: {h.prompt}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
      <div className="orch-main">
        <div className="orch-bar">
          <div className="orch-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={!looking} className={'tab-btn' + (looking ? '' : ' active')} onClick={() => setLooking(undefined)}>
              Orchestrator
            </button>
            {looking && (
              <span className="tab-btn active orch-look" role="tab" aria-selected>
                {looking.name}
                <button type="button" className="orch-look-close" title="Close: back to the orchestrator (the session keeps running)" onClick={() => setLooking(undefined)}>
                  ×
                </button>
              </span>
            )}
          </div>
          {looking ? (
            <>
              <span className="file-spacer" />
              <button type="button" title="Go to this session in its WorkDesk" onClick={() => (looking.tabId ? openTab(looking.deskId, looking.tabId) : openDesk(looking.deskId))}>
                Open in WorkDesk
              </button>
            </>
          ) : (
            <>
              {accounts && accounts.accounts.length > 0 && (
                <label className="orch-account" title="The Claude Account the orchestrator runs under. A running one keeps its Account until it is restarted.">
                  <span className="hint">Claude Account</span>
                  <select
                    value={chosen}
                    onChange={(e) => void api.orchestratorSetAccount(e.target.value || null).then(() => api.orchestratorState().then(setWhere)).then(() => setNote('Restart to use this Account.'))}
                  >
                    <option value="">default ({accounts.accounts.find((a) => a.isDefault)?.account.name})</option>
                    {accounts.accounts.map((a) => (
                      <option key={a.account.id} value={a.account.id}>{a.account.name}</option>
                    ))}
                  </select>
                </label>
              )}
              {note && <span className="hint orch-note">{note}</span>}
              <span className="file-spacer" />
              <button type="button" title="End the orchestrator's Claude and start it again (new instructions, the chosen Account)" onClick={() => void restart()}>Restart</button>
            </>
          )}
        </div>
        {/* the orchestrator's terminal stays while a session is shown, so its Claude is not started again */}
        <div className={'orch-term' + (looking ? ' off' : '')}>
          <TerminalPane key={run} deskId={where.deskId} paneId={where.paneId} cwd={where.cwd} />
        </div>
        {looking && (
          <div className="orch-term">
            <TerminalPane key={looking.deskId + looking.paneId} deskId={looking.deskId} paneId={looking.paneId} cwd={where.cwd} viewId={`orch-${looking.paneId}`} />
          </div>
        )}
      </div>
    </section>
  )
}
