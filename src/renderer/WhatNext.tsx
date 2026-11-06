import type { AppState } from '../shared/api'
import { dueLabel } from '../main/domain/reminders'
import { untilLabel } from '../main/domain/postpone'
import { whatNext, type NextItem } from '../main/domain/what-next'
import { closableDeskIds } from '../main/domain/closable'
import { usePrStates } from './PrStates'
import { Snooze } from './DeskTodos'
import './desk-todos.css'

interface Props {
  state: AppState
  run: (action: () => Promise<AppState>) => Promise<void>
  openDesk: (id: string) => void
  openTodo: (id: string) => void
  /** on the Dashboard: a panel with a smaller heading */
  embedded?: boolean
  /** clear a WorkDesk that is done (asks for approval first) */
  onClear?: (deskId: string) => void
  /** kinds shown elsewhere (the Dashboard's Needs you list) */
  skip?: NextItem['kind'][]
}

/** What is waiting for you across all WorkDesks: open Signals, open Todos (due ones first), postponed WorkDesks coming back. */
export function WhatNext({ state, run, openDesk, openTodo, embedded, onClear, skip = [] }: Props) {
  const api = window.workdesk
  const now = Date.now()
  const prStates = usePrStates()
  const items = whatNext(state.todos, state.desks, now, closableDeskIds(state.desks, state.todos, prStates)).filter((i) => !skip.includes(i.kind))
  const group = (kind: NextItem['kind']) => items.filter((i) => i.kind === kind)
  const signals = group('signal') as Extract<NextItem, { kind: 'signal' }>[]
  const todos = group('todo') as Extract<NextItem, { kind: 'todo' }>[]
  const postponed = group('postponed') as Extract<NextItem, { kind: 'postponed' }>[]
  const closable = group('closable') as Extract<NextItem, { kind: 'closable' }>[]

  return (
    <div className={'what-next' + (embedded ? ' panel' : '')}>
      {embedded ? <h3>What next?</h3> : <h2>What next?</h2>}
      {items.length === 0 && <p className="empty">Nothing is waiting for you.</p>}

      {signals.length > 0 && (
        <section>
          <h3>Signals ({signals.length})</h3>
          <ul>
            {signals.map((s) => (
              <li key={s.signal.id}>
                <span className="next-kind">{s.signal.type.replace(/-/g, ' ')}</span>
                <span className="next-title">{s.deskName}{s.signal.message ? `: ${s.signal.message}` : ''}</span>
                <button className="link-btn" onClick={() => openDesk(s.deskId)}>Open</button>
                <button className="link-btn" onClick={() => void run(async () => api.markSignalRead(s.deskId, s.signal.id))}>Mark read</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {todos.length > 0 && (
        <section>
          <h3>Todos ({todos.length})</h3>
          <ul>
            {todos.map((t) => (
              <li key={t.todo.id} className={t.overdue ? 'overdue' : ''}>
                <input type="checkbox" checked={false} title="Resolve it" onChange={() => void run(() => api.setTodoResolved(t.todo.id, true))} />
                <span className="next-kind">{t.todo.dueAt !== undefined ? dueLabel(t.todo, now) : ''}</span>
                <span className="next-title" title={t.todo.title}>{t.todo.title}{t.deskName ? ` · ${t.deskName}` : ''}</span>
                {t.todo.dueAt !== undefined && <Snooze todo={t.todo} run={run} />}
                <button className="link-btn" onClick={() => (t.deskId ? openDesk(t.deskId) : openTodo(t.todo.id))}>Open</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {closable.length > 0 && (
        <section>
          <h3>Can be cleared ({closable.length})</h3>
          <ul>
            {closable.map((c) => (
              <li key={c.deskId}>
                <span className="next-kind" title="Its pull requests are merged or closed and its Todos are resolved">done</span>
                <span className="next-title">{c.deskName}</span>
                <button className="link-btn" onClick={() => openDesk(c.deskId)}>Open</button>
                {onClear && <button className="link-btn" onClick={() => onClear(c.deskId)}>Clear…</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {postponed.length > 0 && (
        <section>
          <h3>Postponed WorkDesks ({postponed.length})</h3>
          <ul>
            {postponed.map((p) => (
              <li key={p.deskId} className={p.due ? 'overdue' : ''}>
                <span className="next-kind">{p.due ? 'back' : `back ${untilLabel(p.until, now)}`}</span>
                <span className="next-title">{p.deskName}</span>
                <button className="link-btn" onClick={() => openDesk(p.deskId)}>Open</button>
                {!p.due && <button className="link-btn" onClick={() => void run(() => api.postponeDesk(p.deskId, null))}>Bring back now</button>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
