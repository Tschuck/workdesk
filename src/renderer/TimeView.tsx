import { useState } from 'react'
import { dayKey, formatDuration, weekDays, weekSummary } from '../main/domain/time-tracking'
import { DayBars, useTimeLog } from './TimeSpent'
import './time.css'

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const pretty = (day: string): string => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/** The time page: this week (or an earlier one) per day and per WorkDesk, counted passively while a WorkDesk is on screen. */
export function TimeView({ desks, openDesk, scoped }: { desks: { id: string; name: string }[]; openDesk: (id: string) => void; scoped: boolean }) {
  const log = useTimeLog()
  const [offset, setOffset] = useState(0)
  const now = Date.now()
  const days = weekDays(now, offset)
  const week = weekSummary(log, days, Object.fromEntries(desks.map((d) => [d.id, d.name])), scoped)
  const today = dayKey(now)
  const worked = week.days.filter((d) => d.seconds > 0).length
  const label = offset === 0 ? 'This week' : offset === -1 ? 'Last week' : `${-offset} weeks ago`

  return (
    <section className="time-page">
      <div className="time-head">
        <h2>Time</h2>
        <span className="time-nav">
          <button aria-label="The week before" title="The week before" onClick={() => setOffset(offset - 1)}>◀</button>
          <strong>{label}</strong>
          <span className="hint">{pretty(days[0])} – {pretty(days[6])}</span>
          <button aria-label="The next week" title="The next week" disabled={offset >= 0} onClick={() => setOffset(offset + 1)}>▶</button>
          {offset !== 0 && <button className="link-btn" onClick={() => setOffset(0)}>This week</button>}
        </span>
      </div>

      <div className="time-totals">
        <span>
          Total <strong>{formatDuration(week.total)}</strong>
        </span>
        <span>
          Days worked <strong>{worked}</strong>
        </span>
        <span>
          Per worked day <strong>{worked ? formatDuration(week.total / worked) : '–'}</strong>
        </span>
      </div>

      <DayBars days={week.days} today={today} />

      {week.total === 0 ? (
        <p className="hint">Nothing counted in this week.</p>
      ) : (
        <table className="time-table">
          <thead>
            <tr>
              <th>WorkDesk</th>
              {week.days.map((d, i) => (
                <th key={d.day} className={d.day === today ? 'today' : ''}>{WEEKDAY[i]}</th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {week.rows.map((r) => (
              <tr key={r.deskId}>
                <td>
                  <button className="link-btn" title="Open this WorkDesk" onClick={() => openDesk(r.deskId)}>{r.name}</button>
                </td>
                {r.perDay.map((s, i) => (
                  <td key={i} className={s === 0 ? 'zero' : ''}>{s > 0 ? formatDuration(s) : '·'}</td>
                ))}
                <td className="sum">{formatDuration(r.seconds)}</td>
              </tr>
            ))}
            {week.cleared > 0 && (
              <tr className="cleared">
                <td title="WorkDesks that were cleared since">Cleared WorkDesks</td>
                <td colSpan={7} />
                <td className="sum">{formatDuration(week.cleared)}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td>All</td>
              {week.days.map((d) => (
                <td key={d.day}>{d.seconds > 0 ? formatDuration(d.seconds) : '·'}</td>
              ))}
              <td className="sum">{formatDuration(week.total)}</td>
            </tr>
          </tfoot>
        </table>
      )}
      <p className="hint">Counted while a WorkDesk is on screen, the window is in front and you are not idle for 5 minutes. Kept for 90 days, on this machine.</p>
    </section>
  )
}
