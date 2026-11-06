import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppState } from '../shared/api'
import type { PrTodoState } from '../main/domain/prs'
import type { Project } from '../main/projects/projects'
import { claimedKeys, deskItemOf, itemKey, itemNotesId, KIND_LABEL, prItem, searchItems, startList, suggestName, ticketItem, todoItem, type WorkItem } from '../main/domain/work-items'
import { PrChipsFor, ReadinessChip } from './PrStates'
import { BranchDetail } from './BranchDetail'
import { ReloadButton } from './Icons'
import { NotesEditor } from './NotesEditor'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { useOpenLink } from './OpenLink'
import { Spinner } from './Spinner'
import { TodoDetail } from './TodoDetail'

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Everything that could be worked on: open Todos of no WorkDesk, review requests, own Pull requests that need work, assigned tickets. */
export function useWorkItems(state: AppState) {
  const [prs, setPrs] = useState<WorkItem[]>([])
  const [mine, setMine] = useState<WorkItem[]>([])
  const [tickets, setTickets] = useState<WorkItem[]>([])
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [updatedAt, setUpdatedAt] = useState<number>()

  const load = useCallback(async (refresh = false) => {
    const api = window.workdesk
    setLoading(true)
    const problems: string[] = []
    const ask = async <T,>(label: string, p: Promise<T>, fallback: T): Promise<T> => {
      try {
        return await p
      } catch (e) {
        // a source that is not set up is not an error here: the dashboard's checklist says so
        if (!/not connected|connect again|database id|token/i.test((e as Error).message)) problems.push(`${label}: ${clean(e as Error)}`)
        return fallback
      }
    }
    const [a, b, c] = await Promise.all([
      ask('GitHub', api.candidates('github-prs', refresh), []),
      ask('GitHub', api.myPrsNeedingWork(refresh), []),
      ask('Notion', api.candidates('notion-tickets', refresh), [])
    ])
    setPrs(a.filter((x) => !x.draft && !x.dependencyUpdate).map((x) => prItem(x, 'review')))
    setMine(b.map((x) => prItem(x, 'mine', x.hint)))
    setTickets(c.map(ticketItem))
    setErrors([...new Set(problems)])
    const ages = (await Promise.all([api.remoteAge('candidates:'), api.remoteAge('github:my-prs')])).filter((x): x is number => x !== undefined)
    setUpdatedAt(ages.length > 0 ? Math.min(...ages) : undefined)
    setLoading(false)
  }, [])

  useEffect(() => void load(), [load])
  // a refresh somewhere else replaced what is kept: show it
  useEffect(() => window.workdesk.onRemoteChanged((key) => (key.startsWith('candidates:') || key === 'github:my-prs') && void load()), [load])

  const items = useMemo(() => {
    const taken = claimedKeys(state.desks)
    const todos = state.todos.filter((t) => !t.resolved && !t.deskId).map((t) => todoItem(t))
    return startList([...todos, ...mine, ...prs, ...tickets].filter((i) => !taken.has(i.key)))
  }, [state, prs, mine, tickets])

  const dismiss = useCallback((key: string) => {
    const drop = (list: WorkItem[]) => list.filter((i) => i.key !== key)
    setPrs(drop)
    setMine(drop)
    setTickets(drop)
  }, [])

  return { items, loading, errors, updatedAt, reload: () => load(true), dismiss }
}

const KIND_MARK: Record<WorkItem['kind'], { text: string; className: string }> = {
  todo: { text: '☐', className: 'todo' },
  pr: { text: 'PR', className: 'pr' },
  ticket: { text: 'T', className: 'ticket' }
}

export function KindIcon({ item }: { item: Pick<WorkItem, 'kind' | 'role'> }) {
  const m = KIND_MARK[item.kind]
  const label = item.kind === 'pr' ? (item.role === 'mine' ? 'Your pull request' : 'Pull request to review') : KIND_LABEL[item.kind]
  return <span className={`kind-icon ${m.className}${item.role === 'mine' ? ' mine' : ''}`} title={label}>{m.text}</span>
}

