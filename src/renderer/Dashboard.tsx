import { WhatNext } from './WhatNext'
import { ClaudeOverview } from './ClaudeOverview'
import { DeskOverview } from './DeskOverview'
import { useEffect, useState, type ReactNode } from 'react'
import type { AppState } from '../shared/api'
import { buildSetupSteps, setupProgress, type SetupFacts, type SetupTarget } from '../shared/setup'
import { searchItems, type WorkItem } from '../main/domain/work-items'
import { planItems, Search, StartItemsPanel, useWorkItems, WorkItemDetail, WorkItemList } from './WorkItems'
import { ReloadButton } from './Icons'
import { Spinner } from './Spinner'
import { prReadiness } from '../main/domain/prs'
import { sectionOf } from '../main/domain/order'
import { openSignals } from '../main/domain/signal'
import type { Todo, WorkDesk } from '../main/domain/types'
import { closableDeskIds } from '../main/domain/closable'
import { usePrStates } from './PrStates'
import { NeedsYou } from './NeedsYou'

interface Props {
  state: AppState
  run: (action: () => Promise<AppState>) => Promise<void>
  go: (target: SetupTarget | 'todos') => void
  openDesk: (id: string) => void
  openTodo: (id: string) => void
  openTab: (deskId: string, tabId: string) => void
  /** clear a WorkDesk that is done */
  onClear?: (deskId: string) => void
  /** one Profile of several is in view: the time of cleared WorkDesks (no Profile) is not counted */
  scoped?: boolean
}

const HIDE_KEY = 'workdesk.setup.hidden'
const stored = (): boolean => {
  try {
    return localStorage.getItem(HIDE_KEY) === '1'
  } catch {
    return false
  }
}

const foldKey = (id: string) => `workdesk.dashboard.fold.${id}`

/** A section of the Dashboard that folds: a click on its heading hides everything under it (kept on this machine). */
function Fold({ id, children }: { id: string; children: ReactNode }) {
  const [folded, setFolded] = useState(() => {
    try {
      return localStorage.getItem(foldKey(id)) === '1'
    } catch {
      return false
    }
  })
  return (
    <div
      className={'fold' + (folded ? ' folded' : '')}
      onClick={(e) => {
        const t = e.target as HTMLElement
        const head = t.closest('h3')
        // the heading of the section itself (not one inside it), and not a button or a link in it
        if (!head || !head.matches('.fold > * > h3:first-child') || t.closest('button, a, input, select, label')) return
        const next = !folded
        setFolded(next)
        try {
          localStorage.setItem(foldKey(id), next ? '1' : '0')
        } catch {
          /* not remembered */
        }
      }}
    >
      {children}
    </div>
  )
}

/** The state of all WorkDesks in four numbers. */
function DashStats({ desks, todos, ready }: { desks: WorkDesk[]; todos: Todo[]; ready: number }) {
  const now = Date.now()
  const prStates = usePrStates()
  const closable = closableDeskIds(desks, todos, prStates)
  const count = (section: ReturnType<typeof sectionOf>) => desks.filter((d) => sectionOf(d, now, closable) === section).length
  const signals = desks.reduce((n, d) => n + openSignals(d).length, 0)
  const tiles = [
    { label: 'Needs you', n: signals, hint: 'Open Signals: Claude waits, a review comes back, checks finished', tone: signals > 0 ? 'hot' : '' },
    { label: 'Working', n: count('live'), hint: 'WorkDesks in use', tone: '' },
    { label: 'Waiting', n: count('waiting'), hint: 'Waiting for somebody else, nothing for you', tone: '' },
    { label: 'Can be cleared', n: count('closable'), hint: 'Everything in them is done: pull requests merged or closed, Todos resolved', tone: '' },
    { label: 'Ready to merge', n: ready, hint: 'Approved, checks finished', tone: ready > 0 ? 'good' : '' }
  ]
  return (
    <div className="dash-stats">
      {tiles.map((t) => (
        <div key={t.label} className={'dash-stat ' + t.tone} title={t.hint}>
          <strong>{t.n}</strong>
          <span>{t.label}</span>
        </div>
      ))}
    </div>
  )
}

