import { useContext, useEffect, useRef, useState } from 'react'
import { ContextMenu } from './ContextMenu'
import { DeskLinksContext } from './OpenLink'
import { useSearchEngines } from './search-engine'
import type { HistoryEntry } from '../main/domain/history'
import { isAddress, normalizeUrl } from '../main/domain/url'
import { collapseAll, DEFAULT_GROUP_SETTINGS, isCollapsed, moveGroup, orderGroups, toggleGroup, type GroupSettings } from '../main/domain/bookmark-groups'
import { findBookmark, groupBookmarks, isBookmarkable, rankBookmarks, sectionsInOrder, type Bookmark } from '../main/domain/bookmarks'

/** The bookmarks, kept current when one changes anywhere (another Pane, the Browser page). */
export function useBookmarks(): Bookmark[] {
  const [list, setList] = useState<Bookmark[]>([])
  useEffect(() => {
    let live = true
    void window.workdesk.bookmarksList().then((l) => live && setList(l))
    const off = window.workdesk.onBookmarksChanged(setList)
    return () => {
      live = false
      off()
    }
  }, [])
  return list
}

interface Props {
  /** the page the Pane shows now */
  url: string
  title: string
  /** the icon the page announced; kept with the bookmark */
  favicon?: string
}

/** The star that bookmarks the current page (the favorites themselves are listed on every new tab). */
export function BookmarkControls({ url, title, favicon }: Props) {
  const list = useBookmarks()
  const known = findBookmark(list, url)
  const can = isBookmarkable(url)
  const [configuring, setConfiguring] = useState(false)
  // a bookmarked page that has no icon kept yet hands it over when it announces one
  useEffect(() => {
    if (known && !known.favicon && favicon) void window.workdesk.bookmarksIcon(url, favicon)
  }, [known?.id, known?.favicon, favicon, url])

  return (
    <div className="bookmarks">
      <button
        type="button"
        className={known ? 'star on' : 'star'}
        disabled={!can && !known}
        title={known ? 'Edit the favorite' : 'Add this page to the favorites'}
        onClick={() => setConfiguring(true)}
      >
        {known ? '★' : '☆'}
      </button>
      {configuring && <FavoriteDialog existing={known} taken={list} url={url} title={title} favicon={favicon} groups={[...new Set(list.flatMap((b) => (b.group ? [b.group] : [])))]} onClose={() => setConfiguring(false)} />}
    </div>
  )
}

