import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ScopeSwitch } from './ScopeSwitch'
import { scopedRoots, useScope } from './scope'
import type { FileRoot, SearchQuery } from '../main/files'
import { clipboardTerm, definitionPattern, definitionRank } from './definition'
import { filterFiles, splitLineRef } from './file-buffers'
import { FileIcon } from './FileIcon'
import { highlight } from './FilePane'

interface Row {
  key: string
  title: string
  hint: string
  badge: string
  path: string
  line?: number
  /** a text match: the file it is in, relative to its folder, to list the matches of a file together */
  file?: string
  text?: string
}

/** The matches of one file together (in the order the files first appear), so that the rows under a file heading are in a row. */
function groupByFile(rows: Row[]): Row[] {
  const order: string[] = []
  const by = new Map<string, Row[]>()
  for (const r of rows) {
    const k = `${r.badge}\0${r.file ?? r.path}`
    if (!by.has(k)) (order.push(k), by.set(k, []))
    by.get(k)!.push(r)
  }
  return order.flatMap((k) => by.get(k)!)
}

/**
 * A list with a filter over the files of a WorkDesk (or of the Files page): `find` takes a part of a file name (every word has to be in
 * the path), `search` looks for text in the files (git grep), `definition` looks for where a name is declared (`class X`, `const X =`, …),
 * starting from the name on the clipboard. Enter opens the file (at the line) where the caller wants it.
 */