interface ListProps {
  items: WorkItem[]
  selected: string[]
  onToggle: (key: string) => void
  /** the item whose details are shown */
  openKey?: string
  onOpen: (key: string) => void
  /** show a checkbox on each row (to start several at once); default yes */
  selectable?: boolean
  /** show where each Pull Request stands (approvals, checks, ready to merge) */
  prState?: boolean
}

/** One flat list of work items: kind icon, title, where it is from and why it is here. */
export function WorkItemList({ items, selected, onToggle, openKey, onOpen, selectable = true, prState = false }: ListProps) {
  const openLink = useOpenLink()
  const [menu, setMenu] = useState<{ x: number; y: number; item: WorkItem }>()
  const menuItems = (i: WorkItem): MenuItem[] => [
    { label: 'Show details', onClick: () => onOpen(i.key) },
    ...(selectable ? [{ label: selected.includes(i.key) ? 'Unselect' : 'Select', onClick: () => onToggle(i.key) }] : []),
    ...(i.url ? [{ label: 'Open in the browser', onClick: () => void openLink(i.url!) }, { label: 'Copy link', onClick: () => void navigator.clipboard.writeText(i.url!) }] : []),
    { label: 'Copy title', onClick: () => void navigator.clipboard.writeText(i.title) },
  ]
  return (
    <ul className="work-items">
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.item)} onClose={() => setMenu(undefined)} />}
      {items.map((i) => (
        <li key={i.key} className={'clickable' + (i.key === openKey ? ' selected' : '')} onClick={() => onOpen(i.key)} onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, item: i }))}>
          {selectable && <input type="checkbox" checked={selected.includes(i.key)} onClick={(e) => e.stopPropagation()} onChange={() => onToggle(i.key)} aria-label={`Select ${i.title}`} />}
          <KindIcon item={i} />
          <span className="work-item-text">
            <span className="title">
              {i.ticketKey && <span className="ticket-key">{i.ticketKey}</span>} {i.title}
            </span>
            {i.subtitle && <small className="hint">{i.subtitle}</small>}
          </span>
          {i.hint && <span className={'chip small' + (i.role === 'mine' ? ' warn' : '')}>{i.hint}</span>}
          {prState && i.kind === 'pr' && <PrChipsFor id={i.key.slice(3)} approvals />}
        </li>
      ))}
      {items.length === 0 && <li className="empty">Nothing to pick from.</li>}
    </ul>
  )
}

/** Tabs under a work item: each one is built when it is first shown and kept, so a web page is not reloaded when you come back. */
function Tabs({ tabs }: { tabs: { id: string; label: string; content: React.ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0].id)
  const [seen, setSeen] = useState<string[]>([tabs[0].id])
  const current = tabs.some((t) => t.id === active) ? active : tabs[0].id
  return (
    <div className="tabs">
      <div className="tabs-head" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === current} className={'tab-btn' + (t.id === current ? ' active' : '')} onClick={() => (setActive(t.id), setSeen((s) => (s.includes(t.id) ? s : [...s, t.id])))}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="tabs-box">
        {tabs.filter((t) => seen.includes(t.id) || t.id === current).map((t) => (
          <div key={t.id} hidden={t.id !== current}>{t.content}</div>
        ))}
      </div>
    </div>
  )
}

/** The page of a pull request or ticket: a link, which opens as a browser Tab of the active WorkDesk (else the Browser). */
function OpenPage({ url, label }: { url?: string; label: string }) {
  const openLink = useOpenLink()
  if (!url) return null
  return (
    <p className="open-page">
      <button className="primary" title={url} onClick={() => openLink(url)}>{label}</button>
      <small className="hint">opens in the Browser</small>
    </p>
  )
}

const notesIdOf = (item: WorkItem): string => itemNotesId(item.kind as 'pr' | 'ticket', item.key.slice(item.kind.length + 1))

