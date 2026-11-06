import { useEffect, useState } from 'react'
import type { HistoryEntry } from '../main/domain/history'
import { rankBookmarks } from '../main/domain/bookmarks'
import { isAddress, normalizeUrl } from '../main/domain/url'
import { useBookmarks } from './Bookmarks'
import { useSearchEngines } from './search-engine'

export type PaneKind = 'terminal' | 'browser' | 'file'

const KINDS: { kind: PaneKind; label: string; hint: string; words: string }[] = [
  { kind: 'terminal', label: 'Terminal', hint: 'a shell in this WorkDesk', words: 'shell command line tmux' },
  { kind: 'browser', label: 'Browser', hint: 'a web page, starting on your favorites', words: 'web page url favorites' },
  { kind: 'file', label: 'File', hint: 'one file or a scratch file, with a file tree and search', words: 'editor code text scratch note' }
]

interface Row {
  key: string
  title: string
  hint: string
  /** what kind of thing it is, shown at the right */
  badge: string
  kind: PaneKind
  /** the page a Browser opens on */
  url?: string
  /** a row that is not a kind: it opens the file finder */
  finder?: 'find' | 'search'
}

/**
 * One list with a filter, for what to open:
 * - `new` (after Command+Shift+arrow or Command+T): choose what the new Pane or Tab shows: the kinds (Terminal, Browser, File), your
 *   favorites and visited pages (a Browser on that page), an address you typed, and, when nothing fits, a search with each search engine.
 * - `go` (typing in the address bar): the same without the kinds: where this page should go. Command+Enter opens it in a new tab.
 * Arrow keys and Enter; Escape cancels.
 */
export function SplitPicker({ title = 'New Pane', mode = 'new', initial = '', onPick, onFinder, onCancel }: { title?: string; mode?: 'new' | 'go'; initial?: string; onPick: (kind: PaneKind, url?: string, newTab?: boolean) => void; /** the picker offers to find a file or search in files, and hands over to this */ onFinder?: (mode: 'find' | 'search') => void; onCancel: () => void }) {
  const favorites = useBookmarks()
  const engines = useSearchEngines()
  const [query, setQuery] = useState(initial)
  const [at, setAt] = useState(0)
  const [visited, setVisited] = useState<HistoryEntry[]>([])
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const typed = query.trim()

  // visited pages that fit, asked from the main process a moment after typing
  useEffect(() => {
    if (!typed) return setVisited([])
    let live = true
    const timer = setTimeout(() => void window.workdesk.historySearch(typed, 6).then((h) => live && setVisited(h), () => live && setVisited([])), 120)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [typed])

  const kinds: Row[] = mode === 'go' ? [] : KINDS.filter((k) => words.every((w) => `${k.label} ${k.hint} ${k.words}`.toLowerCase().includes(w))).map((k) => ({ key: k.kind, title: k.label, hint: k.hint, badge: 'new', kind: k.kind }))
  const finders: Row[] = !onFinder || mode === 'go'
    ? []
    : ([
        { key: 'find', title: 'Find a file…', hint: 'by name, then open it in a File pane', badge: 'file', kind: 'file' as const, finder: 'find' as const, words: 'fuzzy open quick' },
        { key: 'search', title: 'Search in files…', hint: 'text in the files, then open the hit in a File pane', badge: 'file', kind: 'file' as const, finder: 'search' as const, words: 'grep text content' }
      ] as (Row & { words: string })[]).filter((f) => words.every((w) => `${f.title} ${f.hint} ${f.words}`.toLowerCase().includes(w)))
  const favs: Row[] = (typed ? rankBookmarks(favorites, query) : favorites).slice(0, 8).map((b) => ({ key: `fav-${b.id}`, title: b.title, hint: b.url, badge: b.group ?? 'favorite', kind: 'browser', url: b.url }))
  const known = new Set(favs.map((f) => f.url))
  const past: Row[] = visited.filter((h) => !known.has(h.url)).map((h) => ({ key: `history-${h.url}`, title: h.title || h.url, hint: h.url, badge: 'history', kind: 'browser', url: h.url }))
  const found = kinds.length + favs.length + past.length > 0
  const go: Row[] = !typed
    ? []
    : isAddress(typed)
      ? [{ key: 'go', title: `Open ${typed}`, hint: normalizeUrl(typed), badge: 'address', kind: 'browser', url: normalizeUrl(typed) }]
      : (found ? engines.slice(0, 1) : engines).map((e) => ({ key: `search-${e.id}`, title: `Search ${e.name} for “${typed}”`, hint: normalizeUrl(typed, e.id), badge: 'search', kind: 'browser' as const, url: normalizeUrl(typed, e.id) }))
  // a pasted URL goes first (and, where you go to a page, any address); otherwise what matches, then the way out
  const addressFirst = /^https?:\/\//i.test(typed) || (mode === 'go' && isAddress(typed))
  const rows = addressFirst ? [...go, ...kinds, ...finders, ...favs, ...past] : [...kinds, ...finders, ...favs, ...past, ...go]
  const cursor = Math.min(at, Math.max(rows.length - 1, 0))
  const pick = (r?: Row, newTab = false) => r && (r.finder ? onFinder?.(r.finder) : onPick(r.kind, r.url, newTab))

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal palette split-picker" role="dialog" aria-label={title}>
        <input
          autoFocus
          className="palette-input"
          placeholder={mode === 'go' ? 'Go to a favorite, a page you visited, an address, or search' : `${title}: a kind, a favorite, a page you visited, an address or a search`}
          value={query}
          onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
          onChange={(e) => (setQuery(e.target.value), setAt(0))}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
            else if (e.key === 'Enter') pick(rows[cursor], e.metaKey)
            else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) setAt(Math.min(rows.length - 1, cursor + 1))
            else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) setAt(Math.max(0, cursor - 1))
            else return
            e.preventDefault()
            e.stopPropagation()
          }}
        />
        <ul className="palette-list" role="listbox">
          {rows.map((r, i) => (
            <li key={r.key} ref={(el) => { if (el && i === cursor) el.scrollIntoView({ block: 'nearest' }) }} role="option" aria-selected={i === cursor} className={i === cursor ? 'selected' : ''} onMouseMove={() => i !== cursor && setAt(i)} onClick={(e) => pick(r, e.metaKey)}>
              <span className="palette-title">{r.title}</span>
              <span className="palette-hint">{r.hint}</span>
              <span className="palette-group">{r.badge}</span>
            </li>
          ))}
          {rows.length === 0 && <li className="empty">Nothing to open.</li>}
        </ul>
        {mode === 'go' && <p className="hint">Enter goes here, ⌘Enter opens a new tab.</p>}
      </div>
    </div>
  )
}