export function FileFinder({ deskId, mode, onPick, onCancel }: { deskId: string; mode: 'find' | 'search' | 'definition'; onPick: (path: string, line?: number) => void; onCancel: () => void }) {
  const api = window.workdesk
  const [query, setQuery] = useState('')
  // the files to look in (search and definition): globs as in the Search tab of a File pane
  const [glob, setGlob] = useState('')
  const [at, setAt] = useState(0)
  const [allRoots, setRoots] = useState<FileRoot[]>([])
  // one branch of the WorkDesk, or all of them
  const scope = useScope(deskId)
  const roots = useMemo(() => scopedRoots(allRoots, scope), [allRoots, scope])
  const [lists, setLists] = useState<Record<string, string[]>>({})
  const [hits, setHits] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const input = useRef<HTMLInputElement>(null)
  /** a definition was asked for and there is none: the hits are the name as plain text */
  const [noDefinition, setNoDefinition] = useState(false)
  // declarations (`class X`) before values (`X=…`); equal ranks keep their order
  const byRank = <T extends { text: string }>(h: T[]): T[] => h.map((x, i) => ({ x, i, r: definitionRank(query.trim(), x.text) })).sort((a, b) => a.r - b.r || a.i - b.i).map((e) => e.x)
  const byRowRank = (rows: Row[]): Row[] => byRank(rows.map((r) => ({ ...r, text: r.hint }))).slice(0, 200)

  // a definition starts from the name that was copied last
  useEffect(() => {
    if (mode !== 'definition') return
    let live = true
    void api.readClipboard().then((t) => {
      const term = clipboardTerm(t)
      if (!live || !term) return
      setQuery((cur) => cur || term)
      setTimeout(() => input.current?.select(), 0)
    }, () => undefined)
    return () => {
      live = false
    }
  }, [api, mode])

  // the folders, and (for a find) their files, once
  useEffect(() => {
    let live = true
    void api.filesRoots(deskId).then(async (r) => {
      if (!live) return
      setRoots(r)
      if (mode !== 'find') return
      for (const root of r) void api.filesList(deskId, root.path).then((l) => live && setLists((cur) => ({ ...cur, [root.path]: l })), () => undefined)
    })
    return () => {
      live = false
    }
  }, [api, deskId, mode])

  // a search, a moment after typing
  useEffect(() => {
    if (mode === 'find' || !query.trim()) {
      setHits([])
      setNoDefinition(false)
      setError(undefined)
      return
    }
    let live = true
    const term = query.trim()
    /** the hits in every folder, one search */
    const searchAll = (q: SearchQuery, rank: boolean): Promise<Row[]> =>
      Promise.all(
        roots.map((r) =>
          api.filesSearch(deskId, r.path, q).then(
            (h) => (rank ? byRank(h) : h).slice(0, 60).map((x): Row => ({ key: `${r.path}${x.path}:${x.line}`, title: `${x.path.split('/').pop()}:${x.line}`, hint: x.text.trim(), badge: r.label, path: `${r.path}/${x.path}`, line: x.line, file: x.path, text: x.text.trim() })),
            () => [] as Row[]
          )
        )
      ).then((all) => (rank ? byRowRank(all.flat()) : all.flat().slice(0, 200)))
    const timer = setTimeout(() => {
      setBusy(true)
      void (async () => {
        if (mode !== 'definition') return searchAll({ text: term, regex: false, caseSensitive: false, glob: glob.trim() }, false).then((rows) => [rows, false] as const)
        const defs = await searchAll({ text: definitionPattern(query), regex: true, caseSensitive: true, glob: glob.trim() }, true)
        if (defs.length > 0 || !live) return [defs, false] as const
        // no definition: the name as plain text, like Search in files
        return [await searchAll({ text: term, regex: false, caseSensitive: false, glob: glob.trim() }, false), true] as const
      })().then(([rows, fallback]) => {
        if (!live) return
        setBusy(false)
        setHits(rows)
        setNoDefinition(fallback)
        setError(undefined)
      })
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [api, deskId, mode, query, glob, roots])

  // a file named with its line (`a.ts:82-100`): looked for by its path, opened at that line
  const fileRef = splitLineRef(query)
  // text matches are listed by file, like the search of a File pane; definitions stay in the order of their rank
  const grouped = mode === 'search' || noDefinition
  const found: Row[] =
    mode === 'find'
      ? roots.flatMap((r) => filterFiles(lists[r.path] ?? [], fileRef.query).map((f): Row => ({ key: r.path + f, title: `${f.split('/').pop() ?? f}${fileRef.line ? `:${fileRef.line}` : ''}`, hint: f, badge: r.label, path: `${r.path}/${f}`, line: fileRef.line }))).slice(0, 100)
      : grouped
        ? groupByFile(hits)
        : hits
  const cursor = Math.min(at, Math.max(found.length - 1, 0))
  const pick = (r?: Row) => r && onPick(r.path, r.line)
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel()
    else if (e.key === 'Enter') pick(found[cursor])
    else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) setAt(Math.min(found.length - 1, cursor + 1))
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) setAt(Math.max(0, cursor - 1))
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal palette" role="dialog" aria-label={mode === 'find' ? 'Find a file' : mode === 'definition' ? 'Go to definition' : 'Search in files'}>
        <input
          ref={input}
          autoFocus
          className="palette-input"
          placeholder={mode === 'find' ? 'Find a file by name…' : mode === 'definition' ? 'Go to the definition of…' : 'Search text in the files…'}
          value={query}
          onChange={(e) => (setQuery(e.target.value), setAt(0))}
          onKeyDown={onKeyDown}
        />
        {mode !== 'find' && (
          <input
            className="palette-input finder-glob"
            placeholder="Only in files, e.g. *.ts, src/**/*.tsx, !dist/**"
            title="Globs separated by commas; ! leaves files out. Tab moves here."
            value={glob}
            onChange={(e) => (setGlob(e.target.value), setAt(0))}
            onKeyDown={onKeyDown}
          />
        )}
        <ScopeSwitch deskId={deskId} roots={allRoots} />
        <ul className="palette-list" role="listbox">
          {noDefinition && found.length > 0 && <li className="empty">No definition found for “{query.trim()}”. Text matches:</li>}
          {found.map((r, i) => (
            <Fragment key={r.key}>
              {grouped && r.file && r.file !== found[i - 1]?.file && (
                <li className="finder-file">
                  <FileIcon name={r.file.split('/').pop() ?? r.file} />
                  <span className="file-label">{r.file.split('/').pop()}</span>
                  <span className="hint">{r.file.includes('/') ? r.file.slice(0, r.file.lastIndexOf('/')) : r.badge}</span>
                  <span className="file-count">{found.filter((x) => x.file === r.file && x.badge === r.badge).length}</span>
                </li>
              )}
            <li ref={(el) => { if (el && i === cursor) el.scrollIntoView({ block: 'nearest' }) }} role="option" aria-selected={i === cursor} className={i === cursor ? 'selected' : ''} onMouseMove={() => i !== cursor && setAt(i)} onClick={() => pick(r)}>
              {grouped && r.text !== undefined ? (
                <>
                  <span className="finder-line">{r.line}</span>
                  <span className="palette-hint finder-text">{highlight(r.text, query.trim(), false, false)}</span>
                </>
              ) : (
                <>
                  <span className="palette-title">{r.title}</span>
                  <span className="palette-hint">{r.hint}</span>
                  <span className="palette-group">{r.badge}</span>
                </>
              )}
            </li>
            </Fragment>
          ))}
          {found.length === 0 && <li className="empty">{!query.trim() ? (mode === 'find' ? 'Type a part of a file name.' : mode === 'definition' ? 'Type a class, interface, type, function or const name.' : 'Type the text to look for.') : busy ? 'Searching…' : error ?? (noDefinition ? `No definition found for “${query.trim()}”, nor any text match.` : 'Nothing found.')}</li>}
        </ul>
        <p className="hint">{mode === 'definition' ? 'Looks for `class X`, `interface X`, `type X`, `const X`, `function X`, `def X` … (case matters). ' : ''}Opens the file in a File pane. For regular expressions and globs use the Search tab of a File pane.</p>
      </div>
    </div>
  )
}
