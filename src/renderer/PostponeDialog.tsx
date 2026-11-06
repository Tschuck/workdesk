import { useState } from 'react'
import { postponeOptions, untilLabel } from '../main/domain/postpone'

/** Asks until when a WorkDesk is put aside: a list of times with a search input (type "3" for 3 hours). */
export function PostponeDialog({ name, onPick, onCancel }: { name: string; onPick: (until: number) => void; onCancel: () => void }) {
  const [now] = useState(() => Date.now())
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const shown = postponeOptions(query, now)
  const cursor = Math.min(at, Math.max(shown.length - 1, 0))

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal palette" role="dialog" aria-label={`Postpone ${name}`}>
        <input
          autoFocus
          className="palette-input"
          placeholder={`Postpone “${name}” for…`}
          value={query}
          onChange={(e) => (setQuery(e.target.value), setAt(0))}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
            else if (e.key === 'Enter') shown[cursor] && onPick(shown[cursor].until)
            else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) setAt(Math.min(shown.length - 1, cursor + 1))
            else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) setAt(Math.max(0, cursor - 1))
            else return
            e.preventDefault()
            e.stopPropagation()
          }}
        />
        <ul className="palette-list" role="listbox">
          {shown.map((o, i) => (
            <li key={o.label} role="option" aria-selected={i === cursor} className={i === cursor ? 'selected' : ''} onMouseMove={() => i !== cursor && setAt(i)} onClick={() => onPick(o.until)}>
              <span className="palette-title">{o.label}</span>
              <span className="palette-hint">back {untilLabel(o.until, now)}</span>
            </li>
          ))}
          {shown.length === 0 && <li className="empty">Try a number of hours, like 3.</li>}
        </ul>
        <p className="hint">It comes back by itself, or at once when something needs you.</p>
      </div>
    </div>
  )
}
