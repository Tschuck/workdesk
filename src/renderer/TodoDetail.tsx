import { useOpenLink } from './OpenLink'
import { useEffect, useState } from 'react'
import type { AppState } from '../shared/api'
import { localDateString } from '../main/domain/todos'
import { NotesEditor } from './NotesEditor'
import { prReadiness, READINESS_LABEL } from '../main/domain/prs'
import { Pills } from './Pills'
import { PrChips, usePrState } from './PrStates'
import { PageRefsPanel } from './PageRefs'

interface Props {
  todoId: string
  state: AppState
  run: (action: () => Promise<AppState>) => Promise<void>
  /** back to where it was opened from; in a side pane: clear the selection */
  onBack: () => void
  openDesk?: (id: string) => void
  /** shown in a pane next to a list: no back button, no Esc */
  embedded?: boolean
}

/** One Todo: title, topics, link, resolve, delete and its markdown notes. */
export function TodoDetail({ todoId, state, run, onBack, openDesk, embedded }: Props) {
  const api = window.workdesk
  const openLink = useOpenLink()
  const todo = state.todos.find((t) => t.id === todoId)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const pr = usePrState(todo ?? {})
  const [topics, setTopics] = useState(todo?.topics.join(', ') ?? '')

  useEffect(() => setConfirmDelete(false), [todoId])
  useEffect(() => setTopics(todo?.topics.join(', ') ?? ''), [todo?.topics])
  useEffect(() => {
    if (embedded) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target instanceof HTMLTextAreaElement) && onBack()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack, embedded])

  if (!todo) {
    return (
      <section>
        {!embedded && <button onClick={onBack}>← Back</button>}
        <p className="empty">This Todo is gone.</p>
      </section>
    )
  }

  const desk = todo.deskId ? state.desks.find((d) => d.id === todo.deskId) : undefined
  // an attached page opens as a browser tab of the Todo's WorkDesk (when it is running), otherwise like any link
  const openRef = (url: string) => {
    if (desk && openDesk && desk.presence !== 'parked' && desk.presence !== 'planned') void api.addTab(desk.id, 'browser', url).then(() => openDesk(desk.id))
    else void openLink(url)
  }
  const info = [
    `added ${localDateString(todo.createdAt)}`,
    todo.source?.ticketKey,
    todo.resolved ? 'resolved' : undefined
  ].filter(Boolean)

  return (
    <section className={'todo-detail' + (embedded ? ' embedded' : '')}>
      {!embedded && (
        <div className="detail-head">
          <button title="Back (Esc)" onClick={onBack}>← Back</button>
          <span className="sec-title">Todo</span>
        </div>
      )}

      <input
        className="detail-title"
        key={todo.id + '\u0000' + todo.title}
        defaultValue={todo.title}
        onBlur={(e) => {
          const v = e.target.value.trim()
          if (v && v !== todo.title) void run(() => api.editTodo(todo.id, { title: v }))
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <div className="pills"><Pills todo={todo} /></div>
      {pr && (
        <div className={'panel pr-card' + (prReadiness(pr) === 'ready' ? ' ready' : '')}>
          <div className="detail-row">
            <strong className="pr-title" onClick={() => void openLink(pr.url)} title={pr.url}>{pr.title}</strong>
            <span className="grow" />
            <button onClick={() => void openLink(pr.url)}>Open on GitHub ↗</button>
            <button title="Ask GitHub again" onClick={() => void api.refreshPrTodos()}>↻</button>
          </div>
          <div className="pills"><PrChips todo={todo} /><span className="hint">→ {pr.base} · {pr.approvals} approval{pr.approvals === 1 ? '' : 's'}</span></div>
          <p className="hint">
            {prReadiness(pr) === 'ready' ? 'Approved and the checks are done: ready for you to merge on GitHub.'
              : prReadiness(pr) === 'ci-running' ? 'Waiting for the checks. You are told when it is ready to merge.'
              : READINESS_LABEL[prReadiness(pr)] + '.'}
          </p>
        </div>
      )}
      <label className="field">
        <span>WorkDesk</span>
        <div className="detail-row">
          <select
            value={todo.deskId ?? ''}
            title="The WorkDesk this Todo belongs to; choose another one to move it"
            onChange={(e) => void run(() => api.deskAssignTodo(todo.id, e.target.value || null))}
          >
            <option value="">None</option>
            {state.desks.map((d) => (
              <option
                key={d.id}
                value={d.id}
              >
                {d.name}{d.presence === 'parked' ? ' (parked)' : ''}
              </option>
            ))}
          </select>
          {desk && openDesk && <button onClick={() => openDesk(desk.id)}>Open</button>}
        </div>
      </label>
      <label className="field">
        <span>Topics (comma separated)</span>
        <input
          value={topics}
          onChange={(e) => setTopics(e.target.value)}
          onBlur={() => void run(() => api.editTodo(todo.id, { topics: topics.split(',') }))}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>
      {todo.source?.url && (
        <a className="detail-link" href={todo.source.url} onClick={(e) => (e.preventDefault(), void openLink(todo.source!.url!))}>
          {todo.source.url.replace(/^https?:\/\/(www\.)?/, '')}
        </a>
      )}
      <div className="hint">{info.join(' · ')}</div>
      <PageRefsPanel target={{ kind: 'todo', id: todo.id }} refs={todo.refs} run={run} onOpen={openRef} />

      <div className="detail-actions">
        <span className="grow" />
        <button
          className={confirmDelete ? 'danger' : ''}
          disabled={!!todo.deskId}
          title={todo.deskId ? 'Move the Todo out of its WorkDesk first' : 'Remove it together with its notes'}
          onClick={() => {
            if (!confirmDelete) return setConfirmDelete(true)
            void run(() => api.deleteTodo(todo.id)).then(onBack)
          }}
          onBlur={() => setConfirmDelete(false)}
        >
          {confirmDelete ? 'Really?' : 'Delete'}
        </button>
        <button onClick={() => void run(() => api.setTodoResolved(todo.id, !todo.resolved))}>{todo.resolved ? 'Reopen' : 'Resolve'}</button>
      </div>

      <NotesEditor key={todo.id} todoId={todo.id} />
    </section>
  )
}
