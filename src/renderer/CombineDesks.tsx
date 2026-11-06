import { useState } from 'react'
import type { AppState } from '../shared/api'
import type { WorkDesk } from '../main/domain/types'
import { Modal } from './Modal'
import { cleanError } from './ProfilesSettings'

/** Make one WorkDesk of several: the ones ticked go into this one and are cleared, with their branch folders, pull requests, Todos, pages, note and time. */
export function CombineDesks({ desk, desks, run, onClose, onDone }: { desk: WorkDesk; desks: WorkDesk[]; run: (action: () => Promise<AppState>) => Promise<void>; onClose: () => void; onDone: () => void }) {
  const others = desks.filter((d) => d.id !== desk.id)
  const [ticked, setTicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const taken = others.filter((d) => ticked.includes(d.id))
  const folders = taken.reduce((n, d) => n + d.branches.length, 0)

  const toggle = (id: string) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]))

  const combine = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await run(() => window.workdesk.combineDesks(desk.id, ticked))
      onDone()
    } catch (e) {
      setError(cleanError(e))
      setBusy(false)
    }
  }

  return (
    <Modal title={`Combine into “${desk.name}”`} submitLabel={taken.length > 1 ? `Combine ${taken.length} WorkDesks` : 'Combine'} busy={busy} error={error} canSubmit={taken.length > 0} onClose={onClose} onSubmit={() => void combine()}>
      {others.length === 0 ? (
        <p className="hint">There is no other WorkDesk.</p>
      ) : (
        <>
          <p className="hint">Tick the WorkDesks to take into this one. Each is cleared afterwards.</p>
          <ul className="combine-list">
            {others.map((d) => (
              <li key={d.id}>
                <label className="check">
                  <input type="checkbox" checked={ticked.includes(d.id)} onChange={() => toggle(d.id)} />
                  <span className="combine-name">{d.name}</span>
                  <span className="hint">
                    {d.presence === 'parked' ? 'parked · ' : d.presence === 'planned' ? 'planned · ' : ''}
                    {d.branches.length} folder{d.branches.length === 1 ? '' : 's'} · {(d.items ?? []).length} item{(d.items ?? []).length === 1 ? '' : 's'}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {taken.length > 0 && (
            <p className="hint">
              {folders > 0 ? `${folders} branch folder${folders === 1 ? '' : 's'} move here with their uncommitted work and review comments. ` : ''}
              Their pull requests, Todos, attached pages, notes and time come along. Their terminals are closed and their tabs and Claude sessions are archived with them; running programs end.
            </p>
          )}
        </>
      )}
    </Modal>
  )
}
