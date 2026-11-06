import { useState } from 'react'
import type { BranchDetails } from '../main/branches-service'
import { Spinner } from './Spinner'

interface Props {
  details: BranchDetails
  /** what was asked for first: the local branch, the remote branch */
  initial: 'local' | 'remote'
  onClose: (deleted: boolean) => void
}

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Deleting a branch locally and/or on the remote. Removing it on the remote needs its name typed. */
export function DeleteBranchDialog({ details: b, initial, onClose }: Props) {
  const api = window.workdesk
  const canLocal = b.local && !b.inDesk && !b.checkedOutAt && !b.isDefault
  const canRemote = b.remote && !b.isDefault
  const [local, setLocal] = useState(initial === 'local' && canLocal)
  const [remote, setRemote] = useState(initial === 'remote' && canRemote)
  const [typed, setTyped] = useState('')
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const needsName = remote
  const ok = (local || remote) && (!needsName || typed === b.name) && !busy
  const canForce = !!error && /use force/.test(error)

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose(false)}>
      <div className="modal wide" onKeyDown={(e) => e.key === 'Escape' && !busy && onClose(false)}>
        <h3>Delete <code>{b.name}</code> in {b.project}</h3>
        <label className="pr-toggle">
          <input type="checkbox" disabled={!canLocal} checked={local} onChange={(e) => setLocal(e.target.checked)} /> the local branch
          {!b.local ? ' (there is none)' : b.inDesk ? ` (in the WorkDesk "${b.inDesk.name}": remove it there first)` : b.checkedOutAt ? ' (checked out in a folder)' : ''}
        </label>
        <label className="pr-toggle">
          <input type="checkbox" disabled={!canRemote} checked={remote} onChange={(e) => setRemote(e.target.checked)} /> the branch on the remote (origin)
          {!b.remote ? ' (it is not there)' : ''}
        </label>
        {remote && (
          <div className="preflight">
            <p className="hint">
              This removes <code>{b.name}</code> from origin <strong>for everyone</strong>. A pull request from it may close. Type the branch name to confirm.
            </p>
            <input autoFocus placeholder={b.name} value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
        )}
        {local && !remote && <p className="hint">Only if all its commits are on a remote branch. Otherwise you are asked to force it.</p>}
        {error && <div className="error">{error}</div>}
        {canForce && (
          <label className="pr-toggle">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> I understand, delete the local branch anyway
          </label>
        )}
        <div className="modal-actions">
          <button disabled={busy} onClick={() => onClose(false)}>Cancel</button>
          <button
            className="danger"
            disabled={!ok || (canForce && !force)}
            onClick={async () => {
              setBusy(true)
              try {
                await api.deleteBranch(b.project, b.name, { local, remote, force })
                onClose(true)
              } catch (e) {
                setError(clean(e as Error))
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy && <Spinner />} {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
