import { Fragment, useState } from 'react'
import { paneIds, splitSizes, type DeskLayout, type LayoutNode, type SplitDirection, type SplitNode } from '../main/domain/layout'
import { BrowserPane } from './BrowserPane'
import { TerminalPane } from './TerminalPane'
import { FilePane } from './FilePane'
import { TabDropZone } from './TabDropZone'

/** Drag type of a Pane, so the Tab bar can tell it from a dragged Tab. */
export const PANE_MIME = 'application/x-workdesk-pane'

interface Props {
  deskId: string
  tabId: string
  node: LayoutNode
  onSplit: (paneId: string, direction: SplitDirection, kind?: 'terminal' | 'browser' | 'file') => void
  onClose: (paneId: string) => void
  onLayout: (layout: DeskLayout) => void
  /** where this node is in the Tab: the child index on each level from the root */
  at?: number[]
  /** its share of the split it is in */
  share?: number
}

/** a Pane is not dragged smaller than this */
const MIN_PANE_PX = 80

export function LayoutView({ deskId, tabId, node, onSplit, onClose, onLayout, at = [], share }: Props) {
  const style = share === undefined ? undefined : { flex: `${share} 1 0` }
  if (node.type === 'pane') {
    return (
      <div className="pane-cell" data-pane-id={node.id} style={style}>
        <TabDropZone tabId={tabId} paneId={node.id} />
        <div className="pane-bar">
          <span
            className="pane-grip"
            title="Drag to a Tab, to the Tab bar for a new Tab, or onto the edge of another Pane to split there"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData(PANE_MIME, JSON.stringify({ tabId, paneId: node.id }))
            }}
          >
            ⠿
          </span>
          <button title="Split right" onClick={() => onSplit(node.id, 'horizontal')}>⇥</button>
          <button title="Split down" onClick={() => onSplit(node.id, 'vertical')}>⇩</button>
          <button title="Browser right" onClick={() => onSplit(node.id, 'horizontal', 'browser')}>🌐⇥</button>
          <button title="Browser below" onClick={() => onSplit(node.id, 'vertical', 'browser')}>🌐⇩</button>
          <button title="File right" onClick={() => onSplit(node.id, 'horizontal', 'file')}>📄⇥</button>
          <button title="Close Pane" onClick={() => onClose(node.id)}>×</button>
        </div>
        {node.kind === 'browser' && node.hibernated ? (
          <div className="hibernated-page">
            {node.favicon && <img src={node.favicon} alt="" width={28} height={28} onError={(e) => (e.currentTarget.style.display = 'none')} />}
            <h3>{node.title || node.url}</h3>
            <p className="hint">This page is hibernated: it is unloaded to free memory. Its address and title are kept.</p>
            <button className="primary" onClick={() => void window.workdesk.hibernateTab(deskId, tabId, false).then(onLayout)}>Wake up</button>
          </div>
        ) : node.kind === 'browser' ? (
          <BrowserPane
            url={node.url}
            paneId={node.id}
            onLocation={(l) => void window.workdesk.setBrowserLocation(deskId, tabId, node.id, l.url, l.title, l.favicon).then(onLayout)}
          />
        ) : node.kind === 'file' ? (
          <FilePane
            deskId={deskId}
            paneId={node.id}
            path={node.path}
            line={node.line}
            navigate={(path, line) => window.workdesk.setFileLocation(deskId, tabId, node.id, path, line).then(onLayout)}
            beside={async (path, line) => {
              // a new Pane right after this one shows the file
              const split = await window.workdesk.splitPane(deskId, tabId, node.id, 'horizontal', 'file')
              const tab = split.tabs.find((t) => t.id === tabId)
              const ids = tab && tab.kind === 'panes' ? paneIds(tab.layout) : []
              const added = ids[ids.indexOf(node.id) + 1]
              onLayout(added ? await window.workdesk.setFileLocation(deskId, tabId, added, path, line) : split)
            }}
          />
        ) : (
          <TerminalPane deskId={deskId} paneId={node.id} cwd={node.cwd ?? ''} />
        )}
      </div>
    )
  }
  return <SplitView deskId={deskId} tabId={tabId} node={node} onSplit={onSplit} onClose={onClose} onLayout={onLayout} at={at} style={style} />
}

/** The children of a split side by side (or stacked), with a handle between each two to drag their border; a double click makes them all the same. */
function SplitView({ deskId, tabId, node, onSplit, onClose, onLayout, at, style }: Omit<Props, 'node' | 'share'> & { node: SplitNode; at: number[]; style?: { flex: string } }) {
  // the shares while a handle is dragged; saved when it is let go
  const [dragged, setDragged] = useState<number[]>()
  const sizes = dragged ?? splitSizes(node)
  const row = node.direction === 'horizontal'
  const save = (next: number[]) => void window.workdesk.setSplitSizes(deskId, tabId, at, next).then(onLayout, () => undefined).finally(() => setDragged(undefined))

  const start = (down: React.MouseEvent<HTMLElement>, i: number) => {
    if (down.button !== 0) return
    down.preventDefault()
    const box = down.currentTarget.parentElement!.getBoundingClientRect()
    const total = row ? box.width : box.height
    const from = row ? down.clientX : down.clientY
    const base = splitSizes(node)
    const pair = base[i] + base[i + 1]
    const min = Math.min(MIN_PANE_PX / total, pair / 2)
    let current = base
    const shield = document.createElement('div')
    shield.className = 'resizer-shield' + (row ? '' : ' rows')
    // a web page under the pointer would take the mouse events of the drag
    document.body.append(shield)
    const move = (e: MouseEvent) => {
      const delta = ((row ? e.clientX : e.clientY) - from) / total
      const left = Math.min(pair - min, Math.max(min, base[i] + delta))
      current = base.map((s, j) => (j === i ? left : j === i + 1 ? pair - left : s))
      setDragged(current)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      shield.remove()
      if (current !== base) save(current)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className={row ? 'split row' : 'split column'} style={style}>
      {node.children.map((child, i) => (
        <Fragment key={child.type === 'pane' ? child.id : `split-${i}`}>
          {i > 0 && (
            <div
              className={'split-handle ' + (row ? 'cols' : 'rows')}
              role="separator"
              aria-orientation={row ? 'vertical' : 'horizontal'}
              title="Drag to change the sizes (double click: all the same)"
              onMouseDown={(e) => start(e, i - 1)}
              onDoubleClick={() => save(node.children.map(() => 1))}
            />
          )}
          <LayoutView deskId={deskId} tabId={tabId} node={child} onSplit={onSplit} onClose={onClose} onLayout={onLayout} at={[...at, i]} share={sizes[i]} />
        </Fragment>
      ))}
    </div>
  )
}
