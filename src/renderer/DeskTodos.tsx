import { AddButton, Field, Modal } from './Modal'
import { useState } from 'react'
import type { AppState } from '../shared/api'
import { deskChecklist, progress } from '../main/domain/desk-todos'
import { postponeOptions } from '../main/domain/postpone'
import { REPEATS } from '../main/domain/recurrence'
import { dueLabel, fromLocalInput, isOverdue, toLocalInput } from '../main/domain/reminders'
import type { Todo, WorkDesk } from '../main/domain/types'
import { ContextMenu } from './ContextMenu'
import { useSortable } from './useSortable'
import './desk-todos.css'

interface Props {
  desk: WorkDesk
  state: AppState
  run: (action: () => Promise<AppState>) => Promise<void>
  /** show the details of a Todo */
  onOpen?: (id: string) => void
}

const FOLD_KEY = 'workdesk.deskTodosFolded'
const wasFolded = (): boolean => {
  try {
    return localStorage.getItem(FOLD_KEY) === '1'
  } catch {
    return false
  }
}

/** The checklist of a WorkDesk, for its header: add, tick, reorder (drag, or the arrows), due time with reminder and snooze, delete. */
export function DeskTodos({ desk, state, run, onOpen }: Props) {
  const api = window.workdesk
  const list = deskChecklist(desk, state.todos)
  const { done, total } = progress(list)
  const [title, setTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const [dueFor, setDueFor] = useState<string>()
  // the Todo that asks to be deleted
  const [confirming, setConfirming] = useState<string>()
  const [menu, setMenu] = useState<{ x: number; y: number; todo: Todo; index: number }>()
  const sort = useSortable((id, ref, after) => void run(() => api.placeDeskTodo(desk.id, id, ref, after)), undefined, () => true)
  const now = Date.now()
  // folded, only the head with its count shows; kept for every WorkDesk
  const [folded, setFolded] = useState(wasFolded)
  const fold = () =>
    setFolded((f) => {
      try {
        localStorage.setItem(FOLD_KEY, f ? '0' : '1')
      } catch {
        /* not kept */
      }
      return !f
    })

  const add = () => {
    const t = title.trim()
    if (!t) return
    setTitle('')
    setAdding(false)
    void run(() => api.captureTodo(desk.id, t))
  }
  /** take it out of the WorkDesk and delete it */
  const remove = (t: Todo) => void run(async () => (await api.deskRemoveTodo(t.id), api.deleteTodo(t.id)))

  return (
    <section className="desk-todos" aria-label="Todos of this WorkDesk">
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(undefined)}
          items={[
            { label: 'Show details', disabled: !onOpen, onClick: () => onOpen?.(menu.todo.id) },
            { label: menu.todo.resolved ? 'Reopen' : 'Resolve', onClick: () => void run(() => api.setTodoResolved(menu.todo.id, !menu.todo.resolved)) },
            { label: 'Set a due time …', onClick: () => setDueFor(menu.todo.id) },
            { label: 'Move up', disabled: menu.index === 0, onClick: () => void run(() => api.stepDeskTodo(desk.id, menu.todo.id, -1)) },
            { label: 'Move down', disabled: menu.index === list.length - 1, onClick: () => void run(() => api.stepDeskTodo(desk.id, menu.todo.id, 1)) },
            { label: 'Take out of this WorkDesk', onClick: () => void run(() => api.deskRemoveTodo(menu.todo.id)) },
            { label: 'Copy title', onClick: () => void navigator.clipboard.writeText(menu.todo.title) },
            { label: 'Delete …', onClick: () => setConfirming(menu.todo.id) },
          ]}
        />
      )}
      <div className={'desk-todos-head' + (folded ? ' folded' : '')}>
        <button className="desk-todos-fold" aria-expanded={!folded} title={folded ? 'Show the Todos' : 'Fold the Todos'} onClick={fold}>
          Todos
        </button>
        {total > 0 && <span className="chip small" title="Resolved of all Todos in this WorkDesk">{done}/{total}</span>}
        <AddButton label="Add a Todo to this WorkDesk" onClick={() => setAdding(true)} />
      </div>
      {!folded && list.length > 0 && (
        <ul className="desk-todos-list">
          {list.map((t, i) => (
            <li key={t.id} className={[t.resolved ? 'done' : '', sort.classes(t.id), isOverdue(t, now) ? 'overdue' : ''].join(' ')} {...sort.props(t.id)} onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, todo: t, index: i }))}>
              <input type="checkbox" checked={t.resolved} title={t.resolved ? 'Open it again' : 'Resolve it'} onChange={(e) => void run(() => api.setTodoResolved(t.id, e.target.checked))} />
              <span className="desk-todo-title" title={t.title} onClick={() => onOpen?.(t.id)}>{t.title}</span>
              {t.dueAt !== undefined && !t.resolved && <span className="chip small desk-todo-due" title="Raises a Signal at that time">{dueLabel(t, now)}{t.snoozedUntil ? ' (snoozed)' : ''}{t.repeat ? ' ↻' : ''}</span>}
              <span className="desk-todo-tools">
                {t.dueAt !== undefined && !t.resolved && <Snooze todo={t} run={run} />}
                <button className="link-btn" title="Due time: a reminder raises a Signal then" onClick={() => setDueFor(dueFor === t.id ? undefined : t.id)}>due</button>
                <button className="link-btn" title="Move up" disabled={i === 0} onClick={() => void run(() => api.stepDeskTodo(desk.id, t.id, -1))}>↑</button>
                <button className="link-btn" title="Move down" disabled={i === list.length - 1} onClick={() => void run(() => api.stepDeskTodo(desk.id, t.id, 1))}>↓</button>
                <button className="link-btn danger" title="Delete the Todo" onClick={() => setConfirming(t.id)}>✕</button>
              </span>
              {confirming === t.id && (
                <div className="desk-todo-due-edit">
                  <span>Delete “{t.title}” for good?</span>
                  <button className="danger" autoFocus onClick={() => (setConfirming(undefined), remove(t))}>Delete</button>
                  <button onClick={() => setConfirming(undefined)} onKeyDown={(e) => e.key === 'Escape' && setConfirming(undefined)}>Keep</button>
                </div>
              )}
              {dueFor === t.id && (
                <div className="desk-todo-due-edit">
                  <input
                    type="datetime-local"
                    autoFocus
                    defaultValue={toLocalInput(t.dueAt)}
                    onKeyDown={(e) => e.key === 'Escape' && setDueFor(undefined)}
                    onChange={(e) => {
                      const at = fromLocalInput(e.target.value)
                      if (at !== undefined) void run(() => api.setTodoDue(t.id, at))
                    }}
                  />
                  {t.dueAt !== undefined && (
                    <select title="Repeat: resolving it starts the next one" value={t.repeat ?? ''} onChange={(e) => void run(() => api.setTodoRepeat(t.id, (e.target.value || null) as 'daily' | 'weekdays' | 'weekly' | null))}>
                      <option value="">no repeat</option>
                      {REPEATS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  )}
                  {t.dueAt !== undefined && <button onClick={() => (setDueFor(undefined), void run(() => api.setTodoDue(t.id, null)))}>No due time</button>}
                  <button onClick={() => setDueFor(undefined)}>Done</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <Modal title={`New Todo in ${desk.name}`} canSubmit={!!title.trim()} onClose={() => (setAdding(false), setTitle(''))} onSubmit={add}>
          <Field label="Todo"><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        </Modal>
      )}
    </section>
  )
}

/** Remind again later: a list of times (1, 2, 4, 6 hours, tomorrow). */
export function Snooze({ todo, run }: { todo: Todo; run: Props['run'] }) {
  const api = window.workdesk
  return (
    <select
      className="snooze"
      value=""
      title="Snooze: remind me again later"
      onChange={(e) => {
        const until = Number(e.target.value)
        if (until) void run(() => api.snoozeTodo(todo.id, until))
      }}
    >
      <option value="">snooze</option>
      {postponeOptions('', Date.now()).map((o) => (
        <option key={o.label} value={o.until}>{o.label}</option>
      ))}
    </select>
  )
}