function PrDetail({ item, state, run, deskId }: { item: WorkItem; state: AppState; run: DetailProps['run']; deskId?: string }) {
  const id = item.key.slice(3)
  const [pr, setPr] = useState<PrTodoState>()
  const [error, setError] = useState<string>()
  const [branch, setBranch] = useState<{ project?: string; branch?: string }>()
  const [reloads, setReloads] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (reloads === 0) {
      setPr(undefined)
      setBranch(undefined)
    }
    setError(undefined)
    setBusy(true)
    const refresh = reloads > 0
    void Promise.all([
      window.workdesk.prState(id, refresh).then(setPr, (e: Error) => setError(clean(e))),
      window.workdesk.prBranch(id, refresh).then(setBranch, () => setBranch({}))
    ]).finally(() => setBusy(false))
  }, [id, reloads])
  return (
    <>
      <section className="panel">
        <h3>Pull request <ReloadButton title="Reload this pull request" busy={busy} onClick={() => setReloads((n) => n + 1)} /></h3>
        <p className="hint">{item.subtitle}</p>
        {error && <div className="error">{error}</div>}
        {!pr && !error && <p className="hint"><Spinner /> Asking GitHub…</p>}
        {pr && (
          <>
            <div className="detail-row">
              <ReadinessChip s={pr} />
              <span className="chip small">{pr.state}</span>
              {pr.draft && <span className="chip small">draft</span>}
            </div>
            <dl className="facts">
              <dt>Branch</dt>
              <dd>{pr.head ? `${pr.head} → ${pr.base}` : `into ${pr.base}`}</dd>
              <dt>Reviews</dt>
              <dd>{pr.approvals} approved{pr.changesRequested > 0 ? `, ${pr.changesRequested} asking for changes` : ''}</dd>
              <dt>Checks</dt>
              <dd>{pr.ci}</dd>
            </dl>
          </>
        )}
        <OpenPage url={item.url} label="Open pull request" />
      </section>
      <Tabs
        tabs={[
          {
            id: 'branch',
            label: 'Branch',
            content:
              branch?.project && branch.branch ? (
                <BranchDetail key={branch.project + branch.branch} project={branch.project} branch={branch.branch} desks={state.desks} run={run} onChanged={() => undefined} hidePrs inThisDesk={deskId} />
              ) : branch ? (
                <p className="hint">{branch.branch ? <>Branch <code>{branch.branch}</code>: its repository is not one of your Projects, so there is nothing to show locally.</> : 'The pull request comes from a fork: there is no branch of yours to show.'}</p>
              ) : (
                <p className="hint"><Spinner /> Looking for the branch…</p>
              )
          },
          { id: 'notes', label: 'Notes', content: <NotesEditor key={item.key} todoId={notesIdOf(item)} /> }
        ]}
      />
    </>
  )
}

function TicketDetail({ item }: { item: WorkItem }) {
  const id = item.key.slice(7)
  const [data, setData] = useState<Awaited<ReturnType<typeof window.workdesk.notionTicket>>>()
  const [error, setError] = useState<string>()
  const [reloads, setReloads] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (reloads === 0) setData(undefined)
    setError(undefined)
    setBusy(true)
    window.workdesk.notionTicket(id, reloads > 0).then(setData, (e: Error) => setError(clean(e))).finally(() => setBusy(false))
  }, [id, reloads])
  const t = data?.ticket
  return (
    <>
      <section className="panel">
        <h3>Ticket <ReloadButton title="Reload this ticket" busy={busy} onClick={() => setReloads((n) => n + 1)} /></h3>
        {item.subtitle && <p className="hint">{item.subtitle}</p>}
        {error && <div className="error">{error}</div>}
        {!data && !error && <p className="hint"><Spinner /> Asking Notion…</p>}
        {t && (
          <>
            <div className="detail-row">
              {t.status && <span className={'chip small' + (t.closed ? '' : ' on')}>{t.status}</span>}
              {t.tags.map((tag) => <span key={tag} className="chip small">{tag}</span>)}
            </div>
            <dl className="facts">
              <dt>Assignee</dt>
              <dd>{t.mine ? 'you' : t.unassigned ? 'nobody' : t.assignees.join(', ')}</dd>
            </dl>
          </>
        )}
        <OpenPage url={item.url} label="Open ticket" />
      </section>
      <Tabs
        tabs={[
          {
            id: 'ticket',
            label: 'Ticket',
            content: data ? (
              data.lines.length > 0 ? <div className="ticket-body">{data.lines.map((l, i) => <p key={i}>{l}</p>)}</div> : <p className="hint">The ticket page has no text.</p>
            ) : (
              <p className="hint">{error ? 'The text could not be read; open the ticket instead.' : 'Loading…'}</p>
            )
          },
          { id: 'notes', label: 'Notes', content: <NotesEditor key={item.key} todoId={notesIdOf(item)} /> }
        ]}
      />
    </>
  )
}

