import { useEffect, useState } from 'react'
import type { AppState } from '../shared/api'
import { isWaitingStage, stageLabel } from '../main/domain/stage'
import type { WorkDesk } from '../main/domain/types'
import { itemOfDesk, todoItem } from '../main/domain/work-items'
import type { DeskPrs } from '../main/sources/desk-prs'
import { unfinishedReason } from '../main/domain/finished'
import { AddItemModal } from './AddItemModal'
import { BranchDetail } from './BranchDetail'
import { DeskBranches } from './DeskBranches'
import { DeskEventLog } from './DeskEventLog'
import { DeskSettings } from './DeskSettings'
import { DeskTodos } from './DeskTodos'
import { DeskNote } from './DeskNote'
import { IconButton, ReloadButton } from './Icons'
import { PrChipsFor, usePrStates } from './PrStates'
import { PageRefsPanel } from './PageRefs'
import { Spinner } from './Spinner'
import { TimeSpent } from './TimeSpent'
import { WorkItemDetail, WorkItemList } from './WorkItems'

interface Props {
  desk: WorkDesk
  state: AppState
  run: (action: () => Promise<AppState>) => Promise<void>
  onClear: () => void
  onCombine: () => void
  /** Pull Requests of the branches, when known */
  prs?: DeskPrs
  onRefreshPrs?: () => Promise<void>
}


/** What is shown on the right: a work item or a branch, whichever was clicked last. */
type Selection = { kind: 'item'; key: string } | { kind: 'branch'; project: string; branch: string }

