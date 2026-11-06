import { useState } from 'react'
import type { DeskRunning } from '../main/park-all'
import { stageLabel } from '../main/domain/stage'
import type { WorkDesk } from '../main/domain/types'
import { Modal } from './Modal'
import { setWaitingPolicy, skipWaitingFor } from './waiting-policy'

/** A WorkDesk moved to Waiting: park it (frees what its terminals and editor use), or keep it active. */
export function WaitingModal({ desk, running, more, onPark, onKeep }: { desk: WorkDesk; running?: DeskRunning; more: number; onPark: () => void; onKeep: () => void }) {
  const [remember, setRemember] = useState(false)
  const [never, setNever] = useState(false)
  const keep = () => {
    if (never) skipWaitingFor(desk.id)
    else if (remember) setWaitingPolicy('keep')
    onKeep()
  }
  const programs = running?.programs ?? []
  return (
    <Modal
      title="WorkDesk moved to Waiting"
      submitLabel="Park it"
      onClose={keep}
      onSubmit={() => (remember && setWaitingPolicy('park'), onPark())}
      extra={<button type="button" onClick={keep}>Keep it active</button>}
    >
      <p>
        <strong>{desk.name}</strong> is now <em>{stageLabel(desk.stage)}</em>: it waits for somebody else and nothing needs you. Park it to give back what its terminals and editor window use, or leave it active.
      </p>
      <p className="hint">
        Parking shuts its terminals and VS Code window down; tabs, notes, branches and Claude sessions are kept, and a new Signal or you opening it brings it back.
        {programs.length > 0 && <> Running in it now: <strong>{programs.join(', ')}</strong>, which would end.</>}
        {running && running.claudeWithoutSession > 0 && <> A Claude session without a saved session could not be resumed.</>}
      </p>
      {more > 0 && <p className="hint">{more} more moved to Waiting; you are asked about each.</p>}
      <label className="check" title="This WorkDesk is not asked about again; the others still are">
        <input type="checkbox" checked={never} onChange={(e) => setNever(e.target.checked)} /> Do not ask again for this WorkDesk (with Keep it active)
      </label>
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember my choice (Settings → Behavior)
      </label>
    </Modal>
  )
}