interface DetailProps {
  item?: WorkItem
  state: AppState
  run: (action: () => Promise<AppState>) => Promise<void>
  actions?: React.ReactNode
  /** the WorkDesk the details are shown in, if any */
  deskId?: string
}

/** The right pane: what the item is about. Todos show their notes; Pull requests and tickets what is known about them. */
/** Put a Pull request or ticket into a WorkDesk that exists: the one that has it is named instead. */
function AssignToDesk({ item, state, run }: { item: WorkItem; state: AppState; run: DetailProps['run'] }) {
  const [target, setTarget] = useState('')
  const holder = state.desks.find((d) => (d.items ?? []).some((i) => itemKey(i.kind, i.id) === item.key))
  if (holder) return <p className="hint">In the WorkDesk <strong>{holder.name}</strong>.</p>
  const targets = state.desks
  const dropdown = deskItemOf(item)
  if (!dropdown) return null
  return (
    <div className="detail-actions assign-desk">
      <select value={target} disabled={targets.length === 0} onChange={(e) => setTarget(e.target.value)} title="Put it into a WorkDesk that exists">
        <option value="">{targets.length === 0 ? 'No WorkDesk yet' : 'Add to WorkDesk…'}</option>
        {targets.map((d) => <option key={d.id} value={d.id}>{d.name}{d.presence === 'planned' ? ' (planned)' : d.presence === 'parked' ? ' (parked)' : ''}</option>)}
      </select>
      <button disabled={!target} onClick={() => void run(() => window.workdesk.deskAddItem(target, dropdown)).then(() => setTarget(''))}>Add</button>
    </div>
  )
}

export function WorkItemDetail({ item, state, run, actions, deskId }: DetailProps) {
  if (!item) return <p className="empty">Select an item to see what it is about.</p>
  if (item.kind === 'todo') {
    return <TodoDetail key={item.key} todoId={item.key.slice(5)} state={state} run={run} embedded onBack={() => undefined} />
  }
  return (
    <div className="work-item-detail">
      <section className="panel item-head">
        <h3>
          <KindIcon item={item} /> {item.ticketKey && <span className="ticket-key">{item.ticketKey}</span>} {item.title}
        </h3>
        {actions && <div className="detail-actions">{actions}</div>}
        {!deskId && <AssignToDesk item={item} state={state} run={run} />}
      </section>
      {item.kind === 'pr' ? <PrDetail item={item} state={state} run={run} deskId={deskId} /> : <TicketDetail item={item} />}
    </div>
  )
}

