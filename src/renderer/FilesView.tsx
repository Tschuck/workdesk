import { useEffect, useState } from 'react'
import { FilePane, FileSide, focusSearch, readTreePref, TREE_KEY, type SideTab } from './FilePane'
import type { FileRoot } from '../main/files'
import { PANEL_SIZES, Resizer } from './Resizer'
import { currentFileTabs, fileTabs, useFileTabs } from './file-tabs'
import { tabsClass, useTabsPosition } from './tabs-layout'
import { isFileDirty, setFileDirty, useFileDirty } from './file-buffers'
import { GLOBAL_DESK, type FileTab } from '../main/domain/file-tabs'

const label = (t: FileTab): string => (t.path ? (t.path.split('/').pop() ?? t.path) : 'New file')

/** Close a tab of the Files page: asks first when its file has changes that are not saved; a scratch file that was never written to goes. */
export function closeFilesTab(tab: FileTab): void {
  if (isFileDirty(tab.id) && !window.confirm('This file has changes that are not saved. Close it anyway?')) return
  if (tab.path) void window.workdesk.filesDropEmptyScratch(GLOBAL_DESK, tab.path).catch(() => undefined)
  setFileDirty(tab.id, false)
  fileTabs.close(tab.id)
}

function TabButton({ tab, active }: { tab: FileTab; active: boolean }) {
  const dirty = useFileDirty(tab.id)
  return (
    <div
      className={'tab' + (active ? ' active' : '')}
      title={tab.path}
      onClick={() => fileTabs.activate(tab.id)}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => e.button === 1 && (e.preventDefault(), closeFilesTab(tab))}
    >
      <span>{label(tab)}{dirty ? ' ●' : ''}</span>
      <button className="x" onClick={(e) => (e.stopPropagation(), closeFilesTab(tab))}>×</button>
    </div>
  )
}

/** Files outside any WorkDesk: one tree and search at full height on the left, tabs of one file each beside it (Status Repo: knowledge, notes, a scratch folder that is kept). */
export function FilesView() {
  const { tabs, active } = useFileTabs()
  const tabsPos = useTabsPosition('files')
  const [showSide, setShowSide] = useState(readTreePref)
  const [side, setSide] = useState<SideTab>('files')
  const [roots, setRoots] = useState<FileRoot[]>([])
  const activePath = tabs.find((t) => t.id === active)?.path
  // the page always has a tab to type in
  useEffect(() => {
    if (tabs.length === 0) fileTabs.new()
  }, [tabs.length])
  // the folders can change as files are made (the scratch folder, Todo notes): asked again whenever a tab shows another file
  useEffect(() => void window.workdesk.filesRoots(GLOBAL_DESK).then(setRoots, () => setRoots([])), [activePath])

  const toggleSide = (on?: boolean) =>
    setShowSide((cur) => {
      const next = on ?? !cur
      try {
        localStorage.setItem(TREE_KEY, next ? '1' : '0')
      } catch {
        // remembering is a convenience only
      }
      return next
    })
  const page = { sideShown: showSide, onToggleSide: () => toggleSide(), onSearch: () => (setSide('search'), toggleSide(true)) }

  /** a tab that shows a file with changes that are not saved: asked before the file is renamed, moved or removed */
  const mayChange = (abs: string): boolean => {
    const tab = currentFileTabs().tabs.find((t) => t.path === abs)
    return !tab || !isFileDirty(tab.id) || window.confirm('This file has changes that are not saved. Go on and lose them?')
  }
  /** a file was renamed or moved (`to`) or removed (no `to`): its tab follows it, or goes */
  const moved = (from: string, to?: string) => {
    for (const t of currentFileTabs().tabs.filter((x) => x.path === from)) {
      setFileDirty(t.id, false)
      if (to) fileTabs.setPath(t.id, to)
      else fileTabs.close(t.id)
    }
  }

  return (
    <div
      className={'files-view ' + tabsClass(tabsPos)}
      // focusable, so a click on the tree keeps the keyboard on the page (⌘B, ⇧⌘F)
      tabIndex={-1}
      onKeyDownCapture={(e) => {
        // the tree and search are the page's, so these work wherever the focus is on it
        if (!e.metaKey || e.ctrlKey || e.altKey) return
        if (e.key.toLowerCase() === 'b' && !e.shiftKey) (e.preventDefault(), e.stopPropagation(), toggleSide())
        else if (e.key.toLowerCase() === 'f' && e.shiftKey) (e.preventDefault(), e.stopPropagation(), page.onSearch(), focusSearch(e.currentTarget))
      }}
    >
      {showSide && <FileSide deskId={GLOBAL_DESK} roots={roots} side={side} onSide={setSide} current={activePath} onOpen={(path, line) => fileTabs.open(path, line)} onMoved={moved} mayChange={mayChange} />}
      <div className="files-main">
        <div className="tabbar">
          {tabs.map((t) => (
            <TabButton key={t.id} tab={t} active={t.id === active} />
          ))}
          <button className="tab-add" title="New tab (⌘T)" onClick={() => fileTabs.new()}>+<span className="tab-add-label">New tab</span></button>
        </div>
        <Resizer size={PANEL_SIZES.tabs} min={120} max={480} edge={tabsPos === 'right' ? 'left' : 'right'} panel={(h) => h.parentElement?.querySelector<HTMLElement>(':scope > .tabbar')} className="tabs-resizer" />
        <div className="tab-body">
          {/* every tab stays mounted while another is shown, so the cursor and the scroll are kept */}
          {tabs.map((t) => (
            <div key={t.id} className={'tab-pane' + (t.id === active ? ' on' : '')}>
              <FilePane
                deskId={GLOBAL_DESK}
                paneId={t.id}
                path={t.path}
                line={t.line}
                page={page}
                navigate={(path, line) => fileTabs.setPath(t.id, path, line)}
                beside={(path, line) => fileTabs.open(path, line)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
