import { useCallback, useState, type ReactNode } from 'react'
import type { AppState } from '../shared/api'
import type { BranchRow } from '../main/branches-service'
import type { WorkDesk } from '../main/domain/types'
import { claimedKeys, deskItemOf, prItem, ticketItem, type WorkItem } from '../main/domain/work-items'
import { Spinner } from './Spinner'

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

interface Props {
  desk: WorkDesk
  state: AppState
  run: (action: () => Promise<AppState>) => Promise<void>
  onClose: () => void
}

/** A folded section that asks for its list only when it is opened for the first time. */
function Lazy<T>({ title, load, children }: { title: string; load: () => Promise<T>; children: (data: T, reload: () => void) => ReactNode }) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [asked, setAsked] = useState(false)
  const fetchIt = useCallback(() => {
    setLoading(true)
    setError(undefined)
    load().then(setData, (e: Error) => setError(clean(e))).finally(() => setLoading(false))
  }, [load])
  return (
    <details
      className="lazy-section"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && !asked) {
          setAsked(true)
          fetchIt()
        }
      }}
    >
      <summary>{title} {loading && <Spinner />}</summary>
      {error && <div className="error">{error} <button onClick={fetchIt}>Try again</button></div>}
      {data !== undefined && children(data, fetchIt)}
    </details>
  )
}

function ItemRows({ items, onAdd, why }: { items: WorkItem[]; onAdd: (i: WorkItem) => void; why?: string }) {
  if (why) return <p className="hint">{why}</p>
  if (items.length === 0) return <p className="hint">Nothing to add.</p>
  return (
    <ul className="work-items add-rows">
      {items.map((i) => (
        <li key={i.key}>
          <span className="work-item-text">
            <span className="title">{i.ticketKey && <span className="ticket-key">{i.ticketKey}</span>} {i.title}</span>
            {i.subtitle && <small className="hint">{i.subtitle}</small>}
          </span>
          {i.hint && <span className="chip small">{i.hint}</span>}
          <button onClick={() => onAdd(i)}>Add</button>
        </li>
      ))}
    </ul>
  )
}

/**
 * Put something into the WorkDesk: a Todo (a new one, or one of yours that no WorkDesk has), or, from folded lists that
 * are only read when opened, a pull request, a ticket of yours or an existing branch.
 */
export function AddItemModal({ desk, state, run, onClose }: Props) {
  const api = window.workdesk
  const [title, setTitle] = useState('')
  const [existing, setExisting] = useState('')
  const [filter, setFilter] = useState('')
  const free = state.todos.filter((t) => !t.deskId && !t.resolved)
  const taken = claimedKeys(state.desks)

  const loadPrs = useCallback(async () => {
    const [asked, mine] = await Promise.all([api.candidates('github-prs'), api.myPrs().catch(() => [])])
    return [...mine.map((c) => prItem(c, 'mine', c.hint)), ...asked.filter((c) => !c.draft && !c.dependencyUpdate).map((c) => prItem(c, 'review'))]
  }, [api])
  const loadTickets = useCallback(async () => (await api.candidates('notion-tickets')).map(ticketItem), [api])
  const loadBranches = useCallback(async () => {
    const all = await api.listBranches(false)
    return all.flatMap((p) => p.branches.filter((b) => !b.inDesk && !b.checkedOutAt).map((b) => ({ ...b, project: p.project }) as BranchRow & { project: string }))
  }, [api])

  const addItem = (i: WorkItem) => {
    const item = deskItemOf(i)
    if (item) void run(() => api.deskAddItem(desk.id, item))
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide add-items" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3>Add to this WorkDesk</h3>
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault()
            if (!title.trim()) return
            void run(() => api.deskNewTodo(desk.id, title))
            onClose()
          }}
        >
          <span>New Todo</span>
          <div className="add">
            <input autoFocus placeholder="What is to be done?" value={title} onChange={(e) => setTitle(e.target.value)} />
            <button type="submit" disabled={!title.trim()}>Add</button>
          </div>
        </form>
        <div className="field">
          <span>One of your Todos</span>
          <div className="add">
            <select value={existing} onChange={(e) => setExisting(e.target.value)} title="A Todo that is in no WorkDesk">
              <option value="">{free.length === 0 ? 'No free Todos' : 'Choose a Todo…'}</option>
              {free.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <button
              disabled={!existing}
              onClick={() => {
                void run(() => api.deskAddTodo(desk.id, existing))
                onClose()
              }}
            >
              Add
            </button>
          </div>
        </div>

        <Lazy title="Pull requests" load={loadPrs}>
          {(items) => <ItemRows items={items.filter((i) => !taken.has(i.key))} onAdd={addItem} />}
        </Lazy>
        <Lazy title="Notion tickets assigned to me" load={loadTickets}>
          {(items) => <ItemRows items={items.filter((i) => !taken.has(i.key))} onAdd={addItem} />}
        </Lazy>
        {(
          <Lazy title="Branches" load={loadBranches}>
            {(rows) => {
              const q = filter.trim().toLowerCase()
              const shown = rows.filter((b) => !desk.branches.some((d) => d.project === b.project && d.branch === b.name) && (!q || b.name.toLowerCase().includes(q) || b.project.toLowerCase().includes(q))).slice(0, 100)
              return (
                <>
                  <input className="work-search" placeholder="Filter branches…" value={filter} onChange={(e) => setFilter(e.target.value)} />
                  {shown.length === 0 && <p className="hint">No free branch{q ? ' matches' : ''}.</p>}
                  <ul className="work-items add-rows">
                    {shown.map((b) => (
                      <li key={b.project + '\u0000' + b.name}>
                        <span className="work-item-text">
                          <span className="title"><code>{b.name}</code></span>
                          <small className="hint">{b.project}{b.subject ? ` · ${b.subject}` : ''}</small>
                        </span>
                        <button onClick={() => void run(() => api.addExistingBranches(desk.id, [{ project: b.project, branch: b.name }]))}>Check out</button>
                      </li>
                    ))}
                  </ul>
                </>
              )
            }}
          </Lazy>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