/** The WorkDesk itself: its title with the settings, the work items and branches with the details of the one you click, the event log. */
export function DetailsPane({ desk, state, run, onClear, onCombine, prs, onRefreshPrs }: Props) {
  const prStates = usePrStates()
  const noBranch = desk.branches.length === 0
  const reviews = desk.reviews ?? []
  const reviewId = (r: (typeof reviews)[number]) => `${r.owner}/${r.repo}#${r.number}`
  const api = window.workdesk
  const [settings, setSettings] = useState(false)
  // the .env files of the whole WorkDesk
  const [envBusy, setEnvBusy] = useState<'store' | 'link'>()
  const [envMsg, setEnvMsg] = useState<string>()
  const [envConflicts, setEnvConflicts] = useState(false)
  const envAction = async (kind: 'store' | 'link', force = false) => {
    setEnvBusy(kind)
    try {
      const res = kind === 'store' ? await api.envSyncDesk(desk.id) : await api.envLinkDesk(desk.id, force)
      setEnvConflicts(res.conflicts.length > 0)
      setEnvMsg(
        kind === 'store'
          ? res.synced.length > 0 ? `Stored ${res.synced.length} .env file(s) as the base: ${res.synced.join(', ')}` : 'Nothing new to store: these .env files are links into the store already, or there are none.'
          : [res.linked.length > 0 && `Linked ${res.linked.length} .env file(s).`, res.conflicts.length > 0 && `Kept different local .env file(s): ${res.conflicts.join(', ')}.`].filter(Boolean).join(' ') || 'Nothing to link: the store has no .env files for these Projects yet.'
      )
    } catch (e) {
      setEnvMsg((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setEnvBusy(undefined)
    }
  }
  const [adding, setAdding] = useState(false)
  const [sel, setSel] = useState<Selection>()
  // the branch details changed something: the branch list reads again
  const [refresh, setRefresh] = useState(0)
  const planned = desk.presence === 'planned'
  const parked = desk.presence === 'parked'

  // is everything this WorkDesk was about done? Pull requests are asked when the tab opens
  const todos = state.todos.filter((t) => t.deskId === desk.id)
  const prIds = [...new Set([...(desk.items ?? []).filter((i) => i.kind === 'pr').map((i) => i.id), ...reviews.map(reviewId)])]
  // the reload icon: ask again for everything the page shows, skipping what was kept
  const [reloads, setReloads] = useState(0)
  const [reloading, setReloading] = useState(false)
  const [prStatus, setPrStatus] = useState<Record<string, 'open' | 'merged' | 'closed'>>({})
  const prKey = prIds.join('|')
  useEffect(() => {
    // a parked WorkDesk does not ask by itself; the reload button does
    if (desk.presence === 'parked' && reloads === 0) return
    for (const id of prKey ? prKey.split('|') : []) void api.prState(id, reloads > 0).then((s) => setPrStatus((m) => ({ ...m, [id]: s.state })), () => undefined)
  }, [api, prKey, desk.presence, reloads])
  const ticketIds = (desk.items ?? []).filter((i) => i.kind === 'ticket').map((i) => i.id)
  const [ticketDone, setTicketDone] = useState<Record<string, boolean>>({})
  const ticketKey = ticketIds.join('|')
  useEffect(() => {
    // a parked WorkDesk does not ask by itself; the reload button does
    if (desk.presence === 'parked' && reloads === 0) return
    for (const id of ticketKey ? ticketKey.split('|') : []) void api.notionTicket(id, reloads > 0).then((d) => setTicketDone((m) => ({ ...m, [id]: d.ticket.closed })), () => undefined)
  }, [api, ticketKey, desk.presence, reloads])
  const why = unfinishedReason({
    todos: todos.map((t) => t.resolved),
    prs: prIds.map((id) => prStatus[id]),
    tickets: ticketIds.map((id) => ticketDone[id]),
    openBranchPrs: desk.branches.length === 0 ? 0 : prs ? prs.branches.reduce((n, b) => n + b.prs.filter((p) => p.state === 'open').length, 0) : undefined
  })
  // a review whose pull request is merged or closed has nothing left to do
  const finished = reviews.length > 0 && reviews.every((r) => !!r.snapshot && r.snapshot.state !== 'open')
  const reload = async () => {
    setReloading(true)
    try {
      setReloads((n) => n + 1)
      await Promise.all([onRefreshPrs?.(), api.refreshPrTodos()])
    } finally {
      setReloading(false)
    }
  }
  /** wake it up and make it the active WorkDesk again */
  const reactivate = async () => {
    await run(() => api.reactivateDesk(desk.id))
    await run(() => api.activateDesk(desk.id))
  }

  const items = [...(desk.items ?? []).map(itemOfDesk), ...todos.map((t) => todoItem(t))]
  // the Todos are in the checklist above; this list holds the rest
  const listed = items.filter((i) => i.kind !== 'todo')
  const current = sel?.kind === 'item' ? items.find((i) => i.key === sel.key) : undefined
  // a branch that left the WorkDesk, or an item that was taken out, closes its details
  useEffect(() => {
    if (sel?.kind === 'branch' && !desk.branches.some((b) => b.project === sel.project && b.branch === sel.branch)) setSel(undefined)
    if (sel?.kind === 'item' && !items.some((i) => i.key === sel.key)) setSel(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk.branches, items.map((i) => i.key).join('|')])


  return (
    <div className="details desk-home">
      <header className="desk-head">
        <h2 title={desk.name}>{desk.name}</h2>
        <span className="chip small" title="Where its work stands">{planned ? 'planned' : parked ? 'parked' : stageLabel(desk.stage)}</span>
        {reviews.map((r) => (
          <span key={reviewId(r)} className="desk-head-pr">
            {r.owner}/{r.repo}#{r.number}
            {noBranch && !prStates[reviewId(r)] && r.snapshot && ` · ${r.snapshot.state}`}
            {noBranch && <PrChipsFor id={reviewId(r)} />}
          </span>
        ))}
        <span className="grow" />
        {planned ? (
          <IconButton icon="play" primary title="Start: open its terminals, browser tabs and editor" onClick={() => void run(() => api.activateDesk(desk.id))} />
        ) : parked ? (
          <IconButton icon="play" primary title="Reactivate: bring its terminals and Claude sessions back" onClick={() => void reactivate()} />
        ) : (
          <IconButton icon="pause" title="Park: shut down its terminals (and what runs in them) and its editor window to free memory; tabs, notes, branches and Claude sessions are kept" onClick={() => void run(() => api.parkDesk(desk.id))} />
        )}
        <IconButton icon="trash" danger title="Clear WorkDesk: end it for good. Notes and Claude sessions are archived, its folders are removed; Branches and Todos are kept. You are asked for approval first" onClick={onClear} />
        {!planned && <ReloadButton title="Reload the pull requests of its branches and the state of its work items" busy={reloading} onClick={() => void reload()} />}
        <IconButton icon="combine" title="Combine with another WorkDesk: take it into this one (its branch folders, pull requests, Todos, pages and note) and clear it" onClick={onCombine} />
        <IconButton icon="cog" title="WorkDesk settings: name and Stage" onClick={() => setSettings(true)} />
      </header>

      {planned && (
        <div className="restack">
          <span>Planned for today: nothing is running or checked out yet. Start it to open its terminals, browser tabs and editor.</span>
        </div>
      )}

      {parked && (
        <div className="restack">
          <span>This WorkDesk is parked: its terminals and editor are shut down. Reactivate it to work in it again.</span>
        </div>
      )}

      {!finished && !planned && !parked && !why && (
        <div className="restack">
          <span>Everything in this WorkDesk is done: Todos resolved, pull requests merged or closed, no open pull request on its branches. Clear it to keep the sidebar tidy.</span>
          <IconButton icon="trash" danger title="Clear WorkDesk: notes and Claude sessions are archived, its folders are removed; Branches and Todos are kept" onClick={onClear} />
        </div>
      )}

      {!finished && !planned && !parked && isWaitingStage(desk.stage) && (
        <div className="restack">
          <span>Waiting for somebody else. Park this WorkDesk to free what its terminals and editor use; it comes back to Work when there is news.</span>
          <IconButton icon="pause" title="Park: shut down its terminals (and what runs in them) and its editor window to free memory; tabs, notes, branches and Claude sessions are kept" onClick={() => void run(() => api.parkDesk(desk.id))} />
        </div>
      )}

      {finished && (
        <div className="restack">
          <span>{reviews.length > 1 ? 'The pull requests are' : 'The pull request was'} {reviews.every((r) => r.snapshot!.state === reviews[0].snapshot!.state) ? reviews[0].snapshot!.state : 'merged or closed'}. Clear this WorkDesk to keep the sidebar tidy: notes are archived, and branches and Todos are kept.</span>
          <IconButton icon="trash" danger title="Clear WorkDesk: notes and Claude sessions are archived, its folders are removed; Branches and Todos are kept" onClick={onClear} />
        </div>
      )}

      <DeskTodos desk={desk} state={state} run={run} onOpen={(id) => setSel({ kind: 'item', key: `todo:${id}` })} />

      <div className="split-page details-split">
        <div className="split-main">
          <TimeSpent deskId={desk.id} />
          <section className="panel work-items-panel">
            <h3>
              Work items ({listed.length})
              <span className="panel-tools">
                <IconButton icon="plus" title="Add a Todo: write a new one, or take one of yours that no WorkDesk has" onClick={() => setAdding(true)} />
              </span>
            </h3>
            <WorkItemList items={listed} prState selectable={false} selected={[]} onToggle={() => undefined} openKey={sel?.kind === 'item' ? sel.key : undefined} onOpen={(key) => setSel({ kind: 'item', key })} />
          </section>

          <PageRefsPanel target={{ kind: 'desk', id: desk.id }} refs={desk.refs} run={run} />

          <DeskBranches
            desk={desk}
            run={run}
            prs={prs}
            onRefreshPrs={onRefreshPrs}
            refresh={refresh}
            selected={sel?.kind === 'branch' ? sel : undefined}
            onSelect={(b) => setSel({ kind: 'branch', ...b })}
          />

          <DeskNote deskId={desk.id} />

          <details className="panel event-fold">
            <summary>Event log</summary>
            <DeskEventLog deskId={desk.id} bare />
          </details>

          {desk.branches.length > 0 && (
            <details className="panel event-fold env-fold">
              <summary>.env files</summary>
              <div className="env-actions">
                <div className="env-action">
                  <button disabled={!!envBusy || parked || planned} onClick={() => void envAction('store')}>{envBusy === 'store' && <Spinner />} Use as base for other branches</button>
                  <p className="hint">Copies the real <code>.env</code> files of this WorkDesk's branches into the central store. New branches of the same Project then get links to them, so a new branch starts with working settings.</p>
                </div>
                <div className="env-action">
                  <button disabled={!!envBusy || parked || planned} onClick={() => void envAction('link')}>{envBusy === 'link' && <Spinner />} Symlink the stored .env files</button>
                  <p className="hint">Replaces this WorkDesk's <code>.env</code> files by links to the stored ones, so they stay in sync with every other branch. A local file that differs is kept, and you are told which.</p>
                </div>
                {envConflicts && (
                  <div className="env-action">
                    <button className="danger" disabled={!!envBusy} onClick={() => void envAction('link', true)}>Force symlink</button>
                    <p className="hint">Replaces the differing local <code>.env</code> files by links too. Their content is lost.</p>
                  </div>
                )}
                {(parked || planned) && <p className="hint">Start the WorkDesk to change its <code>.env</code> files.</p>}
                {envMsg && <p className="env-result" onClick={() => setEnvMsg(undefined)} title="Click to dismiss">{envMsg}</p>}
              </div>
            </details>
          )}
        </div>

        <aside className="side-pane">
          {sel?.kind === 'branch' ? (
            <BranchDetail
              key={sel.project + '\u0000' + sel.branch}
              project={sel.project}
              branch={sel.branch}
              desks={[]}
              run={run}
              onChanged={() => setRefresh((n) => n + 1)}
              onClose={() => setSel(undefined)}
              inThisDesk={desk.id}
            />
          ) : current ? (
            <WorkItemDetail
              item={current}
              state={state}
              run={run}
              deskId={desk.id}
              actions={
                <button
                  title="Take it out of this WorkDesk"
                  onClick={() => void run(() => (current.kind === 'todo' ? api.deskRemoveTodo(current.key.slice(5)) : api.deskRemoveItem(desk.id, current.kind as 'pr' | 'ticket', current.key.slice(current.kind.length + 1))))}
                >
                  Remove from WorkDesk
                </button>
              }
            />
          ) : (
            <p className="empty">Click a work item or a branch to see its details here.</p>
          )}
        </aside>
      </div>

      {settings && <DeskSettings desk={desk} run={run} onClose={() => setSettings(false)} />}
      {adding && <AddItemModal desk={desk} state={state} run={run} onClose={() => setAdding(false)} />}
    </div>
  )
}
