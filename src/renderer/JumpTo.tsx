import { useEffect, useState } from 'react'
import { filterJump, type JumpItem } from './jump-to'

/**
 * "Jump to…" (a command of Cmd+P): every open place of the WorkDesks, the Browser page and the Files page in one list, grouped by
 * WorkDesk. Typing keeps the rows that have every word in their name, address, path, Tab or WorkDesk.
 */
export function JumpTo({ load, onPick, onCancel }: { load: () => Promise<JumpItem[]>; onPick: (item: JumpItem) => void; onCancel: () => void }) {
  const [items, setItems] = useState<JumpItem[]>()
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  useEffect(() => void load().then(setItems), [load])

  const shown = filterJump(items ?? [], query)
  const cursor = Math.min(at, Math.max(shown.length - 1, 0))

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal palette" role="dialog" aria-label="Jump to">
        <input
          autoFocus
          className="palette-input"
          placeholder="Jump to a tab, page or file by name, address, path or WorkDesk…"
          value={query}
          onChange={(e) => (setQuery(e.target.value), setAt(0))}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
            else if (e.key === 'Enter') shown[cursor] && onPick(shown[cursor])
            else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) setAt(Math.min(shown.length - 1, cursor + 1))
            else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) setAt(Math.max(0, cursor - 1))
            else return
            e.preventDefault()
            e.stopPropagation()
          }}
        />
        <ul className="palette-list" role="listbox">
          {shown.map((r, i) => (
            <li key={r.key} className="jump-row-wrap">
              {(i === 0 || shown[i - 1].group !== r.group) && <div className="jump-group">{r.group}</div>}
              <div
                ref={(el) => { if (el && i === cursor) el.scrollIntoView({ block: 'nearest' }) }}
                role="option"
                aria-selected={i === cursor}
                className={`jump-row${i === cursor ? ' selected' : ''}`}
                onMouseMove={() => i !== cursor && setAt(i)}
                onClick={() => onPick(r)}
              >
                <span className="palette-title">{r.title}</span>
                <span className="palette-hint">{r.hint}</span>
                <span className="palette-group">{r.badge}</span>
              </div>
            </li>
          ))}
          {items && shown.length === 0 && <li className="empty">Nothing matches “{query}”.</li>}
          {!items && <li className="empty">Looking…</li>}
        </ul>
      </div>
    </div>
  )
}
