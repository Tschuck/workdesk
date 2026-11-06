import { useState } from 'react'
import { announceTemplates } from './TemplatesSettings'

/** Asks for a name to save a WorkDesk as a template: its Stage, open Todos and Tabs. */
export function SaveTemplateDialog({ deskName, deskId, onClose }: { deskName: string; deskId: string; onClose: () => void }) {
  const [name, setName] = useState(deskName)
  const [kindsOnly, setKindsOnly] = useState(false)
  const [error, setError] = useState<string>()
  const save = async () => {
    try {
      await window.workdesk.templateSave(deskId, name, kindsOnly)
      announceTemplates()
      onClose()
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Save as template">
        <h3>Save “{deskName}” as a template</h3>
        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' && name.trim() ? void save() : e.key === 'Escape' && onClose())} />
        </label>
        <label className="field inline">
          <input type="checkbox" checked={kindsOnly} onChange={(e) => setKindsOnly(e.target.checked)} />
          <span>Keep only the kinds of Panes (no pages and files)</span>
        </label>
        <p className="hint">Kept: the Stage, the Todos that are still open (in checklist order) and the Tabs with their Panes{kindsOnly ? ' (terminal, browser, file; empty)' : ', with the pages and files they show'}.</p>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!name.trim()} onClick={() => void save()}>Save</button>
        </div>
      </div>
    </div>
  )
}
