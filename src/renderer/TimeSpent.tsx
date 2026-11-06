import { useEffect, useState } from 'react'
import { deskDays, formatDuration, type TimeLog } from '../main/domain/time-tracking'
import './nav.css'

/** The time log, read now and then (it is counted in the main process). */
export function useTimeLog(): TimeLog {
  const [log, setLog] = useState<TimeLog>({})
  useEffect(() => {
    let live = true
    const load = () => void window.workdesk.timeLog().then((l) => live && setLog(l), () => undefined)
    load()
    const t = setInterval(load, 60_000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [])
  return log
}

const dayLabel = (day: string): string => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

/** A horizontal bar per day that has time (the ones without are left out), as wide as its share of the longest day. */
export function DayBars({ days, today }: { days: { day: string; seconds: number }[]; today?: string }) {
  const shown = days.filter((d) => d.seconds > 0)
  const max = Math.max(...shown.map((d) => d.seconds), 1)
  return (
    <ul className="time-box-rows">
      {shown.map((d) => (
        <li key={d.day} className={d.day === today ? 'today' : ''} title={`${d.day}: ${formatDuration(d.seconds)}`}>
          <span className="time-box-label">{dayLabel(d.day)}</span>
          <span className="time-box-track">
            <span className="time-box-fill" style={{ width: `${Math.max(2, Math.round((d.seconds / max) * 100))}%` }} />
          </span>
          <span className="time-box-value">{formatDuration(d.seconds)}</span>
        </li>
      ))}
    </ul>
  )
}

/** Time spent in one WorkDesk, a box on its Details page: today, 7 days and a bar per day. */
export function TimeSpent({ deskId }: { deskId: string }) {
  const log = useTimeLog()
  const days = deskDays(log, deskId, Date.now(), 7)
  const week = days.reduce((a, d) => a + d.seconds, 0)
  if (week === 0) return null
  return (
    <section className="panel time-box" title="Counted while this WorkDesk is on screen, the window is in front and you are not idle for 5 minutes">
      <h3>
        Time
        <span className="panel-tools">
          <button className="go-btn" title="Time per day and WorkDesk, week by week" onClick={() => window.dispatchEvent(new Event(GO_TIME_EVENT))}>This week →</button>
        </span>
      </h3>
      <div className="time-box-sums">
        <span>
          Today <strong>{formatDuration(days[0].seconds)}</strong>
        </span>
        <span>
          7 days <strong>{formatDuration(week)}</strong>
        </span>
      </div>
      <DayBars days={days} today={days[0].day} />
    </section>
  )
}

/** Asks the app to open the Time page (sent from the box on a WorkDesk's Details page). */
export const GO_TIME_EVENT = 'workdesk:go-time'
