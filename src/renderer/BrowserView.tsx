import { Fragment, useState } from 'react'
import { PANEL_SIZES, Resizer } from './Resizer'
import { useSortable } from './useSortable'
import { tabGroupHeader, tabsClass, tabsSide, useTabsPosition } from './tabs-layout'
import { BookmarkStart } from './Bookmarks'
import { ContextMenu } from './ContextMenu'
import { BrowserPane } from './BrowserPane'
import { pageTabs, usePageTabs } from './browser-tabs'
import { ordered, tabLabel } from '../main/domain/browser-tabs'
import { OpenLinkContext } from './OpenLink'

/** Web pages outside any WorkDesk: its own Tabs, the same bookmarks and session (logins) as the browser Tabs of the WorkDesks. */
export function BrowserView() {
  const { tabs, active } = usePageTabs()
  const tabsPos = useTabsPosition('browser')
  // the right-click menu of a Tab
  const [menu, setMenu] = useState<{ x: number; y: number; id: string }>()
  // the Tab whose name is being typed
  const [editing, setEditing] = useState<string>()
  const menuTab = menu && tabs.find((t) => t.id === menu.id)
  // sorting: pinned tabs among the pinned ones, open tabs among the open ones
  const sort = useSortable(pageTabs.move, (a, b) => !!tabs.find((t) => t.id === a)?.pinned === !!tabs.find((t) => t.id === b)?.pinned, () => tabsSide('browser'))
  return (
    <OpenLinkContext.Provider value={pageTabs.open}>
      <div className={'browser-view ' + tabsClass(tabsPos)}>
        <div className="tabbar">
          {ordered(tabs).map((t, i, all) => (
            <Fragment key={t.id}>
            {tabGroupHeader(all, i)}
            <div
              {...sort.props(t.id)}
              className={['tab', t.id === active ? 'active' : '', t.pinned ? 'pinned' : '', t.hibernated ? 'hibernated' : '', sort.classes(t.id)].filter(Boolean).join(' ')}
              title={(t.hibernated ? 'Hibernated: the page is unloaded. ' : '') + (t.pinned || t.hibernated ? tabLabel(t) : '') || undefined}
              onClick={() => pageTabs.activate(t.id)}
              onDoubleClick={() => setEditing(t.id)}
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onAuxClick={(e) => e.button === 1 && (e.preventDefault(), pageTabs.close(t.id))}
              onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, id: t.id }))}
            >
              {t.favicon ? <img className="tab-icon" src={t.favicon} alt="" width={14} height={14} onError={(e) => (e.currentTarget.style.display = 'none')} /> : t.pinned && <span className="tab-icon">{tabLabel(t).charAt(0).toUpperCase()}</span>}
              {editing === t.id ? (
                <input
                  autoFocus
                  className="tab-rename"
                  defaultValue={t.name ?? t.title}
                  placeholder="page title"
                  onFocus={(e) => e.target.select()}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onBlur={(e) => (setEditing(undefined), pageTabs.rename(t.id, e.target.value.trim() === t.title ? '' : e.target.value))}
                  onKeyDown={(e) => (e.key === 'Enter' ? e.currentTarget.blur() : e.key === 'Escape' && (e.currentTarget.value = t.name ?? t.title, e.currentTarget.blur()))}
                />
              ) : (
                <span className="tab-label">{tabLabel(t)}</span>
              )}
              <button
                className="x"
                title={t.pinned ? 'Unpin' : 'Pin the tab: only its icon, also in the left panel'}
                onClick={(e) => (e.stopPropagation(), pageTabs.togglePin(t.id))}
              >
                📌
              </button>
              {!t.pinned && <button className="x" onClick={(e) => (e.stopPropagation(), pageTabs.close(t.id))}>×</button>}
            </div>
            </Fragment>
          ))}
          <button className="tab-add" title="New tab" onClick={() => pageTabs.open()}>+<span className="tab-add-label">New tab</span></button>
        </div>
        <Resizer size={PANEL_SIZES.tabs} min={120} max={480} edge={tabsPos === 'right' ? 'left' : 'right'} panel={(h) => h.parentElement?.querySelector<HTMLElement>(':scope > .tabbar')} className="tabs-resizer" />
        <div className="tab-body">
          {tabs.length === 0 && (
            <div className="browser-empty">
              <h2>Browser</h2>
              <p className="hint">Web pages that belong to no WorkDesk. Tabs are kept until you close them; pin one to keep it as an icon in the left panel.</p>
              <p><button className="primary" onClick={() => pageTabs.open()}>New tab</button></p>
              <h3>Bookmarks</h3>
              <BookmarkStart onOpen={pageTabs.open} />
            </div>
          )}
          {/* pages stay mounted while another Tab is shown, so nothing reloads */}
          {tabs.map((t) => (
            <div key={t.id} className={'tab-pane' + (t.id === active ? ' on' : '')}>
              {t.hibernated ? (
                <div className="hibernated-page">
                  {t.favicon && <img src={t.favicon} alt="" width={28} height={28} onError={(e) => (e.currentTarget.style.display = 'none')} />}
                  <h3>{tabLabel(t)}</h3>
                  <p className="hint">This tab is hibernated: its page is unloaded to free memory. Its address and title are kept.</p>
                  <button className="primary" onClick={() => pageTabs.wake(t.id)}>Wake up</button>
                </div>
              ) : (
                <BrowserPane url={t.url} rememberKey={t.id} onLocation={(l) => pageTabs.locate(t.id, l)} />
              )}
            </div>
          ))}
        </div>
      </div>
      {menu && menuTab && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(undefined)}
          items={[
            { label: 'Rename…', onClick: () => setEditing(menuTab.id) },
            { label: 'Duplicate', onClick: () => pageTabs.duplicate(menuTab.id) },
            { label: menuTab.pinned ? 'Unpin' : 'Pin', onClick: () => pageTabs.togglePin(menuTab.id) },
            menuTab.hibernated
              ? { label: 'Wake up', onClick: () => pageTabs.wake(menuTab.id) }
              : { label: 'Hibernate', onClick: () => pageTabs.hibernate(menuTab.id) }
          ]}
        />
      )}
    </OpenLinkContext.Provider>
  )
}
