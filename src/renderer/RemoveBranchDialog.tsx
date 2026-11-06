import { useEffect, useState } from 'react'
import type { AppState } from '../shared/api'
import type { PreflightIssue } from '../main/projects/worktrees'
import { describe } from './ClearDialog'
import { Spinner } from './Spinner'

interface Props {
  deskId: string
  deskName: string
  project: string
  branch: string
  run: (action: () => Promise<AppState>) => Promise<void>
  onClose: (removed: boolean) => void
}

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Approval before a branch's folder is removed from its WorkDesk: what would be lost, then a confirmation. */
export function RemoveBranchDialog({ deskId, deskName, project, branch, run, onClose }: Props) {
  const api = window.workdesk
  const [issues, setIssues] = useState<PreflightIssue[]>()
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    void api.removeBranchPreflight(deskId, project, branch).then(setIssues, (e: Error) => setError(clean(e)))
  }, [api, deskId, project, branch])

  const risky = (issues?.length ?? 0) > 0
  const canRemove = !busy && issues !== undefined && (!risky || understood)

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose(false)}>
      <div className="modal wide" onKeyDown={(e) => e.key === 'Escape' && !busy && onClose(false)}>
        <h3>Remove <code>{branch}</code> from "{deskName}"?</h3>
        <p className="hint">
          The branch's folder in the WorkDesk is deleted. The branch itself stays in {project}, with all its commits, and can be added to a
          WorkDesk again. Other branches stacked on it are re-attached to what it was based on. Afterwards you can delete the branch as well.
        </p>
        {error && <div className="error">{error}</div>}
        {!issues && !error && <p className="hint"><Spinner /> Checking for work that would be lost…</p>}
        {issues && !risky && <p className="ok-text">Nothing to lose in this folder.</p>}
        {risky && (
          <div className="preflight">
            <strong>This would be lost with the folder:</strong>
            <ul>
              {issues!.map((i, n) => {
                const d = describe(i)
                return (
                  <li key={n}>
                    {d.text}
                    {d.files && <small className="hint"> {d.files.slice(0, 6).join(', ')}{d.files.length > 6 ? ` … +${d.files.length - 6}` : ''}</small>}
                  </li>
                )
              })}
            </ul>
            <label className="pr-toggle">
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /> I understand, remove the folder anyway
            </label>
          </div>
        )}
        <div className="modal-actions">
          <button disabled={busy} onClick={() => onClose(false)}>Cancel</button>
          <button
            className="danger"
            disabled={!canRemove}
            onClick={async () => {
              setBusy(true)
              await run(() => api.removeBranchFromDesk(deskId, project, branch))
              setBusy(false)
              onClose(true)
            }}
          >
            {busy && <Spinner />} {busy ? 'Removing…' : 'Remove from WorkDesk'}
          </button>
        </div>
      </div>
    </div>
  )
}
