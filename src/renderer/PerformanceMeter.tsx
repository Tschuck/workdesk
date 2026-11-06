import { useEffect, useState } from 'react'
import type { PerfLine } from '../main/performance'
import { SideSection } from './SideSection'

const size = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`)

/** Memory and CPU of everything WorkDesk started, in the left panel. Measured only while it is open and the window is shown. */
export function PerformanceMeter({ active, open, onToggle, onOpenPage }: { active?: boolean; open: boolean; onToggle: (open: boolean) => void; onOpenPage: () => void }) {
  const [total, setTotal] = useState<PerfLine>()

  useEffect(() => {
    if (!open) return
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (!document.hidden && document.hasFocus()) {
        const t = await window.workdesk.performanceTotal().catch(() => undefined)
        if (!stop && t) setTotal(t)
      }
      if (!stop) timer = setTimeout(() => void tick(), 10_000)
    }
    void tick()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [open])

  return (
    <SideSection title="Performance" open={open} onToggle={onToggle} onTitle={onOpenPage} titleHint="Open the Performance page">
      <button className={'perf-preview' + (active ? ' active' : '')} title="Memory and CPU of the app, the terminals and VS Code: open the Performance page" onClick={onOpenPage}>
        <svg className="perf-icon" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1.5 8.5h3l2-5 3 9 2-4h3" />
        </svg>
        {total ? (
          <>
            <span><span className="perf-label">Memory</span> {size(total.memoryMb)}</span>
            <span><span className="perf-label">CPU</span> {Math.round(total.cpu)}%</span>
          </>
        ) : (
          <span className="perf-label">Measuring…</span>
        )}
      </button>
    </SideSection>
  )
}
