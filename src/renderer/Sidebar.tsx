import { useMemo, useState } from 'react'
import { freezeOrder } from '../main/domain/navigation'
import { orderSection, prAuthors } from '../main/domain/order'
import { isPostponed, untilLabel } from '../main/domain/postpone'
import { openSignals } from '../main/domain/signal'
import { stageLabel } from '../main/domain/stage'
import { ContextMenu } from './ContextMenu'
import { buildDeskTree, type BranchNode } from '../main/domain/tree'
import type { WorkDesk } from '../main/domain/types'
import type { PinnedTab } from '../main/domain/layout'
import { ICONS } from './Icons'
import { Spinner } from './Spinner'

interface Props {
  desks: WorkDesk[]
  /** every WorkDesk in the order of the ⌘1…⌘9 shortcuts (when this list shows only some of them) */
  numbering?: string[]
  /** the pinned Tabs of each WorkDesk, shown as icons under it */
  pins?: Record<string, PinnedTab[]>
  /** go to a pinned Tab of a WorkDesk */
  onOpenPinned?: (deskId: string, tabId: string) => void
  activeId?: string
  onSelect: (id: string) => void
  onMove: (id: string, targetId: string) => void
  /** mark every open Signal of the WorkDesk as read */
  onMarkRead: (deskId: string) => void
  /** show the WorkDesk as unread, as a reminder */
  onMarkUnread: (deskId: string) => void
  /** open a planned WorkDesk, or wake a parked one */
  onStart: (deskId: string) => void
  /** park a running WorkDesk: shut down what runs in it, keep everything else */
  onPark: (deskId: string) => void
  /** ask until when to put the WorkDesk aside */
  onPostpone: (deskId: string) => void
  /** end a postponement now */
  onBringBack: (deskId: string) => void
  onSaveTemplate: (deskId: string) => void
  onCombine: (deskId: string) => void
  onClear: (deskId: string) => void
  /** the WorkDesk can be cleared: everything it was about is done */
  closable?: ReadonlySet<string>
  /** WorkDesks that are being cleared right now: a spinner, and they cannot be opened */
  deleting?: ReadonlySet<string>
}

/** The branches of the open WorkDesk, as text: the whole entry is one click target, nothing in it is a link. */
function Branches({ nodes, depth }: { nodes: BranchNode[]; depth: number }) {
  return (
    <ul className="tree">
      {nodes.map((n) => (
        <li key={n.branch.branch}>
          <div className="branch" style={{ paddingLeft: depth * 12 }} title={`${n.branch.branch}\n${n.branch.path}`}>
            {depth > 0 ? '↳ ' : ''}
            {n.branch.branch}
          </div>
          <Branches nodes={n.children} depth={depth + 1} />
        </li>
      ))}
    </ul>
  )
}

const shortcutLabel = (n: number): string => (n >= 0 && n < 9 ? `⌘${n + 1}` : '')

