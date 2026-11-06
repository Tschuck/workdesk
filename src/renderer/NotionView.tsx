import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppState } from '../shared/api'
import { groupByEpic, groupByStatus, groupByTag, isActionable, type NotionTicket } from '../main/sources/notion/board'
import { prTodoStatus, statusLabel, type PrTodoStatus } from '../main/domain/prs'
import type { NotionState } from '../main/sources/notion/service'
import { ticketItem, type WorkItem } from '../main/domain/work-items'
import { ticketTitle } from '../main/sources/notion/board'
import type { SettingsSection } from './SettingsView'
import { ReloadButton } from './Icons'
import { SettingsLink } from './SettingsLink'
import { planItems, StartItemsPanel, WorkItemDetail } from './WorkItems'

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const SPRINT = '\u0000sprint'

interface Props {
  state: AppState
  run: (action: () => Promise<AppState>) => Promise<void>
  openDesk: (id: string) => void
  openSettings: (section: SettingsSection) => void
}

/** The sprint board: open tickets of the active sprint that are yours or nobody's, grouped by tag. */
export function NotionView({ state, run, openDesk, openSettings }: Props) {
  const api = window.workdesk
  const [n, setN] = useState<NotionState>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'all' | 'none' | 'desk'>('all')
  const [start, setStart] = useState<WorkItem[]>()
  // the ticket whose details are shown on the right
  const [openId, setOpenId] = useState<string>()
  const [tab, setTab] = useState(SPRINT)
  const [showOthers, setShowOthers] = useState(false)
  const [showClosed, setShowClosed] = useState(false)
  // how the tickets are grouped: the tab's own way (status on the sprint, tag on the others) or by epic
  const [groupBy, setGroupBy] = useState<'default' | 'epic'>(() => {
    try {
      return localStorage.getItem('workdesk.notionGroup') === 'epic' ? 'epic' : 'default'
    } catch {
      return 'default'
    }
  })
  const pickGroup = (g: 'default' | 'epic') => {
    setGroupBy(g)
    try {
      localStorage.setItem('workdesk.notionGroup', g)
    } catch {
      /* not remembered */
    }
  }

  const fail = useCallback((e: unknown) => setError(clean(e as Error)), [])
  const apply = useCallback((s: NotionState) => (setN(s), setError(undefined)), [])
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      apply(tab === SPRINT ? await api.notionState(true) : await api.notionStatusTickets(tab))
    } catch (e) {
      fail(e)
    } finally {
      setLoading(false)
    }
  }, [api, apply, fail, tab])

  useEffect(() => {
    void api.notionState(false).then((s) => {
      setN(s)
      const open = tab === SPRINT ? s.fetchedAt !== null : s.pipeline[tab] !== undefined
      if (s.status.connected && s.config.databaseId && !open) void refresh()
    })
    // a tab loads once when opened; the Refresh button reloads it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, tab])

  const source = tab === SPRINT ? n?.tickets : n?.pipeline[tab]

  const statusOf = useCallback((t: NotionTicket): PrTodoStatus => prTodoStatus(t.id, state.desks), [state.desks])
  const shown = useMemo(() => {
    const q = text.trim().toLowerCase()
    return (source ?? []).filter(
      (t) =>
        (showOthers || t.mine || t.unassigned) &&
        (showClosed || !t.closed) &&
        (status === 'all' || statusOf(t).kind === status) &&
        (!q || t.title.toLowerCase().includes(q) || (t.ticketKey ?? '').toLowerCase().includes(q))
    )
  }, [source, text, status, showOthers, showClosed, statusOf])

  /** straight to the start panel: a ticket is not made a Todo */
  const startTicket = (t: NotionTicket) => setStart([ticketItem({ id: t.id, title: ticketTitle(t), name: t.title, url: t.url, ticketKey: t.ticketKey })])

  if (!n) return null
  const ready = n.status.connected && !!n.config.databaseId

  const asItem = (t: NotionTicket) => ticketItem({ id: t.id, title: ticketTitle(t), name: t.title, url: t.url, ticketKey: t.ticketKey })
  const openTicket = [...(n?.tickets ?? []), ...Object.values(n?.pipeline ?? {}).flat()].find((t) => t.id === openId)

  return (
    <div className="split-page">
    <section className="prs split-main">
      <h2>
        Notion
        <ReloadButton title={tab === SPRINT ? 'Reload the active sprint' : `Reload ${tab}`} busy={loading} disabled={!ready} updatedAt={tab === SPRINT ? (n.fetchedAt ?? undefined) : undefined} onClick={() => void refresh()} />
        <SettingsLink section="notion" onOpen={openSettings} title="Notion settings: connection and board mapping" />
      </h2>
      {!ready && (
        <p className="hint">
          {n.status.connected ? 'The board is not mapped yet.' : 'Notion is not connected.'} <button onClick={() => openSettings('notion')}>Open the Notion settings</button>
        </p>
      )}
      {error && <div className="error" onClick={() => setError(undefined)}>{error}</div>}

      {ready && (
        <>
          <div className="pipe-tabs">
            {[SPRINT, ...n.config.pipelineStatuses].map((t) => (
              <button key={t} className={'pipe-tab' + (t === tab ? ' active' : '')} onClick={() => setTab(t)}>
                {t === SPRINT ? 'Active sprint' : t}
                {(t === SPRINT ? n.tickets : n.pipeline[t]) && <span className="count">{(t === SPRINT ? n.tickets : n.pipeline[t]).length}</span>}
              </button>
            ))}
          </div>
          <div className="filters">
            <input placeholder="Filter by key or title…" value={text} onChange={(e) => setText(e.target.value)} />
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} title="Whether a WorkDesk has it">
              <option value="all">all</option>
              <option value="none">not started</option>
              <option value="desk">in a WorkDesk</option>
            </select>
            {n.config.epicProperty && (
              <select value={groupBy} onChange={(e) => pickGroup(e.target.value as typeof groupBy)} title="How the tickets are grouped">
                <option value="default">group by {tab === SPRINT ? 'status' : 'tag'}</option>
                <option value="epic">group by epic</option>
              </select>
            )}
            <label className="pr-toggle" title="Tickets assigned to somebody else, grayed out">
              <input type="checkbox" checked={showOthers} onChange={(e) => setShowOthers(e.target.checked)} /> other assignees
            </label>
            <label className="pr-toggle" title="Tickets in a closed status, grayed out">
              <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> closed statuses
            </label>
          </div>
          {source && source.length === 0 && !loading && <p className="empty">{tab === SPRINT ? 'No open tickets for you or unassigned in the current sprint.' : `No tickets in '${tab}'.`}</p>}
          {(groupBy === 'epic' && n.config.epicProperty
            ? groupByEpic(shown).map((g) => ({ key: g.epic, items: g.items }))
            : tab === SPRINT
            ? groupByStatus(shown, n.config.pipelineStatuses).map((g) => ({ key: g.status, items: g.items }))
            : groupByTag(shown).map((g) => ({ key: g.tag, items: g.items }))
          ).map((g) => (
            <div key={g.key} className="pr-group">
              <div className="pr-group-head">
                <strong>{g.key}</strong>
                <span className="count">{g.items.length}</span>
              </div>
              {g.items.map((t) => {
                const st = statusOf(t)
                return (
                  <div key={g.key + t.id} className={'pr-row' + (!isActionable(t) ? ' dim' : t.mine ? ' review' : '')}>
                    <span className={'pr-title' + (t.id === openId ? ' open' : '')} title="Show the ticket" onClick={() => setOpenId(t.id)}>
                      {t.ticketKey && <span className="pr-num">{t.ticketKey}</span>} {t.title}
                    </span>
                    {groupBy === 'epic' && t.status && <span className="chip small" title="Status in Notion">{t.status}</span>}
                    {t.unassigned && <span className="chip small">unassigned</span>}
                    {!t.mine && !t.unassigned && <span className="chip small" title="Assigned to somebody else">{t.assignees.join(', ')}</span>}
                    <span className={'chip small st-' + st.kind} title="Whether a WorkDesk has it">{statusLabel(st)}</span>
                    <span className="actions">
                      {t.unassigned && !t.closed && (
                        <button title="Make yourself the assignee in Notion" onClick={() => void api.notionClaim(t.id).then(apply, fail)}>Claim</button>
                      )}
                      {st.kind === 'desk' && <button onClick={() => openDesk(st.deskId)}>Open</button>}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </>
      )}
      {start && (
        <StartItemsPanel
          items={start}
          run={run}
          onClose={() => setStart(undefined)}
          onStarted={(st) => {
            const made = st.desks.reduce<(typeof st.desks)[number] | undefined>((n, d) => (!n || d.createdAt > n.createdAt ? d : n), undefined)
            if (made) openDesk(made.id)
          }}
        />
      )}
    </section>
    <aside className="side-pane">
      <WorkItemDetail
        item={openTicket ? asItem(openTicket) : undefined}
        state={state}
        run={run}
        actions={
          openTicket && (
            <>
              {statusOf(openTicket).kind === 'none' && !openTicket.closed && <button className="primary" onClick={() => startTicket(openTicket)}>Start WorkDesk</button>}
              {statusOf(openTicket).kind === 'none' && <button onClick={() => void planItems([asItem(openTicket)], run)}>Add to today</button>}
              {statusOf(openTicket).kind === 'desk' && <button onClick={() => openDesk((statusOf(openTicket) as { deskId: string }).deskId)}>Open WorkDesk</button>}
            </>
          )
        }
      />
    </aside>
    </div>
  )
}
