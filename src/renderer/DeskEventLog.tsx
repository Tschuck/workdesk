import { useEffect, useState } from 'react'
import type { DeskEvent } from '../main/domain/events'

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

function when(at: number): string {
  const d = new Date(at)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return sameDay(d, new Date()) ? time : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`
}

/** What happened in this WorkDesk lately: Stage changes, branches, pull request updates, Signals, Todos. */
export function DeskEventLog({ deskId, bare }: { deskId: string; /** inside another box: no box and heading of its own */ bare?: boolean }) {
  const api = window.workdesk
  const [events, setEvents] = useState<DeskEvent[]>()

  useEffect(() => {
    let alive = true
    const load = () => void api.deskEvents(deskId, 20).then((e) => alive && setEvents(e), () => undefined)
    load()
    // the log is a small file: reading it again now and then is cheaper than a push channel
    const timer = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [api, deskId])

  const Box = bare ? 'div' : 'section'
  return (
    <Box className={bare ? 'event-log bare' : 'panel event-log'}>
      {!bare && <h3>Event log <small className="hint">last 20</small></h3>}
      {events && events.length === 0 && <p className="empty">Nothing has happened yet.</p>}
      <ul>
        {events?.map((e, i) => (
          <li key={e.at + ':' + i} className={'ev-' + e.type}>
            <time title={new Date(e.at).toLocaleString()}>{when(e.at)}</time>
            <span>{e.text}</span>
          </li>
        ))}
      </ul>
    </Box>
  )
}
