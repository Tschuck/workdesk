import { useEffect, useRef, useState } from 'react'
import type { AppState } from '../shared/api'
import type { BranchRef, NewBranch } from '../main/branches-service'
import { Spinner } from './Spinner'

export interface StartRequest {
  kind: 'plain' | 'branches'
  todoIds: string[]
  /** for `branches`: the existing branches to check out */
  branches?: BranchRef[]
  /** for `branches`: branches to create */
  newBranches?: NewBranch[]
  /** suggested name: the name of the Todo */
  defaultName: string
}

interface Props {
  request: StartRequest
  run: (action: () => Promise<AppState>) => Promise<void>
  onClose: () => void
  /** the state after the WorkDesk was started */
  onStarted?: (state: AppState) => void
}

const TITLES = { plain: 'Start WorkDesk', branches: 'WorkDesk from branches' } as const

/** Asks for the name of a new WorkDesk (default: the Todo's name) and starts it. */
export function StartPanel({ request, run, onClose, onStarted }: Props) {
  const api = window.workdesk
  const [name, setName] = useState(request.defaultName)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.select()
  }, [])

  const canStart = !busy && name.trim() !== ''

  const start = async () => {
    if (!canStart) return
    setBusy(true)
    const n = name.trim()
    let result: AppState | undefined
    await run(async () => {
      result =
        request.kind === 'plain' ? await api.startPlainDesk(request.todoIds, n)
        : await api.createDeskFromBranches(request.branches ?? [], n, request.newBranches)
      return result
    })
    setBusy(false)
    onClose()
    if (result) onStarted?.(result)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault()
          void start()
        }}
        onKeyDown={(e) => e.key === 'Escape' && !busy && onClose()}
      >
        <h3>{TITLES[request.kind]}</h3>
        <label className="field">
          <span>Name of the WorkDesk</span>
          <input ref={input} autoFocus value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        </label>
        {request.kind === 'branches' && (
          <p className="hint">
            {request.newBranches?.length ? `Creates ${request.newBranches.map((b) => b.branch).join(', ')}${request.branches?.length ? ' and ' : '.'}` : ''}
            {request.branches?.length ? `Checks out ${request.branches.length} existing branch(es)` : ''} in their own worktrees. Branches that sit on top of
            each other form a Stack.
          </p>
        )}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!canStart}>
            {busy && <Spinner />} {busy ? 'Starting…' : 'Start'}
          </button>
        </div>
      </form>
    </div>
  )
}
