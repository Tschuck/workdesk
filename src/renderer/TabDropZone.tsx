import { createContext, useContext, useState } from 'react'
import type { SplitDirection } from '../main/domain/layout'

export interface TabSplit {
  direction: SplitDirection
  before: boolean
}

/** A Tab is being dragged (its id), and what to do when it is dropped on a Pane of the Tab on screen. */
export const TabDragContext = createContext<{
  dragging?: string
  drop: (toTabId: string, paneId: string, split: TabSplit) => void
  /** a Pane is being dragged (by its grip), from this Tab */
  pane?: { tabId: string; paneId: string }
  dropPane?: (toTabId: string, targetPaneId: string, split: TabSplit) => void
}>({ drop: () => undefined })

/** Which edge of the Pane the pointer is nearest to: the Tab goes there (left / above first). */
export function splitAt(x: number, y: number, box: { left: number; top: number; width: number; height: number }): TabSplit {
  const fx = (x - box.left) / box.width
  const fy = (y - box.top) / box.height
  const edges = [
    { d: fx, split: { direction: 'horizontal', before: true } },
    { d: 1 - fx, split: { direction: 'horizontal', before: false } },
    { d: fy, split: { direction: 'vertical', before: true } },
    { d: 1 - fy, split: { direction: 'vertical', before: false } }
  ] as const
  return edges.reduce((best, e) => (e.d < best.d ? e : best)).split
}

const zoneClass = (s: TabSplit): string => (s.direction === 'horizontal' ? (s.before ? 'left' : 'right') : s.before ? 'top' : 'bottom')

/** Over a Pane while a Tab is dragged: shows where the Tab would go (a half of the Pane) and takes the drop. A web page would swallow the drag, so this sits on top of it. */
export function TabDropZone({ tabId, paneId }: { tabId: string; paneId: string }) {
  const drag = useContext(TabDragContext)
  const [zone, setZone] = useState<TabSplit>()
  // a Tab or a Pane is on its way; neither lands on itself
  if (drag.pane ? drag.pane.paneId === paneId : !drag.dragging || drag.dragging === tabId) return null
  const at = (e: React.DragEvent): TabSplit => splitAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect())
  return (
    <div
      className="tab-dropzone"
      onDragOver={(e) => (e.preventDefault(), setZone(at(e)))}
      onDragLeave={() => setZone(undefined)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setZone(undefined)
        if (drag.pane) drag.dropPane?.(tabId, paneId, at(e))
        else drag.drop(tabId, paneId, at(e))
      }}
    >
      {zone && <div className={'tab-dropzone-half ' + zoneClass(zone)} />}
    </div>
  )
}
