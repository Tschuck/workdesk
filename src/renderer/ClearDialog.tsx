import { useEffect, useState } from 'react'
import type { PreflightIssue } from '../main/projects/worktrees'
import type { ClearBranch, ClearBranchPick } from '../main/clear-service'
import type { WorkDesk } from '../main/domain/types'
import { Spinner } from './Spinner'

interface Props {
  desk: WorkDesk
  /** the user confirmed: the caller clears the WorkDesk in the background, the dialog is closed */
  onConfirm: (deleteBranches: ClearBranchPick[]) => void
  onClose: () => void
}

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function describe(i: PreflightIssue): { text: string; files?: string[] } {
  const where = `${i.project} · ${i.branch}`
  switch (i.kind) {
    case 'uncommitted': return { text: `${where}: uncommitted changes`, files: i.detail as string[] }
    case 'untracked': return { text: `${where}: untracked files`, files: i.detail as string[] }
    case 'unpushed': return { text: `${where}: ${i.detail} commit(s) not pushed` }
    case 'no-remote': return { text: `${where}: the Branch has no remote; it only exists in the clone` }
    case 'broken': return { text: `${where}: its folder is no longer a git work tree, so nothing could be checked; the folder is removed anyway`, files: i.detail as string[] }
    case 'env': return { text: `${where}: .env files not in the env store (they are lost with the folder)`, files: i.detail as string[] }
  }
}

/** Approval before a WorkDesk is cleared: what would be lost, then an explicit confirmation. */
export function ClearDialog({ desk, onConfirm, onClose }: Props) {
  const api = window.workdesk
  const [issues, setIssues] = useState<PreflightIssue[]>()
  const [understood, setUnderstood] = useState(false)
  // Branches of the WorkDesk, ticked to be deleted (locally) with it
  const [branches, setBranches] = useState<ClearBranch[]>([])
  // the remote is asked for the Branches (a fetch: it can take a while); nothing can be confirmed before it answered
  const [branchesLoaded, setBranchesLoaded] = useState(false)
  const [drop, setDrop] = useState<ReadonlySet<string>>(new Set())
  // the branch on the remote too (only offered where it is still there)
  const [dropRemote, setDropRemote] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string>()

  useEffect(() => {
    void api.clearPreflight(desk.id).then(setIssues, (e: Error) => setError(clean(e)))
    void api.clearBranches(desk.id).then(setBranches, () => undefined).finally(() => setBranchesLoaded(true))
  }, [api, desk.id])

  const risky = (issues?.length ?? 0) > 0
  const key = (i: { project: string; branch: string }) => `${i.project}\n${i.branch}`
  const canClear = issues !== undefined && branchesLoaded && (!risky || understood)

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3>Clear "{desk.name}"?</h3>
        <p className="hint">
          Its notes, final Stage and Claude sessions are archived in the Status Repo; the terminals, editor window and Branch folders are removed.
          Branches stay unless you tick them below, and its Todos stay.
        </p>
        {error && <div className="error">{error}</div>}
        {!issues && !error && <p className="hint"><Spinner /> Checking for work that would be lost…</p>}
        {issues && !risky && <p className="ok-text">Nothing to lose: everything is committed and pushed.</p>}
        {risky && (
          <div className="preflight">
            <strong>This would leave behind or lose:</strong>
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
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /> I understand, clear it anyway
            </label>
          </div>
        )}
        {!branchesLoaded && <p className="hint"><Spinner /> Asking the remote about the Branches…</p>}
        {branches.length > 0 && (
          <div className="preflight">
            <strong>Delete the Branches too?</strong>
            {branches.find((b) => b.stale) && <small className="hint">The remote could not be asked ({branches.find((b) => b.stale)!.stale}): what it says of the Branches may be out of date.</small>}
            {branches.map((i) => {
              const toggle = (set: ReadonlySet<string>, put: (s: ReadonlySet<string>) => void) => (e: { target: { checked: boolean } }) => {
                const next = new Set(set)
                if (e.target.checked) next.add(key(i))
                else next.delete(key(i))
                put(next)
              }
              return (
                <div key={key(i)}>
                  <div>{i.project} · {i.branch}</div>
                  {i.onRemote && (
                    <label className="pr-toggle">
                      <input
                        type="checkbox"
                        checked={dropRemote.has(key(i))}
                        onChange={(e) => {
                          toggle(dropRemote, setDropRemote)(e)
                          // the local copy only goes after the remote one
                          if (!e.target.checked) setDrop((s) => (s.has(key(i)) ? new Set([...s].filter((k) => k !== key(i))) : s))
                        }}
                      />{' '}
                      delete on the remote (origin)
                      <small className="hint"> {i.unsafeOnRemote ? '— nothing else would have its commits' : '— still on the remote'}</small>
                    </label>
                  )}
                  {i.local && (
                    <label className="pr-toggle">
                      <input type="checkbox" checked={drop.has(key(i))} disabled={i.onRemote && !dropRemote.has(key(i))} onChange={toggle(drop, setDrop)} /> delete here (the clone)
                      <small className="hint"> {i.onRemote && !dropRemote.has(key(i)) ? '— tick the remote one first' : i.unsafe ? '— its commits are on no remote branch: lost for good' : '— its commits are safe on a remote branch'}</small>
                    </label>
                  )}
                  {!i.onRemote && <small className="hint"> not on the remote any more</small>}
                </div>
              )
            })}
          </div>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button
            className="danger"
            disabled={!canClear}
            onClick={() => onConfirm(branches.filter((i) => drop.has(key(i)) || dropRemote.has(key(i))).map((i) => ({ project: i.project, branch: i.branch, local: drop.has(key(i)), remote: dropRemote.has(key(i)) })))}
          >
            Clear WorkDesk
          </button>
        </div>
      </div>
    </div>
  )
}
