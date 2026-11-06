import { useEffect, useState } from 'react'
import type { JobInfo } from '../main/jobs'
import { ICONS } from './Icons'

/** what is loading, kept current by the main process */
function useJobs(): JobInfo[] {
  const [jobs, setJobs] = useState<JobInfo[]>([])
  useEffect(() => {
    void window.workdesk.jobs().then(setJobs)
    return window.workdesk.onJobs(setJobs)
  }, [])
  return jobs
}

const secs = (since: number, now: number): string => {
  const s = Math.max(0, Math.round((now - since) / 1000))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
}

/** The global refresh button: it turns while anything loads, and hovering it lists what is loading and for how long. */
export function RefreshButton({ rail }: { rail?: boolean }) {
  const jobs = useJobs()
  const [at, setAt] = useState<{ x: number; y: number }>()
  const [now, setNow] = useState(Date.now())
  const busy = jobs.length > 0
  useEffect(() => {
    if (!at) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [at])
  const run = () => void window.workdesk.refreshAll().catch(() => undefined)
  return (
    <>
      <button
        className={(rail ? '' : 'icon-btn') + (busy ? ' spinning' : '')}
        aria-label="Refresh everything"
        onClick={run}
        onMouseEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setNow(Date.now())
          setAt(rail ? { x: r.right + 6, y: r.top } : { x: r.left, y: r.bottom + 6 })
        }}
        onMouseLeave={() => setAt(undefined)}
      >
        {ICONS.reload}
      </button>
      {at && (
        <div className="job-pop" style={{ left: at.x, top: at.y }} role="status">
          <strong>{busy ? `Loading (${jobs.length})` : 'Nothing is loading'}</strong>
          {jobs.map((j) => (
            <div key={j.id} className="job-row">
              <span>{j.label}</span>
              <span className="job-time">{secs(j.since, now)}</span>
            </div>
          ))}
          <span className="hint">Click to refresh everything now</span>
        </div>
      )}
    </>
  )
}
