import { useEffect, useState } from 'react'
import { collapseAll, DEFAULT_GROUP_SETTINGS, type GroupSettings } from '../main/domain/bookmark-groups'
import { ImportFavorites } from './ImportFavorites'
import { SearchEngineList } from './SearchEnginePicker'
import { BookmarkStart, useBookmarks } from './Bookmarks'
import { useOpenLink } from './OpenLink'

/** Settings → Browser → Search engines. */
export function SearchEnginesPanel() {
  return (
    <section>
      <h2>Search engines</h2>
      <p className="hint">Where words go that are typed in an address bar or in the favorites search and are no address. The first is the default; the favorites search offers every engine, in this order, when no favorite matches. Drag to sort, or use the arrows. Kept on this machine.</p>
      <SearchEngineList />
    </section>
  )
}

/** Settings → Browser → Favorites: the favorites themselves (the same list as on a new tab), groups that start closed, and taking favorites over from another browser. */
export function FavoritesSettings() {
  const api = window.workdesk
  const list = useBookmarks()
  const openLink = useOpenLink()
  const [importing, setImporting] = useState(false)
  const [gs, setGs] = useState<GroupSettings>(DEFAULT_GROUP_SETTINGS)
  useEffect(() => {
    void api.bookmarksGroupSettings().then(setGs)
    return api.onBookmarkGroupSettings(setGs)
  }, [api])
  return (
    <div className="fav-manager">
      <section>
        <h2>Favorites</h2>
        <p className="hint">
          Search, add, rename, group (drag a favorite onto a group), edit the address, duplicate and remove favorites here, as on a new tab; a click opens one in the Browser. You have {list.length} favorite{list.length === 1 ? '' : 's'}.
        </p>
        <div className="fav-tools">
          <button onClick={() => setImporting(true)} title="Take favorites over from Vivaldi or Firefox: pick the profile, then tick the folders and pages. A folder becomes a group; pages you have already are skipped.">
            Import from Vivaldi or Firefox…
          </button>
          <label className="check" title="Closes every group now, and groups you add later start closed too. A search still finds favorites in closed groups.">
            <input
              type="checkbox"
              checked={gs.collapseByDefault}
              onChange={(e) => {
                const next = collapseAll(gs, e.target.checked)
                setGs(next)
                void api.bookmarksGroupSettingsSet(next)
              }}
            />{' '}
            Groups start closed
          </label>
        </div>
        {importing && <ImportFavorites onClose={() => setImporting(false)} />}
      </section>
      <BookmarkStart onOpen={openLink} />
    </div>
  )
}
