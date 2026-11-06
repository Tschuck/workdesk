import type { AppState } from '../shared/api'
import { dueLabel } from '../main/domain/reminders'
import { closableDeskIds } from '../main/domain/closable'
import { whatNext } from '../main/domain/what-next'
import type { SignalType } from '../main/domain/types'
import { usePrStates } from './PrStates'
import { useOpenLink } from './OpenLink'

export interface ReadyPr {
  deskId: string
  deskName: string
  id: string
  url: string
}

type Tone = 'act' | 'info' | 'good' | 'late' | 'done'

/** what a Signal asks of you: a question or a reviewer needs an answer (act), something just finished (info), a merge is possible (good) */
const SIGNAL_TONE: Partial<Record<SignalType, Tone>> = {
  'claude-needs-input': 'act',
  're-review-requested': 'act',
  'new-review-comments': 'act',
  'review-received': 'act',
  'ready-to-merge': 'good'
}
const TONE_ORDER: Tone[] = ['act', 'late', 'good', 'info', 'done']

interface Row {
  key: string
  tone: Tone
  kind: string
  title: string
  note?: string
  open: () => void
  actions?: { label: string; onClick: () => void }[]
}

/** Everything that needs you in one list, one colour per kind: answers (yellow), late Todos (orange), ready to merge (green), news (blue), done (purple). */
export function NeedsYou({ state, ready, run, openDesk, openTodo, onClear }: { state: AppState; ready: ReadyPr[]; run: (a: () => Promise<AppState>) => Promise<void>; openDesk: (id: string) => void; openTodo: (id: string) => void; onClear?: (deskId: string) => void }) {
  const api = window.workdesk
  const openLink = useOpenLink()
  const prStates = usePrStates()
  const now = Date.now()
  const rows: Row[] = []
  const readyDesks = new Set(ready.map((r) => r.deskId))
  for (const i of whatNext(state.todos, state.desks, now, closableDeskIds(state.desks, state.todos, prStates))) {
    if (i.kind === 'signal') {
      // the ready-to-merge Signal is the pull request below
      if (i.signal.type === 'ready-to-merge' && readyDesks.has(i.deskId)) continue
      rows.push({
        key: i.signal.id,
        tone: SIGNAL_TONE[i.signal.type] ?? 'info',
        kind: i.signal.type.replace(/-/g, ' '),
        title: i.deskName,
        note: i.signal.message,
        open: () => openDesk(i.deskId),
        actions: [{ label: 'Mark read', onClick: () => void run(async () => api.markSignalRead(i.deskId, i.signal.id)) }]
      })
    } else if (i.kind === 'todo' && i.overdue) {
      rows.push({ key: i.todo.id, tone: 'late', kind: dueLabel(i.todo, now), title: i.todo.title, note: i.deskName, open: () => (i.deskId ? openDesk(i.deskId) : openTodo(i.todo.id)) })
    } else if (i.kind === 'closable') {
      rows.push({ key: 'c' + i.deskId, tone: 'done', kind: 'can be cleared', title: i.deskName, open: () => openDesk(i.deskId), actions: onClear ? [{ label: 'Clear…', onClick: () => onClear(i.deskId) }] : undefined })
    } else if (i.kind === 'postponed' && i.due) {
      rows.push({ key: 'p' + i.deskId, tone: 'info', kind: 'back', title: i.deskName, open: () => openDesk(i.deskId) })
    }
  }
  for (const r of ready) rows.push({ key: 'r' + r.id, tone: 'good', kind: 'ready to merge', title: r.deskName, open: () => openDesk(r.deskId), actions: [{ label: 'Open on GitHub', onClick: () => openLink(r.url) }] })
  // stable: the order of the list inside a colour stays (oldest Signal first)
  rows.sort((a, b) => TONE_ORDER.indexOf(a.tone) - TONE_ORDER.indexOf(b.tone))

  return (
    <div className={'panel needs-you' + (rows.length > 0 ? ' has' : '')}>
      <h3>Needs you ({rows.length})</h3>
      {rows.length === 0 ? (
        <p className="empty">Nothing needs you right now.</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.key} className={'ny-' + r.tone} onClick={r.open}>
              <span className="ny-kind">{r.kind}</span>
              <span className="ny-title" title={r.note ? `${r.title}: ${r.note}` : r.title}>
                {r.title}
                {r.note && <span className="ny-note"> · {r.note}</span>}
              </span>
              <span className="ny-actions" onClick={(e) => e.stopPropagation()}>
                {r.actions?.map((a) => (
                  <button key={a.label} className="link-btn" onClick={a.onClick}>{a.label}</button>
                ))}
                <button className="link-btn" onClick={r.open}>Open</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