export function Search({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input className="work-search" placeholder="Search Todos, pull requests and tickets…" value={value} onChange={(e) => onChange(e.target.value)} />
}

export const filterItems = searchItems

const CHECKOUT_KEY = 'workdesk.review.checkout'

interface StartProps {
  items: WorkItem[]
  run: (action: () => Promise<AppState>) => Promise<void>
  onClose: () => void
  onStarted: (state: AppState) => void
}

/** Asks for a name (and Projects, for a ticket) and starts one WorkDesk from the picked items. */
export function StartItemsPanel({ items, run, onClose, onStarted }: StartProps) {
  const api = window.workdesk
  const [name, setName] = useState(suggestName(items))
  const [projects, setProjects] = useState<Project[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [checkout, setCheckout] = useState(() => {
    try {
      return localStorage.getItem(CHECKOUT_KEY) === '1'
    } catch {
      return false
    }
  })
  const input = useRef<HTMLInputElement>(null)
  const lone = items.length === 1 ? items[0] : undefined
  const keyedTicket = lone?.kind === 'ticket' && !!lone.ticketKey
  const hasPr = items.some((i) => i.kind === 'pr')

  useEffect(() => {
    input.current?.select()
    if (keyedTicket) void api.listProjects().then(setProjects)
  }, [api, keyedTicket])

  const start = async () => {
    if (busy || !name.trim()) return
    setBusy(true)
    try {
      localStorage.setItem(CHECKOUT_KEY, checkout ? '1' : '0')
    } catch {
      // remembering is a convenience only
    }
    let result: AppState | undefined
    await run(async () => {
      result = await api.startFromItems({
        name: name.trim(),
        todoIds: items.flatMap((i) => (i.kind === 'todo' ? [i.key.slice(5)] : [])),
        items: items.flatMap((i) => deskItemOf(i) ?? []),
        branches: [],
        projects: picked,
        checkout
      })
      return result
    })
    setBusy(false)
    onClose()
    if (result) onStarted(result)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="modal" onSubmit={(e) => (e.preventDefault(), void start())} onKeyDown={(e) => e.key === 'Escape' && !busy && onClose()}>
        <h3>Start WorkDesk</h3>
        <ul className="work-items compact">
          {items.map((i) => (
            <li key={i.key}>
              <KindIcon item={i} /> <span className="title">{i.ticketKey ? `${i.ticketKey} ` : ''}{i.title}</span>
            </li>
          ))}
        </ul>
        <label className="field">
          <span>Name of the WorkDesk</span>
          <input ref={input} autoFocus value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        </label>
        {keyedTicket && (
          <div className="field">
            <span>Projects (one branch named after the ticket in each; none starts without a branch)</span>
            <div className="picker">
              {projects.map((p) => (
                <label key={p.name}>
                  <input type="checkbox" disabled={busy} checked={picked.includes(p.name)} onChange={() => setPicked((x) => (x.includes(p.name) ? x.filter((n) => n !== p.name) : [...x, p.name]))} /> {p.name}
                </label>
              ))}
              {projects.length === 0 && <em>Register a Project first.</em>}
            </div>
          </div>
        )}
        {hasPr && (
          <>
            <label className="pr-toggle">
              <input type="checkbox" checked={checkout} disabled={busy} onChange={(e) => setCheckout(e.target.checked)} /> check out the branch of the pull request
            </label>
            <p className="hint">{checkout ? 'The branch gets its own folder; the first time, the repository is cloned.' : 'Nothing is cloned. The WorkDesk opens with a browser tab on the pull request; check the branch out later.'}</p>
          </>
        )}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={busy || !name.trim()}>{busy && <Spinner />} {busy ? 'Starting…' : 'Start'}</button>
        </div>
      </form>
    </div>
  )
}

/** Each item gets its own planned WorkDesk: in the left panel, nothing started, no folder. */
export async function planItems(items: WorkItem[], run: (action: () => Promise<AppState>) => Promise<void>): Promise<void> {
  for (const i of items) {
    await run(() =>
      window.workdesk.startFromItems({
        name: suggestName([i]),
        todoIds: i.kind === 'todo' ? [i.key.slice(5)] : [],
        items: deskItemOf(i) ? [deskItemOf(i)!] : [],
        branches: [],
        projects: [],
        checkout: false,
        plan: true
      })
    )
  }
}
