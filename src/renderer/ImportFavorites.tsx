import { useEffect, useMemo, useState } from 'react'
import type { ImportSource } from '../main/bookmark-import'
import { countPages, importItems, type ImportNode } from '../main/domain/bookmark-import'

/** Ids of the pages in the tree: the path of positions that leads to them. */
function pageIds(nodes: readonly ImportNode[], prefix = ''): string[] {
  return nodes.flatMap((n, i) => (n.type === 'url' ? [`${prefix}${i}`] : pageIds(n.children, `${prefix}${i}.`)))
}

/** The pages of the tree that are ticked, in the shape the main process imports. */
function pick(nodes: readonly ImportNode[], ticked: ReadonlySet<string>): ImportNode[] {
  const walk = (list: readonly ImportNode[], prefix: string): ImportNode[] =>
    list.flatMap((n, i): ImportNode[] => {
      if (n.type === 'url') return ticked.has(`${prefix}${i}`) ? [n] : []
      const children = walk(n.children, `${prefix}${i}.`)
      return children.length > 0 ? [{ ...n, children }] : []
    })
  return walk(nodes, '')
}

function Branch({ nodes, prefix, ticked, open, onTick, onOpen }: { nodes: readonly ImportNode[]; prefix: string; ticked: ReadonlySet<string>; open: ReadonlySet<string>; onTick: (ids: string[], on: boolean) => void; onOpen: (id: string) => void }) {
  return (
    <ul className="import-tree">
      {nodes.map((n, i) => {
        const id = `${prefix}${i}`
        if (n.type === 'url') {
          return (
            <li key={id} title={n.url}>
              <label>
                <input type="checkbox" checked={ticked.has(id)} onChange={(e) => onTick([id], e.target.checked)} />
                <span className="title">{n.name}</span>
                <span className="hint">{n.url}</span>
              </label>
            </li>
          )
        }
        const ids = pageIds(n.children, `${id}.`)
        const on = ids.filter((x) => ticked.has(x)).length
        return (
          <li key={id}>
            <div className="import-folder">
              <button type="button" className="import-chevron" title={open.has(id) ? 'Collapse' : 'Expand'} onClick={() => onOpen(id)}>{open.has(id) ? '▾' : '▸'}</button>
              <label>
                <input
                  type="checkbox"
                  checked={on === ids.length}
                  ref={(el) => {
                    if (el) el.indeterminate = on > 0 && on < ids.length
                  }}
                  onChange={(e) => onTick(ids, e.target.checked)}
                />
                <span className="title">📁 {n.name}</span>
                <span className="hint">{on} / {ids.length}</span>
              </label>
            </div>
            {open.has(id) && <Branch nodes={n.children} prefix={`${id}.`} ticked={ticked} open={open} onTick={onTick} onOpen={onOpen} />}
          </li>
        )
      })}
    </ul>
  )
}

/** Take favorites over from Vivaldi or Firefox: pick the browser profile, then tick the folders and pages to import. */
export function ImportFavorites({ onClose }: { onClose: () => void }) {
  const api = window.workdesk
  const [sources, setSources] = useState<ImportSource[]>()
  const [source, setSource] = useState<string>()
  const [tree, setTree] = useState<ImportNode[]>()
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<{ added: number; skipped: number }>()

  useEffect(() => {
    void api.bookmarksImportSources().then((s) => (setSources(s), s.length === 1 && setSource(s[0].id)), (e: Error) => setError(e.message))
  }, [api])
  useEffect(() => {
    if (!source) return
    setTree(undefined)
    setError(undefined)
    void api.bookmarksImportRead(source).then(
      (t) => {
        setTree(t)
        // everything ticked to start with; the top-level folders open
        setTicked(new Set(pageIds(t)))
        setOpen(new Set(t.map((n, i) => (n.type === 'folder' ? String(i) : ''))))
      },
      (e: Error) => setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    )
  }, [api, source])

  const total = useMemo(() => (tree ? countPages(tree) : 0), [tree])
  const chosen = tree ? importItems(pick(tree, ticked)) : []
  const tick = (ids: string[], on: boolean) => setTicked((t) => new Set(on ? [...t, ...ids] : [...t].filter((x) => !ids.includes(x))))
  const toggleOpen = (id: string) => setOpen((o) => new Set(o.has(id) ? [...o].filter((x) => x !== id) : [...o, id]))

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide import-favorites" role="dialog" aria-label="Import favorites" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3>Import favorites</h3>
        {result ? (
          <>
            <p>
              Imported {result.added} favorite{result.added === 1 ? '' : 's'}
              {result.skipped > 0 && `; ${result.skipped} ${result.skipped === 1 ? 'was' : 'were'} favorites already`}. Folders became groups.
            </p>
            <div className="modal-actions"><button className="primary" autoFocus onClick={onClose}>Done</button></div>
          </>
        ) : (
          <>
            {sources && sources.length === 0 && <p className="hint">No Vivaldi or Firefox profile with bookmarks was found on this Mac.</p>}
            {sources && sources.length > 1 && (
              <div className="import-sources">
                {sources.map((s) => (
                  <label key={s.id}>
                    <input type="radio" name="import-source" checked={source === s.id} onChange={() => setSource(s.id)} />
                    {s.label}
                  </label>
                ))}
              </div>
            )}
            {sources && sources.length === 1 && <p className="hint">{sources[0].label}</p>}
            {error && <p className="error">{error}</p>}
            {source && !tree && !error && <p className="hint">Reading…</p>}
            {tree && (
              <>
                <div className="import-bar">
                  <span className="hint">{chosen.length} of {total} pages ticked. Pages you have as favorites already are skipped; a folder becomes a group.</span>
                  <button type="button" className="mini" onClick={() => setTicked(new Set(pageIds(tree)))}>All</button>
                  <button type="button" className="mini" onClick={() => setTicked(new Set())}>None</button>
                </div>
                <div className="import-scroll">
                  <Branch nodes={tree} prefix="" ticked={ticked} open={open} onTick={tick} onOpen={toggleOpen} />
                </div>
              </>
            )}
            <div className="modal-actions">
              <button onClick={onClose}>Cancel</button>
              <button
                className="primary"
                disabled={chosen.length === 0}
                onClick={() => void api.bookmarksImport(chosen).then(setResult, (e: Error) => setError(e.message))}
              >
                Import {chosen.length > 0 ? chosen.length : ''}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
