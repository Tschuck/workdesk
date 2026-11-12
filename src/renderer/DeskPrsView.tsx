import { useMemo, useState } from 'react'
import { arrangeDeskPrs, prPageUrl, prsInDesks, type DeskPr, type DeskPrCard, type DeskPrsGrouping, type DeskPrsOrder } from '../main/domain/desk-prs'
import { isPostponed, untilLabel } from '../main/domain/postpone'
import type { WorkDesk } from '../main/domain/types'
import { BrowserPane } from './BrowserPane'
import { IconButton } from './Icons'
import './desk-prs.css'

const keyOf = (p: DeskPr) => `${p.deskId} ${p.id}`

const VIEW_KEY = 'workdesk.deskPrs.view'
const GROUPINGS: Record<DeskPrsGrouping, string> = { desk: 'WorkDesk', stage: 'Stage' }
const ORDERS: Record<DeskPrsOrder, string> = { name: 'Name', oldest: 'Oldest first', newest: 'Newest first', author: 'Author' }

/** The grouping and order picked last, kept over a restart. */
function loadView(): { grouping: DeskPrsGrouping; order: DeskPrsOrder; hidePostponed: boolean; hideMine: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as { grouping?: string; order?: string; hidePostponed?: boolean; hideMine?: boolean }
    return { grouping: v.grouping && v.grouping in GROUPINGS ? (v.grouping as DeskPrsGrouping) : 'desk', order: v.order && v.order in ORDERS ? (v.order as DeskPrsOrder) : 'name', hidePostponed: v.hidePostponed === true, hideMine: v.hideMine === true }
  } catch {
    return { grouping: 'desk', order: 'name', hidePostponed: false, hideMine: false }
  }
}

/**
 * The pull requests in the WorkDesks of the Profile in view: a list, and the GitHub page of the one picked beside it, with a way to its
 * WorkDesk on top. To clear out the WorkDesks of pull requests that nobody works on.
 */
interface Props {
  desks: readonly WorkDesk[]
  openDesk: (id: string) => void
  onPark: (deskId: string) => void
  /** asks until when */
  onPostpone: (deskId: string) => void
  /** ends a postponement now */
  onBringBack: (deskId: string) => void
}

export function DeskPrsView({ desks, openDesk, onPark, onPostpone, onBringBack }: Props) {
  const [view, setView] = useState(loadView)
  const all = useMemo(() => prsInDesks(desks), [desks])
  const prs = useMemo(() => {
    if (!view.hidePostponed && !view.hideMine) return all
    const left = new Set(desks.filter((d) => !(view.hidePostponed && isPostponed(d))).map((d) => d.id))
    const mine = new Set(all.filter((p) => p.role === 'mine').map((p) => p.deskId))
    return all.filter((p) => left.has(p.deskId) && !(view.hideMine && mine.has(p.deskId)))
  }, [desks, all, view.hidePostponed, view.hideMine])
  const change = (next: Partial<typeof view>) => {
    const v = { ...view, ...next }
    setView(v)
    localStorage.setItem(VIEW_KEY, JSON.stringify(v))
  }
  const sections = useMemo(() => arrangeDeskPrs(prs, view.grouping, view.order), [prs, view])
  const [picked, setPicked] = useState<string>()
  const current = prs.find((p) => keyOf(p) === picked) ?? sections[0]?.cards[0]?.prs[0]
  const desk = current && desks.find((d) => d.id === current.deskId)
  const running = !!desk && desk.presence !== 'parked' && desk.presence !== 'planned'
  return (
    <section className="desk-prs">
      <div className="desk-prs-list">
        <h2>Pull requests in WorkDesks</h2>
        {all.length === 0 && <p className="empty">No WorkDesk has a pull request.</p>}
        {all.length > 0 && prs.length === 0 && <p className="empty">Every WorkDesk with a pull request is hidden by the filters.</p>}
        {all.length > 0 && (
          <div className="desk-prs-view">
            <label>
              Group by
              <select value={view.grouping} onChange={(e) => change({ grouping: e.target.value as DeskPrsGrouping })}>
                {Object.entries(GROUPINGS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            <label>
              Order by
              <select value={view.order} onChange={(e) => change({ order: e.target.value as DeskPrsOrder })}>
                {Object.entries(ORDERS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            <label title="Leave out the WorkDesks that are postponed">
              <input type="checkbox" checked={view.hidePostponed} onChange={(e) => change({ hidePostponed: e.target.checked })} />
              Hide postponed
            </label>
            <label title="Leave out the WorkDesks that have a pull request of yours">
              <input type="checkbox" checked={view.hideMine} onChange={(e) => change({ hideMine: e.target.checked })} />
              Hide mine
            </label>
          </div>
        )}
        {sections.map((sec) => (
          <div key={sec.title ?? 'all'} className="desk-prs-section">
            {sec.title && <h4 className="desk-prs-group">{sec.title} ({sec.cards.length})</h4>}
            {sec.cards.map((g) => <Card key={g.deskId} g={g} current={current} pick={setPicked} openDesk={openDesk} />)}
          </div>
        ))}
      </div>
      {current && (
        <div className="desk-prs-detail">
          <div className="desk-prs-bar">
            <span className="desk-pr-head">
              <strong>{current.title}</strong>
              <small className="hint">
                {current.id} · {current.deskName} · {current.stage}
              </small>
            </span>
            <IconButton icon="link" title="Copy the link of the pull request" onClick={() => void window.workdesk.writeClipboard(current.url)} />
            {running && <IconButton icon="pause" title={`Park ${current.deskName}: shut down its terminals to free memory; tabs, notes, branches and Claude sessions are kept`} onClick={() => onPark(current.deskId)} />}
            {desk && isPostponed(desk) ? (
              <button title={`Postponed until ${untilLabel(desk.postponedUntil!)}: bring it back now`} onClick={() => onBringBack(current.deskId)}>
                Bring back
              </button>
            ) : (
              desk && <IconButton icon="clock" title={`Postpone ${current.deskName}: out of the way until a time you pick, and back at once on a new Signal`} onClick={() => onPostpone(current.deskId)} />
            )}
            <button className="go-btn" title={`Open the WorkDesk ${current.deskName}`} onClick={() => openDesk(current.deskId)}>
              WorkDesk →
            </button>
          </div>
          <BrowserPane key={keyOf(current)} url={prPageUrl(current.url)} rememberKey="desk-prs" onLocation={() => undefined} />
        </div>
      )}
    </section>
  )
}

/** One WorkDesk: its name and Stage on top, its pull requests below. */
function Card({ g, current, pick, openDesk }: { g: DeskPrCard; current?: DeskPr; pick: (key: string) => void; openDesk: (id: string) => void }) {
  return (
    <div className="desk-prs-card">
      <h3 title={`${g.deskName} · ${g.stage}`}>
        <span className="desk-prs-desk">{g.deskName}</span>
        <span className="chip small">{g.stage}</span>
        <button className="desk-prs-go" title={`Open the WorkDesk ${g.deskName}`} onClick={() => openDesk(g.deskId)}>
          →
        </button>
      </h3>
      <ul>
        {g.prs.map((p) => (
          <li key={keyOf(p)} className={current && keyOf(current) === keyOf(p) ? 'active' : ''} onClick={() => pick(keyOf(p))} title={p.url}>
            <span className="desk-pr-title">{p.title}</span>
            <span className="desk-pr-meta">
              {p.id}
              {p.author && p.role === 'review' && <span>· {p.author}</span>}
              {p.role === 'mine' && <span className="chip small">yours</span>}
              {p.state && p.state !== 'open' && <span className="chip small">{p.state}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