/** One box per WorkDesk; a press anywhere in it opens the WorkDesk, and it can be dragged to reorder. */
export function Sidebar({ desks, numbering, pins, onOpenPinned, activeId, onSelect, onMove, onMarkRead, onMarkUnread, onStart, onPark, onPostpone, onBringBack, onSaveTemplate, onCombine, onClear, closable, deleting }: Props) {
  const [frozen, setFrozen] = useState<string[] | null>(null)
  const [dragging, setDragging] = useState<string>()
  // the right-click menu of a WorkDesk
  const [menu, setMenu] = useState<{ x: number; y: number; deskId: string }>()
  const computed = useMemo(() => orderSection(desks), [desks])
  const rows = freezeOrder(
    computed.map((o) => ({ ...o, id: o.desk.id })),
    frozen
  )

  const menuDesk = menu && desks.find((d) => d.id === menu.deskId)
  const unread = menuDesk ? openSignals(menuDesk).length : 0

  return (
    <>
    <ul className="desks">
      {rows.map(({ desk, dimmed }, i) => {
        const open = openSignals(desk)
        const gone = !!deleting?.has(desk.id)
        return (
          <li
            key={desk.id}
            className={['desk', dimmed ? 'dimmed' : '', desk.presence === 'parked' ? 'parked' : desk.presence === 'planned' ? 'planned' : '', desk.id === activeId ? 'active' : '', desk.id === dragging ? 'dragging' : '', gone ? 'deleting' : ''].join(' ')}
            draggable={!gone}
            // on the press, not the release: a drag that starts with a slight move never sends a click
            onMouseDown={(e) => e.button === 0 && !gone && onSelect(desk.id)}
            onContextMenu={(e) => (e.preventDefault(), !gone && setMenu({ x: e.clientX, y: e.clientY, deskId: desk.id }))}
            onDragStart={() => {
              setFrozen(rows.map((r) => r.id))
              setDragging(desk.id)
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragging && dragging !== desk.id) onMove(dragging, desk.id)
            }}
            onDragEnd={() => {
              setFrozen(null)
              setDragging(undefined)
            }}
          >
            <div className="desk-row">
              <span className="index">{shortcutLabel(numbering ? numbering.indexOf(desk.id) : i)}</span>
              <span className="name">{desk.name}</span>
              {open.length > 0 && (
                <span className="signal" title={`${open.length} open Signal${open.length === 1 ? '' : 's'}`}>
                  {open.length}
                </span>
              )}
            </div>
            <div className="stage">
              {gone ? <><Spinner /> Deleting…</> : desk.presence === 'planned' ? 'Planned' : stageLabel(desk.stage) + (desk.presence === 'parked' ? ' · parked' : '')}
              {!gone && isPostponed(desk) && ` · back ${untilLabel(desk.postponedUntil!)}`}
              {!gone && prAuthors(desk).map((a) => <span key={a} className="chip small pr-author" title={`Pull request by ${a}`}>{a}</span>)}
            </div>
            {!gone && desk.id !== activeId && desk.branches.length > 0 && (
              // inactive WorkDesks stay compact: the whole tree is shown for the active one only
              <div
                className="branch-summary"
                title={desk.branches.map((b) => `${b.project}: ${b.branch}`).join('\n')}
              >
                <span className="project-name">{desk.branches[0].project}</span> · <code>{desk.branches[0].branch}</code>
                {desk.branches.length > 1 && <span className="chip small">+{desk.branches.length - 1}</span>}
              </div>
            )}
            {desk.id === activeId && buildDeskTree(desk).map((p) => (
              <div key={p.project} className="project">
                <div className="project-name">{p.project}</div>
                <Branches nodes={p.branches} depth={0} />
              </div>
            ))}
            {(pins?.[desk.id] ?? []).length > 0 && (
              <div className="desk-pins">
                {pins![desk.id].map((t) => (
                  <button
                    key={t.tabId}
                    type="button"
                    className="desk-pin"
                    title={t.name}
                    // not the press of the whole box (that opens the WorkDesk on its own Tab): this one goes to the Tab
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => (e.stopPropagation(), onOpenPinned?.(desk.id, t.tabId))}
                  >
                    {t.favicon ? <img src={t.favicon} alt="" width={14} height={14} onError={(e) => (e.currentTarget.style.display = 'none')} /> : ICONS[t.icon === 'browser' ? 'globe' : t.icon]}
                  </button>
                ))}
              </div>
            )}
          </li>
        )
      })}
    </ul>
    {menu && menuDesk && (
      <ContextMenu
        x={menu.x}
        y={menu.y}
        onClose={() => setMenu(undefined)}
        // one entry that turns around: unread ones can be marked as read, read ones as unread (a reminder, until you open it)
        items={[
          menuDesk.presence === 'planned'
            ? { label: 'Start', onClick: () => onStart(menuDesk.id) }
            : menuDesk.presence === 'parked'
              ? { label: 'Start again (wake it up)', onClick: () => onStart(menuDesk.id) }
              : { label: 'Pause (park)', onClick: () => onPark(menuDesk.id) },
          isPostponed(menuDesk) ? { label: 'Bring back now', onClick: () => onBringBack(menuDesk.id) } : { label: 'Postpone…', onClick: () => onPostpone(menuDesk.id) },
          unread > 0 ? { label: `Mark as read (${unread})`, onClick: () => onMarkRead(menuDesk.id) } : { label: 'Mark as unread', onClick: () => onMarkUnread(menuDesk.id) },
          ...(closable?.has(menuDesk.id) ? [{ label: 'Clear this WorkDesk…', onClick: () => onClear(menuDesk.id) }] : []),
          { label: 'Combine with another WorkDesk…', onClick: () => onCombine(menuDesk.id) },
          { label: 'Save as template…', onClick: () => onSaveTemplate(menuDesk.id) }
        ]}
      />
    )}
    </>
  )
}
