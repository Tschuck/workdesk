import { paneIds, type DeskLayout, type LayoutNode, type SplitDirection } from '../main/domain/layout'
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
}

export function LayoutView({ deskId, tabId, node, onSplit, onClose, onLayout }: Props) {
  if (node.type === 'pane') {
    return (
      <div className="pane-cell" data-pane-id={node.id}>
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
  return (
    <div className={node.direction === 'horizontal' ? 'split row' : 'split column'}>
      {node.children.map((child, i) => (
        <LayoutView key={child.type === 'pane' ? child.id : `split-${i}`} deskId={deskId} tabId={tabId} node={child} onSplit={onSplit} onClose={onClose} onLayout={onLayout} />
      ))}
    </div>
  )
}
