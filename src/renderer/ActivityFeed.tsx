import { useEffect, useState } from 'react'
import type { RecentEvent } from '../main/domain/events'
import type { WorkDesk } from '../main/domain/types'
import { ago } from './Icons'
import { SideSection } from './SideSection'

/** What happened lately, in which WorkDesk: the newest events of all of them at the bottom of the left panel. */
export function ActivityFeed({ desks, open, onToggle, onOpen }: { desks: WorkDesk[]; open: boolean; onToggle: (open: boolean) => void; onOpen: (deskId: string) => void }) {
  const [events, setEvents] = useState<RecentEvent[]>([])
  // read again when something about a WorkDesk changed (events are written with the change), and now and then
  const changed = desks.map((d) => `${d.id}:${d.stage}:${d.presence}:${d.signals.length}:${d.branches.length}:${d.todoIds.length}:${d.items?.length ?? 0}:${d.name}`).join('|')
  useEffect(() => {
    if (!open) return
    let alive = true
    const load = () => void window.workdesk.recentEvents(30).then((e) => alive && setEvents(e.filter((x) => desks.some((d) => d.id === x.deskId)).slice(0, 7)), () => undefined)
    load()
    const timer = setInterval(load, 20_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [changed, open])

  return (
    <SideSection title="Activity" className="activity" open={open} onToggle={onToggle}>
      {events.length === 0 ? (
        <p className="hint">Nothing yet.</p>
      ) : (
        <ul>
          {events.map((e, i) => (
            <li key={`${e.deskId}:${e.at}:${i}`} className={'ev-' + e.type} onClick={() => onOpen(e.deskId)} title={`${e.deskName}: ${e.text}\n${new Date(e.at).toLocaleString()}`}>
              <span className="activity-desk">{e.deskName}</span>
              <time>{ago(e.at)}</time>
              <span className="activity-text">{e.text}</span>
            </li>
          ))}
        </ul>
      )}
    </SideSection>
  )
}
