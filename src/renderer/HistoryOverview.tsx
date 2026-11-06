import { useEffect, useMemo, useState } from 'react'
import { dayLabel, dayStart, type HistoryEntry } from '../main/domain/history'
import { useOpenLink } from './OpenLink'

const host = (url: string): string => url.replace(/^https?:\/\/(www\.)?/, '')
const clock = (at: number): string => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/** Settings → Browser → History: the pages visited in the browser, newest first by day, with a search; a click opens one, × forgets it. */
export function HistoryOverview() {
  const api = window.workdesk
  const openLink = useOpenLink()
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [total, setTotal] = useState(0)
  const [enabled, setEnabled] = useState(true)
  const [keepDays, setKeepDays] = useState(0)
  const load = (q: string) => {
    void api.historyList(q, 1000).then(setEntries)
    void api.historyState().then((s) => (setTotal(s.count), setEnabled(s.enabled), setKeepDays(s.keepDays)))
  }
  useEffect(() => {
    const timer = setTimeout(() => load(query), 150)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])
  const now = Date.now()
  const days = useMemo(() => {
    const out: { day: string; start: number; items: HistoryEntry[] }[] = []
    for (const e of entries) {
      const day = dayLabel(e.last, now)
      if (out.at(-1)?.day === day) out.at(-1)!.items.push(e)
      else out.push({ day, start: dayStart(e.last), items: [e] })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries])
  return (
    <section className="history-overview">
      <h2>History</h2>
      <p className="hint">
        {total} page{total === 1 ? '' : 's'} visited in the browser, kept on this machine only. {!enabled && 'Remembering is switched off (Security tab), so nothing new is added. '}
        {entries.length < total && !query.trim() ? `The newest ${entries.length} are listed; search to find older ones. ` : ''}
      </p>
      <div className="history-tools">
        <label>
          Forget pages older than{' '}
          <select value={keepDays} onChange={(e) => void api.historyKeepDays(Number(e.target.value)).then(() => load(query))} title="Older pages are removed now and then every few hours">
            <option value={0}>never (keep all)</option>
            {[1, 7, 14, 30, 90, 180, 365].map((n) => (
              <option key={n} value={n}>{n === 1 ? 'today (keep only today)' : `${n} days`}</option>
            ))}
          </select>
        </label>
        <button
          disabled={total === 0}
          onClick={() => window.confirm(`Forget all ${total} visited pages?`) && void api.historyClear().then(() => load(query))}
        >
          Clear all history
        </button>
      </div>
      <input className="palette-input" autoFocus placeholder="Search the history by title or address…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {days.map((d) => (
        <div key={d.day}>
          <h4 className="history-day">
            <span>{d.day}</span>
            <button
              className="forget-day"
              title={`Forget the pages last visited ${d.day === 'Today' || d.day === 'Yesterday' ? d.day.toLowerCase() : 'on ' + d.day}`}
              onClick={() => window.confirm(`Forget the ${d.items.length}${query.trim() ? ' listed' : ''} page${d.items.length === 1 ? '' : 's'} of ${d.day}?${query.trim() ? ' (The whole day is cleared, not only the matches.)' : ''}`) && void api.historyForgetDay(d.start).then(() => load(query))}
            >
              Clear day
            </button>
          </h4>
          <ul>
            {d.items.map((e) => (
              <li key={e.url} className="history-row" title={e.url} onClick={() => openLink(e.url)}>
                <span className="time">{clock(e.last)}</span>
                <span className="title">{e.title || host(e.url)}</span>
                <span className="hint">{host(e.url)}</span>
                {e.visits > 1 && <span className="visits">{e.visits}×</span>}
                <button className="forget" title="Forget this page" onClick={(ev) => (ev.stopPropagation(), void api.historyForget(e.url).then(() => load(query)))}>×</button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {entries.length === 0 && <p className="empty">{query.trim() ? 'Nothing found.' : 'No pages visited yet.'}</p>}
    </section>
  )
}
