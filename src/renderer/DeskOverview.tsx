import { useEffect, useMemo, useState } from 'react'
import type { AppState } from '../shared/api'
import { deskChecklist } from '../main/domain/desk-todos'
import type { RecentEvent } from '../main/domain/events'
import { orderSection, sectionOf, type SidebarSection } from '../main/domain/order'
import { openSignals } from '../main/domain/signal'
import { closableDeskIds } from '../main/domain/closable'
import { usePrStates } from './PrStates'
import { stageLabel } from '../main/domain/stage'
import type { WorkDesk } from '../main/domain/types'
import './desk-overview.css'

const SECTIONS: { id: SidebarSection; label: string }[] = [
  { id: 'live', label: 'Working' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'reviews', label: 'Pull requests' },
  { id: 'closable', label: 'Can be cleared' },
  { id: 'planned', label: 'Planned' },
  { id: 'postponed', label: 'Postponed' }
]

function ago(ms: number): string {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

/** Every WorkDesk with where it stands: its Stage, open Todos, branches, Signals and the last thing that happened, so you remember what you were on. */
export function DeskOverview({ state, openDesk }: { state: AppState; openDesk: (id: string) => void }) {
  const [events, setEvents] = useState<RecentEvent[]>([])
  useEffect(() => {
    let live = true
    void window.workdesk.recentEvents(300).then((e) => live && setEvents(e), () => undefined)
    return () => {
      live = false
    }
  }, [state.desks])
  const lastOf = useMemo(() => {
    const m = new Map<string, RecentEvent>()
    for (const e of events) if (!m.has(e.deskId) || m.get(e.deskId)!.at < e.at) m.set(e.deskId, e)
    return m
  }, [events])

  const prStates = usePrStates()
  if (state.desks.length === 0) return null
  const now = Date.now()
  const closable = closableDeskIds(state.desks, state.todos, prStates)

  const row = ({ desk }: { desk: WorkDesk }) => {
    const todos = deskChecklist(desk, state.todos)
    const open = todos.filter((t) => !t.resolved)
    const signals = openSignals(desk).length
    const last = lastOf.get(desk.id)
    // what you were on, in one line: the open Todos, then the branches
    const sub = [
      open.length > 0 ? `${open.length} open: ${open.slice(0, 2).map((t) => t.title).join(', ')}${open.length > 2 ? ` +${open.length - 2}` : ''}` : todos.length > 0 ? 'all Todos resolved' : '',
      desk.branches.slice(0, 3).map((b) => `${b.project}/${b.branch}`).join(', ') + (desk.branches.length > 3 ? ` +${desk.branches.length - 3}` : '')
    ].filter(Boolean)
    return (
      <li key={desk.id} className={'clickable' + (desk.presence === 'parked' || desk.presence === 'planned' ? ' dim' : '')} onClick={() => openDesk(desk.id)} title={last ? `${last.text} (${ago(last.at)})` : 'Open this WorkDesk'}>
        <span className="work-item-text">
          <span className="title">{desk.name}</span>
          {sub.length > 0 && <small className="hint">{sub.join(' · ')}</small>}
        </span>
        {signals > 0 && <span className="chip small st-today" title="Open Signals">{signals} to look at</span>}
        {desk.presence === 'parked' && <span className="chip small" title="Shut down to free resources">parked</span>}
        <span className="chip small">{stageLabel(desk.stage)}</span>
        <span className="hint dov-last">{last ? ago(last.at) : ''}</span>
      </li>
    )
  }

  return (
    <div className="panel desk-overview">
      <h3>Your WorkDesks ({state.desks.length})</h3>
      {SECTIONS.map((s) => {
        const desks = orderSection(state.desks.filter((d) => sectionOf(d, now, closable) === s.id))
        if (desks.length === 0) return null
        return (
          <div key={s.id} className="dov-group">
            <h4>{s.label} ({desks.length})</h4>
            <ul className="work-items">{desks.map(row)}</ul>
          </div>
        )
      })}
    </div>
  )
}
