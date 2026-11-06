import { useCallback, useEffect, useState } from 'react'
import type { AppState } from '../shared/api'
import type { ArchivedTodo } from '../main/domain/types'

interface Props {
  run: (action: () => Promise<AppState>) => Promise<void>
  /** changes when something was archived, so an open list reloads */
  version: number
}

const day = (ms?: number) => (ms ? new Date(ms).toLocaleDateString() : 'earlier')

/** Resolved Todos that were put away: search them, or bring one back. */
export function TodoArchive({ run, version }: Props) {
  const [items, setItems] = useState<ArchivedTodo[]>()
  const [text, setText] = useState('')

  const load = useCallback(() => void window.workdesk.archivedTodos().then(setItems), [])
  useEffect(() => {
    load()
  }, [load, version])

  const q = text.trim().toLowerCase()
  const shown = (items ?? [])
    .filter((t) => !q || t.title.toLowerCase().includes(q) || t.topics.some((x) => x.includes(q)))
    .sort((a, b) => (b.resolvedAt ?? b.archivedAt) - (a.resolvedAt ?? a.archivedAt))

  return (
    <div className="panel todo-archive">
      <h3>Resolved Todos{items ? ` (${items.length})` : ''}</h3>
      <input placeholder="Search the archive…" value={text} onChange={(e) => setText(e.target.value)} />
          <ul className="todos">
            {shown.map((t) => (
              <li key={t.id}>
                <span className="title">{t.title}</span>
                {t.topics.map((x) => <span key={x} className="chip small">{x}</span>)}
                <small className="hint">resolved {day(t.resolvedAt)}</small>
                <span className="actions">
                  <button title="Back into your Todos, open" onClick={() => void run(() => window.workdesk.restoreTodo(t.id)).then(load)}>Restore</button>
                </span>
              </li>
            ))}
            {items && shown.length === 0 && <li className="empty">{items.length === 0 ? 'Nothing archived yet.' : 'No match.'}</li>}
          </ul>
    </div>
  )
}
