import { useState } from 'react'

/** A small dialog to put a tab in a group of the list of tabs: type a name (existing groups are suggested), or leave it empty for no group. */
export function GroupDialog({ current, groups, onSave, onCancel }: { current?: string; groups: string[]; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(current ?? '')
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-label="Group of the tab" onKeyDown={(e) => (e.key === 'Escape' ? onCancel() : e.key === 'Enter' && onSave(name))}>
        <h3>Group of this tab</h3>
        <label className="field">
          <span>Group (empty: none)</span>
          <input autoFocus value={name} list="tab-groups" placeholder="e.g. terminals, prs, research" onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
          <datalist id="tab-groups">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </label>
        <p className="hint">In a list of tabs the group is a heading with its tabs under it; click the heading to fold it.</p>
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={() => onSave(name)}>Save</button>
        </div>
      </div>
    </div>
  )
}