/** Everything that wants attention in one place: setup, Signals, the WorkDesks that need you and what to start next. */
export function Dashboard({ state, run, go, openDesk, openTodo, openTab, onClear, scoped }: Props) {
  const [facts, setFacts] = useState<SetupFacts>()
  const [hidden, setHidden] = useState(stored)

  useEffect(() => void window.workdesk.setupFacts().then(setFacts), [])

  const work = useWorkItems(state)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [openKey, setOpenKey] = useState<string>()
  const [starting, setStarting] = useState<WorkItem[]>()
  const shown = searchItems(work.items, query)
  const current = shown.find((i) => i.key === openKey)
  const chosen = work.items.filter((i) => selected.includes(i.key))
  const toggle = (key: string) => setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]))
  const skip = (item: WorkItem) => {
    void window.workdesk.skipCandidate(item.kind === 'ticket' ? 'notion-tickets' : 'github-prs', item.key.slice(item.kind.length + 1))
    work.dismiss(item.key)
  }
  /** each item gets its own planned WorkDesk, in the sidebar, nothing started */
  const plan = async (items: WorkItem[]) => {
    await planItems(items, run)
    setSelected([])
  }

  const steps = facts ? buildSetupSteps(facts) : []
  const progress = setupProgress(steps)
  const complete = steps.length > 0 && progress.done === progress.total
  // Pull requests of WorkDesks that are approved and have finished their checks: waiting for you to merge
  const prStates = usePrStates()
  const readyToMerge = state.desks.flatMap((d) => {
    const ids = [...(d.items ?? []).filter((i) => i.kind === 'pr').map((i) => i.id), ...(d.reviews ?? []).map((r) => `${r.owner}/${r.repo}#${r.number}`)]
    return [...new Set(ids)].flatMap((id) => (prStates[id] && prReadiness(prStates[id]) === 'ready' ? [{ desk: d, id, url: prStates[id].url }] : []))
  })

  return (
    <section className="dashboard">
      <h2>Dashboard</h2>

      {facts && !complete && !hidden && (
        <div className="panel setup">
          <h3>
            Getting started ({progress.done}/{progress.total})
            <button
              onClick={() => {
                setHidden(true)
                try {
                  localStorage.setItem(HIDE_KEY, '1')
                } catch {
                  // remembering is a convenience only
                }
              }}
            >
              Hide
            </button>
          </h3>
          <ol className="steps">
            {steps.map((s) => (
              <li key={s.id} className={s.done ? 'done' : ''}>
                <span className="mark">{s.done ? '✓' : '○'}</span>
                <span className="step-body">
                  <strong>{s.title}</strong>
                  {!s.required && <span className="chip small">optional</span>}
                  <small className="hint">{s.description}</small>
                </span>
                {!s.done && s.target !== 'dashboard' && <button onClick={() => go(s.target)}>Set up</button>}
                {!s.done && s.id === 'tools' && <button onClick={() => void window.workdesk.setupFacts().then(setFacts)}>Check again</button>}
              </li>
            ))}
          </ol>
        </div>
      )}
      {facts && !complete && hidden && (
        <p className="hint">
          Setup {progress.done}/{progress.total}. <button onClick={() => (setHidden(false), localStorage.removeItem(HIDE_KEY))}>Show checklist</button>
        </p>
      )}



      <DashStats desks={state.desks} todos={state.todos} ready={readyToMerge.length} />
      <NeedsYou state={state} ready={readyToMerge.map((r) => ({ deskId: r.desk.id, deskName: r.desk.name, id: r.id, url: r.url }))} run={run} openDesk={openDesk} openTodo={openTodo} onClear={onClear} />
      <div className="dash-grid">
        <div className="dash-main">
          <Fold id="desks"><DeskOverview state={state} openDesk={openDesk} /></Fold>
        </div>
        <div className="dash-side">
        <Fold id="what-next"><WhatNext embedded skip={['signal', 'closable']} state={state} run={run} openDesk={openDesk} openTodo={openTodo} onClear={onClear} /></Fold>
        <Fold id="claude"><ClaudeOverview state={state} openDesk={openDesk} openTab={openTab} /></Fold>
        </div>
      </div>
      <Fold id="start"><section className="work-section">
        <h3>
          <span>Start working <ReloadButton title="Reload review requests, your pull requests and your tickets" busy={work.loading} updatedAt={work.updatedAt} onClick={() => void work.reload()} /></span>
          <span className="panel-tools">
            {work.loading && <Spinner />}
            <button className="go-btn" title="Open your Todos" onClick={() => go('todos')}>Todos →</button>
          </span>
        </h3>
        {work.errors.map((e) => <div key={e} className="error">{e}</div>)}
        <div className="work-bar">
          <Search value={query} onChange={setQuery} />
          {selected.length > 0 && (
            <span className="work-actions">
              <span className="hint">{selected.length} selected</span>
              <button onClick={() => void plan(chosen)} title="One planned WorkDesk per item, shown in the sidebar; nothing is started">Add to today</button>
              <button className="primary" onClick={() => setStarting(chosen)} title="One WorkDesk for all selected items">Start together…</button>
              <button onClick={() => setSelected([])}>Clear</button>
            </span>
          )}
        </div>
        <div className="split-page work-split">
          <div className="split-main">
            <WorkItemList items={shown} selected={selected} onToggle={toggle} openKey={openKey} onOpen={setOpenKey} />
          </div>
          <aside className="side-pane">
            <WorkItemDetail
              item={shown.find((i) => i.key === openKey)}
              state={state}
              run={run}
              actions={
                current && (
                  <>
                    <button onClick={() => void plan([current])}>Add to today</button>
                    <button className="primary" onClick={() => setStarting([current])}>Start…</button>
                    {current.kind !== 'todo' && <button onClick={() => skip(current)}>Skip</button>}
                  </>
                )
              }
            />
          </aside>
        </div>
      </section></Fold>

      {starting && (
        <StartItemsPanel
          items={starting}
          run={run}
          onClose={() => setStarting(undefined)}
          onStarted={(st) => {
            setSelected([])
            const made = st.desks.reduce<(typeof st.desks)[number] | undefined>((n, d) => (!n || d.createdAt > n.createdAt ? d : n), undefined)
            if (made) openDesk(made.id)
          }}
        />
      )}
    </section>
  )
}
