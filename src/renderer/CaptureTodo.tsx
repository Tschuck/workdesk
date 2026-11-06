import { useState } from 'react'

/** Asks for the title of a Todo for the WorkDesk you are in (or for Today, outside a WorkDesk). Opened by the global shortcut. */
export function CaptureTodo({ deskName, onSave, onCancel }: { deskName?: string; onSave: (title: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('')
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal palette" role="dialog" aria-label="Capture a Todo">
        <input
          autoFocus
          className="palette-input"
          placeholder={deskName ? `New Todo for “${deskName}”…` : 'New Todo for Today…'}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
            else if (e.key === 'Enter' && title.trim()) onSave(title.trim())
            else return
            e.preventDefault()
            e.stopPropagation()
          }}
        />
        <p className="hint">Enter adds it, Esc cancels.</p>
      </div>
    </div>
  )
}
