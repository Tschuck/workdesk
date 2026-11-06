import { useEffect, useState } from 'react'
import type { AppState } from '../shared/api'
import type { DeskRunning } from '../main/park-all'
import { Spinner } from './Spinner'

interface Props {
  run: (action: () => Promise<AppState>) => Promise<void>
  /** only these WorkDesks (those of one section of the left panel); without, every running one */
  deskIds?: string[]
  onClose: () => void
}

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Park every WorkDesk, e.g. before restarting the machine: what runs where, what would not come back. */
export function ParkAllDialog({ run, deskIds, onClose }: Props) {
  const api = window.workdesk
  const [desks, setDesks] = useState<DeskRunning[]>()
  const [quit, setQuit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    void api.parkAllPreflight(deskIds).then(setDesks, (e: Error) => setError(clean(e)))
  }, [api, deskIds])

  const unresumable = (desks ?? []).reduce((n, d) => n + d.claudeWithoutSession, 0)
  const total = (desks ?? []).reduce((n, d) => n + d.terminals, 0)

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal wide" onKeyDown={(e) => e.key === 'Escape' && !busy && onClose()}>
        <h3>{deskIds ? 'Park these WorkDesks' : 'Park all WorkDesks'}</h3>
        <p className="hint">
          {deskIds ? 'The WorkDesks of this section are shut down' : 'Every WorkDesk is shut down'}: its terminals, whatever runs in them and its editor window. Tabs, notes, branches and Todos are kept.
          {deskIds
            ? ' They stay where they are listed, are still watched for an answer, and start again from their right-click menu.'
            : <> After a restart, <strong>Reactivate all</strong> brings them back, reopens the WorkDesk you were in, and Claude sessions are resumed when a pane is shown again.</>}
        </p>
        {error && <div className="error">{error}</div>}
        {!desks && !error && <p className="hint"><Spinner /> Looking at what is running…</p>}
        {desks && desks.length === 0 && <p className="ok-text">Every WorkDesk is parked already.</p>}
        {desks && desks.length > 0 && (
          <ul className="park-list">
            {desks.map((d) => (
              <li key={d.deskId}>
                <strong>{d.name}</strong>
                <small className="hint">
                  {d.terminals} terminal{d.terminals === 1 ? '' : 's'}
                  {d.programs.length > 0 ? `, running ${d.programs.join(', ')}` : ''}
                </small>
                {d.claudeWithoutSession > 0 && (
                  <span className="chip small danger-chip" title="Claude is running here, but no session id was recorded, so it cannot be resumed">
                    {d.claudeWithoutSession} Claude not resumable
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {unresumable > 0 && (
          <div className="preflight">
            <strong>{unresumable} Claude session{unresumable === 1 ? '' : 's'} cannot be resumed.</strong>
            <p className="hint">
              WorkDesk learns session ids from Claude Code hooks. Install them on the Claude page, then new sessions can be resumed. These ones
              will start empty again; finish or note down what they were doing first.
            </p>
          </div>
        )}
        {!deskIds && (
          <label className="pr-toggle">
            <input type="checkbox" checked={quit} onChange={(e) => setQuit(e.target.checked)} /> quit WorkDesk afterwards
          </label>
        )}
        <div className="modal-actions">
          <button disabled={busy} onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={busy || !desks || desks.length === 0}
            onClick={async () => {
              setBusy(true)
              await run(() => api.parkAll(quit && !deskIds, deskIds))
              setBusy(false)
              onClose()
            }}
          >
            {busy && <Spinner />} {busy ? 'Parking…' : total > 0 ? `Park all (${desks?.length ?? 0})` : 'Park all'}
          </button>
        </div>
      </div>
    </div>
  )
}