/** The little dialog of the star: name, address and group of a favorite, to add it or to change it (and remove it). */
export function FavoriteDialog({ existing, url, title, favicon, groups, taken = [], initialGroup, heading, onClose }: { existing?: Bookmark; url: string; title: string; favicon?: string; groups: string[]; /** the favorites that exist: an address may be a favorite once */ taken?: Bookmark[]; initialGroup?: string; heading?: string; onClose: () => void }) {
  const api = window.workdesk
  const [name, setName] = useState(existing?.title ?? (title || url))
  const [address, setAddress] = useState(existing?.url ?? url)
  const [group, setGroup] = useState(existing?.group ?? initialGroup ?? '')
  const [error, setError] = useState<string>()
  const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

  const save = async () => {
    try {
      let list: Bookmark[]
      if (existing) {
        list = await api.bookmarksRename(existing.id, name.trim() || existing.title)
        if (address.trim() !== existing.url) list = await api.bookmarksSetUrl(existing.id, address.trim())
        await api.bookmarksGroup(existing.id, group.trim())
      } else {
        const raw = address.trim() || url
        if (!raw) throw new Error('An address is needed')
        // a bare host or path gets https
        const target = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^(javascript|data|file|about|blob):/i.test(raw) ? raw : `https://${raw}`
        const same = findBookmark(taken, target)
        if (same) throw new Error(`Already a favorite: ${same.title}. A favorite is one address; change it to make a copy.`)
        list = await api.bookmarksAdd(name.trim() || title || target.replace(/^https?:\/\//, ''), target, favicon)
        const added = findBookmark(list, target)
        if (added && group.trim()) await api.bookmarksGroup(added.id, group.trim())
      }
      onClose()
    } catch (e) {
      setError(clean(e as Error))
    }
  }
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {/* a div, not a form: the dialog sits inside the address bar's form, whose submit would navigate */}
      <div
        className="modal favorite-dialog"
        role="dialog"
        aria-label={existing ? 'Edit favorite' : 'Add favorite'}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          else if (e.key === 'Enter') (e.preventDefault(), void save())
        }}
      >
        <h3>{heading ?? (existing ? 'Edit favorite' : 'Add to favorites')}</h3>
        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
        </label>
        <label className="field">
          <span>Address</span>
          <input value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <label className="field">
          <span>Group (empty: none)</span>
          <input value={group} list="favorite-dialog-groups" placeholder="e.g. Work" onChange={(e) => setGroup(e.target.value)} />
          <datalist id="favorite-dialog-groups">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </label>
        {error && <p className="error" onClick={() => setError(undefined)}>{error}</p>}
        <div className="modal-actions">
          {existing && (
            <button type="button" className="danger" onClick={() => void api.bookmarksRemove(existing.id).then(onClose)}>
              Remove
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" onClick={() => void save()}>{existing ? 'Save' : 'Add'}</button>
        </div>
      </div>
    </div>
  )
}

/** The icon of a favorite, or its first letter. */
function Icon({ b }: { b: Bookmark }) {
  return b.favicon ? (
    <img className="fav-icon" src={b.favicon} alt="" width={16} height={16} onError={(e) => (e.currentTarget.style.display = 'none')} />
  ) : (
    <span className="fav-icon letter">{b.title.charAt(0).toUpperCase()}</span>
  )
}

interface Row {
  key: string
  title: string
  url: string
  bookmark?: Bookmark
  kind?: 'pr' | 'ticket' | 'page' | 'go' | 'history'
}

/**
 * Start page of a new tab: the favorites as a list under their groups (and, inside a WorkDesk, its Pull Requests and tickets),
 * with a search bar. Arrow keys move through the matches, Enter opens one; right-click renames, groups or removes a favorite.
 */
export function BookmarkStart({ onOpen }: { onOpen: (url: string) => void }) {
  const api = window.workdesk
  const list = useBookmarks()
  const links = useContext(DeskLinksContext)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string }>()
  const [editing, setEditing] = useState<{ id: string; field: 'title' | 'group' | 'url' }>()
  // why the last edit was refused (a bad or doubled address)
  const [problem, setProblem] = useState<string>()
  const startValue = (b: Bookmark, field: 'title' | 'group' | 'url'): string => (field === 'group' ? (b.group ?? '') : field === 'url' ? b.url : b.title)
  const cursorRow = useRef<HTMLLIElement>(null)
  // a favorite being dragged to another group, and the group it is over ('' is the ungrouped ones)
  const engines = useSearchEngines()
  // visited pages that fit what was typed, asked from the main process a moment after typing
  const [visited, setVisited] = useState<HistoryEntry[]>([])
  useEffect(() => {
    const q = query.trim()
    if (!q) return setVisited([])
    let live = true
    const timer = setTimeout(() => void api.historySearch(q, 6).then((h) => live && setVisited(h), () => live && setVisited([])), 120)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [api, query])
  const [dragId, setDragId] = useState<string>()
  // how the groups are laid out (order, closed ones), kept by the main process and the same in every pane
  const [gs, setGs] = useState<GroupSettings>(DEFAULT_GROUP_SETTINGS)
  useEffect(() => {
    void api.bookmarksGroupSettings().then(setGs)
    return api.onBookmarkGroupSettings(setGs)
  }, [api])
  const saveGs = (next: GroupSettings) => (setGs(next), void api.bookmarksGroupSettingsSet(next))
  // a group being dragged to another place, and where it would go
  const [dragGroup, setDragGroup] = useState<string>()
  const [groupOver, setGroupOver] = useState<{ group: string; after: boolean }>()
  // the group whose name is being typed
  const [renamingGroup, setRenamingGroup] = useState<string>()
  // a favorite being copied: the add dialog, filled in from it
  const [duplicating, setDuplicating] = useState<Bookmark>()
  // a favorite typed in by hand
  const [adding, setAdding] = useState(false)
  const [groupMenu, setGroupMenu] = useState<{ x: number; y: number; group: string }>()
  const [over, setOver] = useState<string>()
  const menuItem = menu && list.find((b) => b.id === menu.id)

  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const deskRows: Row[] = links
    .filter((l) => words.every((w) => `${l.title} ${l.url}`.toLowerCase().includes(w)))
    .map((l) => ({ key: l.url, title: l.title, url: l.url, kind: l.kind }))
  // searching: the sections follow the ranking (a category a word names comes first); otherwise your order of the groups
  const shownGroups0 = words.length > 0 ? sectionsInOrder(rankBookmarks(list, query)) : orderGroups(groupBookmarks(list), gs)
  const bookmarkSections = shownGroups0.map((g) => ({
    raw: g.group,
    group: g.group || 'Favorites',
    rows: g.items.map((b): Row => ({ key: b.id, title: b.title, url: b.url, bookmark: b }))
  }))
  // while dragging, the ungrouped favorites can always be dropped on
  if (dragId && !bookmarkSections.some((s) => s.raw === '')) bookmarkSections.push({ raw: '', group: 'Favorites', rows: [] })
  // what was typed can also be opened or searched: an address first when it is a full URL (pasted), else after the matches
  const typed = query.trim()
  const favoriteUrls = new Set(list.map((b) => b.url))
  const historyRows: Row[] = visited.filter((h) => !favoriteUrls.has(h.url)).map((h) => ({ key: `history-${h.url}`, title: h.title || h.url, url: h.url, kind: 'history' }))
  const anyMatch = deskRows.length > 0 || historyRows.length > 0 || bookmarkSections.some((x) => x.rows.length > 0)
  // an address: open it. Words: search them, with the default engine; when no favorite matches, with every engine, the default first
  const goRows: Row[] = !typed
    ? []
    : isAddress(typed)
      ? [{ key: '\u0000go', title: `Open ${typed}`, url: normalizeUrl(typed), kind: 'go' }]
      : (anyMatch ? engines.slice(0, 1) : engines).map((e): Row => ({ key: `\u0000go-${e.id}`, title: `Search ${e.name} for “${typed}”`, url: normalizeUrl(typed, e.id), kind: 'go' }))
  const goFirst = goRows.length > 0 && /^https?:\/\//i.test(typed)
  const goSection = goRows.length > 0 ? [{ group: '', rows: goRows }] : []
  const sections: { raw?: string; group: string; rows: Row[] }[] = [
    ...(goFirst ? goSection : []),
    ...(deskRows.length > 0 ? [{ group: 'This WorkDesk', rows: deskRows }] : []),
    ...bookmarkSections,
    ...(historyRows.length > 0 ? [{ group: 'History', rows: historyRows }] : []),
    ...(goFirst ? [] : goSection)
  ]
  // a search opens every group, so what matches is found in a closed one too
  const closed = (s: { raw?: string }): boolean => s.raw !== undefined && words.length === 0 && isCollapsed(gs, s.raw)
  const flat = sections.flatMap((s) => (closed(s) ? [] : s.rows))
  const shownGroups = bookmarkSections.map((s) => s.raw)
  const allClosed = bookmarkSections.length > 0 && bookmarkSections.every((s) => isCollapsed(gs, s.raw))
  const at = Math.min(cursor, Math.max(flat.length - 1, 0))
  useEffect(() => {
    cursorRow.current?.scrollIntoView({ block: 'nearest' })
  }, [at, query])
  const groups = [...new Set(list.flatMap((b) => (b.group ? [b.group] : [])))]

  if (list.length === 0 && links.length === 0) {
    return (
      <>
        <p className="empty">No bookmarks yet. Add one here, press ☆ in the address bar of a page, or import them from Vivaldi or Firefox in Settings → Browser → Favorites.</p>
        <button className="primary" onClick={() => setAdding(true)}>+ Add a favorite</button>
        {adding && <FavoriteDialog url="" title="" heading="Add favorite" taken={list} groups={groups} onClose={() => setAdding(false)} />}
      </>
    )
  }
  return (
    <div className="fav-start">
      <div className="fav-layout">
      <div className="fav-main">
      <div className="fav-top">
        <input
          autoFocus
          className="fav-search"
          type="search"
          placeholder="Search favorites…"
          value={query}
          onChange={(e) => (setQuery(e.target.value), setCursor(0))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor(Math.max(0, Math.min(flat.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1))))
            } else if (e.key === 'Enter' && flat[at]) onOpen(flat[at].url)
            else if (e.key === 'Escape' && query) setQuery('')
          }}
        />
        <button type="button" className="mini" title="Add a favorite by name, address and group" onClick={() => setAdding(true)}>+ Add</button>
      </div>
      {bookmarkSections.length > 0 && !typed && (
        <div className="fav-head">
          <span className="hint">{list.length} favorite{list.length === 1 ? '' : 's'} in {bookmarkSections.length} group{bookmarkSections.length === 1 ? '' : 's'}</span>
          <button
            type="button"
            className="link"
            title={allClosed ? 'Open every group; groups that come later start open' : 'Close every group; groups that come later start closed'}
            onClick={() => saveGs(collapseAll(gs, !allClosed))}
          >
            {allClosed ? 'Expand all' : 'Collapse all'}
          </button>
        </div>
      )}
      {problem && <p className="error" onClick={() => setProblem(undefined)}>{problem}</p>}
      {sections.map((s) => (
        <section
          key={s.group}
          className={
            dragGroup !== undefined && s.raw !== undefined
              ? 'fav-group-slot' + (groupOver?.group === s.raw && dragGroup !== s.raw ? (groupOver.after ? ' after' : ' before') : '')
              : dragId && s.raw !== undefined
                ? 'fav-drop' + (over === s.raw ? ' over' : '')
                : undefined
          }
          onDragOver={(e) => {
            if (s.raw === undefined) return
            if (dragGroup !== undefined) {
              e.preventDefault()
              const r = e.currentTarget.getBoundingClientRect()
              setGroupOver({ group: s.raw, after: e.clientY > r.top + r.height / 2 })
              return
            }
            if (!dragId) return
            e.preventDefault()
            setOver(s.raw)
          }}
          onDrop={(e) => {
            if (s.raw === undefined) return
            if (dragGroup !== undefined) {
              e.preventDefault()
              saveGs(moveGroup(gs, shownGroups, dragGroup, s.raw, !!groupOver?.after))
              setDragGroup(undefined)
              setGroupOver(undefined)
              return
            }
            if (!dragId) return
            e.preventDefault()
            void api.bookmarksGroup(dragId, s.raw)
            setDragId(undefined)
            setOver(undefined)
          }}
        >
          {s.group && (
            <h4
              className="fav-group"
              draggable={s.raw !== undefined && renamingGroup !== s.raw}
              title={s.raw !== undefined ? 'Click to open or close; drag to put the group elsewhere; right-click to rename or move' : undefined}
              onClick={() => s.raw !== undefined && words.length === 0 && saveGs(toggleGroup(gs, s.raw))}
              onDragStart={(e) => {
                if (s.raw === undefined) return
                e.dataTransfer.setData('text/plain', s.group)
                e.dataTransfer.effectAllowed = 'move'
                setDragGroup(s.raw)
              }}
              onDragEnd={() => (setDragGroup(undefined), setGroupOver(undefined))}
              onContextMenu={(e) => s.raw !== undefined && (e.preventDefault(), setGroupMenu({ x: e.clientX, y: e.clientY, group: s.raw }))}
            >
              {s.raw !== undefined && <span className="fav-chevron">{closed(s) ? '▸' : '▾'}</span>}
              {renamingGroup !== undefined && renamingGroup === s.raw ? (
                <input
                  autoFocus
                  className="fav-rename"
                  defaultValue={s.raw}
                  onFocus={(e) => e.target.select()}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') e.currentTarget.blur()
                    else if (e.key === 'Escape') (e.currentTarget.value = s.raw ?? ''), e.currentTarget.blur()
                  }}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    setRenamingGroup(undefined)
                    if (v && v !== s.raw) void api.bookmarksRenameGroup(s.raw!, v)
                  }}
                />
              ) : (
                s.group
              )}
              {closed(s) && <span className="count"> {s.rows.length}</span>}
            </h4>
          )}
          {!closed(s) && <ul className="work-items">
            {s.rows.map((r) => {
              const here = flat[at] === r
              const b = r.bookmark
              return (
                <li
                  key={r.key}
                  ref={here ? cursorRow : undefined}
                  className={'clickable' + (here ? ' selected' : '')}
                  title={r.url}
                  draggable={!!b && editing?.id !== b.id}
                  onDragStart={(e) => {
                    if (!b) return
                    e.dataTransfer.setData('text/plain', r.url)
                    e.dataTransfer.effectAllowed = 'move'
                    setDragId(b.id)
                  }}
                  onDragEnd={() => (setDragId(undefined), setOver(undefined))}
                  onClick={() => !(editing && editing.id === b?.id) && onOpen(r.url)}
                  onMouseMove={() => flat[at] !== r && setCursor(flat.indexOf(r))}
                  onContextMenu={(e) => b && (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, id: b.id }))}
                >
                  {b ? <Icon b={b} /> : <span className="fav-icon letter">{r.kind === 'pr' ? '⎇' : r.kind === 'page' ? '↗' : r.kind === 'history' ? '↺' : r.kind === 'go' ? (isAddress(typed) ? '↗' : '⌕') : '✎'}</span>}
                  {b && editing?.id === b.id ? (
                    <input
                      autoFocus
                      className="fav-rename"
                      list={editing.field === 'group' ? 'fav-groups' : undefined}
                      placeholder={editing.field === 'group' ? 'group (empty: none)' : editing.field === 'url' ? 'https://…' : undefined}
                      defaultValue={startValue(b, editing.field)}
                      onFocus={(e) => e.target.select()}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Enter') e.currentTarget.blur()
                        else if (e.key === 'Escape') (e.currentTarget.value = startValue(b, editing.field)), e.currentTarget.blur()
                      }}
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        setEditing(undefined)
                        if (editing.field === 'group') void api.bookmarksGroup(b.id, v)
                        else if (editing.field === 'url') {
                          if (v && v !== b.url) api.bookmarksSetUrl(b.id, v).then(() => setProblem(undefined), (err: Error) => setProblem(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
                        } else if (v && v !== b.title) void api.bookmarksRename(b.id, v)
                      }}
                    />
                  ) : (
                    <div className="work-item-text">
                      <span className="title">{r.title}</span>
                      <span className="hint">{r.url}</span>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>}
        </section>
      ))}
      {dragId && (
        <div
          className={'fav-drop fav-new-group' + (over === '\u0000new' ? ' over' : '')}
          onDragOver={(e) => (e.preventDefault(), setOver('\u0000new'))}
          onDrop={(e) => {
            e.preventDefault()
            setEditing({ id: dragId, field: 'group' })
            setDragId(undefined)
            setOver(undefined)
          }}
        >
          Drop here for a new group
        </div>
      )}
      </div>
      <aside className="fav-aside" aria-label="Highlighted favorite">
        {(() => {
          const r = flat[at]
          const b = r?.bookmark
          if (!r) return <p className="hint">Type to search, ↓ ↑ to move, Enter to open.</p>
          return (
            <>
              <div className="fav-aside-head">
                {b ? <Icon b={b} /> : <span className="fav-icon letter">{r.kind === 'pr' ? '⎇' : r.kind === 'page' || r.kind === 'go' ? '↗' : '✎'}</span>}
                <h3>{r.title}</h3>
              </div>
              <p className="fav-aside-url">{r.url}</p>
              {b?.group && <p className="hint">Group: {b.group}</p>}
              <div className="fav-aside-actions">
                <button className="primary" onClick={() => onOpen(r.url)}>Open</button>
                <button onClick={() => void api.writeClipboard(r.url)}>Copy address</button>
              </div>
              {b && (
                <div className="fav-aside-actions">
                  <button onClick={() => setEditing({ id: b.id, field: 'title' })}>Rename</button>
                  <button onClick={() => setDuplicating(b)}>Duplicate</button>
                  <button onClick={() => (setProblem(undefined), setEditing({ id: b.id, field: 'url' }))}>Edit address</button>
                  <button onClick={() => setEditing({ id: b.id, field: 'group' })}>{b.group ? 'Change group' : 'Add to a group'}</button>
                  <button className="danger" onClick={() => void api.bookmarksRemove(b.id)}>Remove</button>
                </div>
              )}
              <p className="hint">Drag a favorite onto a group to move it. Right-click a group heading to rename or move it.</p>
            </>
          )
        })()}
      </aside>
      </div>
      {adding && <FavoriteDialog url="" title="" heading="Add favorite" taken={list} groups={groups} onClose={() => setAdding(false)} />}
      {duplicating && (
        <FavoriteDialog
          url={duplicating.url}
          title={`${duplicating.title} copy`}
          favicon={duplicating.favicon}
          initialGroup={duplicating.group}
          heading="Duplicate favorite"
          taken={list}
          groups={groups}
          onClose={() => setDuplicating(undefined)}
        />
      )}
      {groupMenu && (
        <ContextMenu
          x={groupMenu.x}
          y={groupMenu.y}
          onClose={() => setGroupMenu(undefined)}
          items={[
            { label: isCollapsed(gs, groupMenu.group) ? 'Open' : 'Close', onClick: () => saveGs(toggleGroup(gs, groupMenu.group)) },
            ...(groupMenu.group ? [{ label: 'Rename…', onClick: () => setRenamingGroup(groupMenu.group) }] : []),
            { label: 'Move up', disabled: shownGroups.indexOf(groupMenu.group) <= 0, onClick: () => saveGs(moveGroup(gs, shownGroups, groupMenu.group, shownGroups[shownGroups.indexOf(groupMenu.group) - 1])) },
            { label: 'Move down', disabled: shownGroups.indexOf(groupMenu.group) >= shownGroups.length - 1, onClick: () => saveGs(moveGroup(gs, shownGroups, groupMenu.group, shownGroups[shownGroups.indexOf(groupMenu.group) + 1], true)) }
          ]}
        />
      )}
      <datalist id="fav-groups">
        {groups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      {menu && menuItem && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(undefined)}
          items={[
            { label: 'Rename…', onClick: () => setEditing({ id: menuItem.id, field: 'title' }) },
            { label: 'Duplicate…', onClick: () => setDuplicating(menuItem) },
            { label: 'Edit address…', onClick: () => (setProblem(undefined), setEditing({ id: menuItem.id, field: 'url' })) },
            { label: menuItem.group ? `Group (${menuItem.group})…` : 'Add to a group…', onClick: () => setEditing({ id: menuItem.id, field: 'group' }) },
            { label: 'Remove', onClick: () => void api.bookmarksRemove(menuItem.id) }
          ]}
        />
      )}
    </div>
  )
}
