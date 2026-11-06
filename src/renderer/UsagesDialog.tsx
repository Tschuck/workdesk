import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { FileRoot, RenameResult } from '../main/files'
import { isIdentifier } from '../main/domain/symbols'
import { FileIcon } from './FileIcon'
import { notifyGitChanged } from './git-state'
import { ScopeSwitch } from './ScopeSwitch'
import { branchRoots, scopedRoots, useScope } from './scope'
import { definitionsOf, editsFor, groupRows, initialTicks, rowKey, toRows, type UsageRow } from './usages'
import { announceWritten, dirtyAmong, type UsagesMode } from './usages-events'
import './usages.css'

const cleanError = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** The line of a match with the match marked (the line is shown without its indentation). */
function Marked({ row }: { row: UsageRow }) {
  const { text, column, length } = row.match
  const lead = text.length - text.trimStart().length
  const at = column - lead
  if (at < 0 || column + length > text.length) return <>{text.trim()}</>
  const t = text.trim()
  return (
    <>
      {t.slice(0, at)}
      <mark>{t.slice(at, at + length)}</mark>
      {t.slice(at + length)}
    </>
  )
}

/**
 * Find usages and Rename symbol, text based: every whole-word match of a name (case matters) in the files of the branch scope, with no
 * idea what the name means. Usages lists them like the search (definitions first); Rename shows them with a checkbox each and writes only
 * the ticked ones.
 */
export function UsagesDialog({ deskId, mode, word: start, onOpen, onClose }: { deskId: string; mode: UsagesMode; word: string; onOpen: (path: string, line?: number) => void; onClose: () => void }) {
  const api = window.workdesk
  const [word, setWord] = useState(start)
  const [newName, setNewName] = useState(start)
  const [glob, setGlob] = useState('')
  const [skip, setSkip] = useState(true)
  const [allRoots, setAllRoots] = useState<FileRoot[]>([])
  const scope = useScope(deskId)
  // a rename only touches the folders of the branches of the scope, never notes or scratch files
  const roots = useMemo(() => (mode === 'rename' ? branchRoots(scopedRoots(allRoots, scope)) : scopedRoots(allRoots, scope)), [allRoots, scope, mode])
  const [rows, setRows] = useState<UsageRow[]>([])
  const [truncated, setTruncated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [at, setAt] = useState(0)
  const [applying, setApplying] = useState(false)
  const [report, setReport] = useState<{ result: RenameResult; unsaved: string[] }>()
  const [unsaved, setUnsaved] = useState<Set<string>>(new Set())
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => void api.filesRoots(deskId).then(setAllRoots, () => setAllRoots([])), [api, deskId])
  useEffect(() => {
    input.current?.select()
  }, [])

  // the search, a moment after typing
  const [loadedFor, setLoadedFor] = useState<string>()
  useEffect(() => {
    if (allRoots.length === 0) return
    if (!isIdentifier(word)) {
      setRows([])
      setError(word.trim() ? 'That is not a name (letters, digits, _ and $; not starting with a digit).' : undefined)
      setLoadedFor(undefined)
      return
    }
    let live = true
    const timer = setTimeout(() => {
      setBusy(true)
      void Promise.all(roots.map((r) => api.filesUsages(deskId, r.path, word, glob.trim()).then((u) => ({ r, u }))))
        .then((all) => {
          if (!live) return
          const found = toRows(word, all.flatMap(({ r, u }) => u.files.map((f) => ({ rootPath: r.path, rootLabel: r.label, path: f.path, matches: f.matches }))))
          setRows(found)
          setTruncated(all.some(({ u }) => u.truncated))
          setTicked(initialTicks(found, skip))
          setUnsaved(dirtyAmong(found.map((x) => x.abs)))
          setError(undefined)
          setAt(0)
          setLoadedFor(word)
        })
        .catch((e) => live && (setError(cleanError(e)), setRows([])))
        .finally(() => live && setBusy(false))
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // the ticks follow `skip` below, without a new search
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, deskId, word, glob, roots, allRoots.length])

  const definitions = useMemo(() => (mode === 'usages' ? definitionsOf(word, rows) : []), [mode, word, rows])
  const rest = useMemo(() => {
    const defs = new Set(definitions)
    return rows.filter((r) => !defs.has(r))
  }, [rows, definitions])
  const groups = useMemo(() => groupRows(rest), [rest])
  const files = useMemo(() => new Set(rows.map((r) => r.abs)).size, [rows])
  // the order the keyboard walks in (usages)
  const order = useMemo(() => [...definitions, ...groups.flatMap((g) => g.rows)], [definitions, groups])
  const cursor = Math.min(at, Math.max(order.length - 1, 0))

  const nameOk = isIdentifier(newName) && newName !== word
  const toWrite = rows.filter((r) => ticked.has(rowKey(r)) && !unsaved.has(r.abs))
  const toggleSkip = (on: boolean) => {
    setSkip(on)
    setTicked((cur) => {
      const next = new Set(cur)
      for (const r of rows) if (r.match.nonCode) (on ? next.delete(rowKey(r)) : next.add(rowKey(r)))
      return next
    })
  }
  const toggle = (rs: UsageRow[], on: boolean) =>
    setTicked((cur) => {
      const next = new Set(cur)
      for (const r of rs) (on ? next.add(rowKey(r)) : next.delete(rowKey(r)))
      return next
    })

  const apply = async () => {
    if (!nameOk || applying || toWrite.length === 0) return
    setApplying(true)
    setError(undefined)
    try {
      // the panes are asked once more: something may have been typed since the search
      const dirtyNow = dirtyAmong(rows.map((r) => r.abs))
      const edits = editsFor(rows, ticked, dirtyNow)
      const result = await api.filesRenameSymbol(deskId, { roots: roots.map((r) => r.path), from: word, to: newName, files: edits })
      announceWritten(result.files.filter((f) => f.applied > 0).map((f) => f.path))
      notifyGitChanged()
      setReport({ result, unsaved: [...dirtyNow].filter((p) => rows.some((r) => r.abs === p && ticked.has(rowKey(r)))) })
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setApplying(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (mode === 'usages' && e.key === 'Enter') order[cursor] && onOpen(order[cursor].abs, order[cursor].match.line)
    else if (mode === 'usages' && (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n'))) setAt(Math.min(order.length - 1, cursor + 1))
    else if (mode === 'usages' && (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p'))) setAt(Math.max(0, cursor - 1))
    else if (mode === 'rename' && e.key === 'Enter' && e.currentTarget === input.current) void apply()
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const where = (r: UsageRow) => `${r.file.split('/').pop()}:${r.match.line}`
  const rowFor = (r: UsageRow, i: number, withFile: boolean) => (
    <li
      key={rowKey(r)}
      ref={(el) => {
        if (el && i === cursor) el.scrollIntoView({ block: 'nearest' })
      }}
      role="option"
      aria-selected={i === cursor}
      className={i === cursor ? 'selected' : ''}
      onMouseMove={() => i !== cursor && setAt(i)}
      onClick={() => onOpen(r.abs, r.match.line)}
    >
      {withFile ? <span className="usage-where">{where(r)}</span> : <span className="finder-line usage-line">{r.match.line}</span>}
      <span className="palette-hint finder-text">
        <Marked row={r} />
      </span>
      {withFile && <span className="palette-group">{r.rootLabel}</span>}
      {r.match.nonCode && <span className="usage-tag" title="In a comment or a string, as far as the guess goes">comment/string</span>}
    </li>
  )

  const title = mode === 'rename' ? 'Rename symbol' : 'Find usages'
  const summary = busy ? 'Searching…' : loadedFor !== word ? '' : rows.length === 0 ? 'No match.' : `${rows.length} match${rows.length === 1 ? '' : 'es'} in ${files} file${files === 1 ? '' : 's'}${mode === 'usages' && definitions.length ? `, ${definitions.length} definition${definitions.length === 1 ? '' : 's'}` : ''}${truncated ? ' (the search stopped at its limit: there are more)' : ''}`

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal palette usages-dialog' + (mode === 'rename' ? ' rename' : '')} role="dialog" aria-label={title}>
        {report ? (
          <RenameReport result={report.result} unsaved={report.unsaved} from={word} to={newName} onClose={onClose} />
        ) : (
          <>
            <h3>{title}</h3>
            <div className="usages-fields">
              {mode === 'usages' ? (
                <input ref={input} autoFocus className="palette-input" placeholder="A name…" value={word} onChange={(e) => setWord(e.target.value.trim())} onKeyDown={onKeyDown} />
              ) : (
                <>
                  <label className="usages-field">
                    <span>Rename</span>
                    <code>{word}</code>
                    <span>to</span>
                    <input ref={input} autoFocus className="palette-input" aria-invalid={!!newName && !nameOk} placeholder="New name…" value={newName} onChange={(e) => setNewName(e.target.value.trim())} onKeyDown={onKeyDown} />
                  </label>
                  {newName && !isIdentifier(newName) && <p className="error usage-note">The new name has to be a name: letters, digits, _ and $, not starting with a digit.</p>}
                  {newName === word && <p className="hint usage-note">Type another name.</p>}
                </>
              )}
              <input className="palette-input finder-glob" placeholder="Only in files, e.g. *.ts, src/**/*.tsx, !dist/**" title="Globs separated by commas; ! leaves files out." value={glob} onChange={(e) => setGlob(e.target.value)} onKeyDown={onKeyDown} />
            </div>
            <ScopeSwitch deskId={deskId} roots={allRoots} />
            {mode === 'rename' && (
              <label className="usages-skip" title="A guess: // and # and -- comments, block comments and quotes are read the same way for every language. Check the list.">
                <input type="checkbox" checked={skip} onChange={(e) => toggleSkip(e.target.checked)} />
                <span>Skip matches inside strings and comments (best effort, not a parser: look through the list before you apply)</span>
              </label>
            )}
            {error && <p className="error usage-note" onClick={() => setError(undefined)}>{error}</p>}
            <p className="hint usage-note usage-summary">{summary}</p>
            {mode === 'usages' ? (
              <ul className="palette-list usages-list" role="listbox">
                {definitions.length > 0 && <li className="usage-heading">Definitions</li>}
                {definitions.map((r, i) => rowFor(r, i, true))}
                {groups.length > 0 && definitions.length > 0 && <li className="usage-heading">Usages</li>}
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    <li className="finder-file">
                      <FileIcon name={g.file.split('/').pop() ?? g.file} />
                      <span className="file-label">{g.file.split('/').pop()}</span>
                      <span className="hint">{g.file.includes('/') ? g.file.slice(0, g.file.lastIndexOf('/')) : g.rootLabel}</span>
                      <span className="file-count">{g.rows.length}</span>
                    </li>
                    {g.rows.map((r) => rowFor(r, order.indexOf(r), false))}
                  </Fragment>
                ))}
                {order.length === 0 && <li className="empty">{!isIdentifier(word) ? 'Put the cursor on a name, or type one.' : busy ? 'Searching…' : 'Nothing found.'}</li>}
              </ul>
            ) : (
              <ul className="palette-list usages-list rename-list">
                {groups.map((g) => {
                  const on = g.rows.filter((r) => ticked.has(rowKey(r))).length
                  const isUnsaved = unsaved.has(g.abs)
                  return (
                    <Fragment key={g.key}>
                      <li className="finder-file rename-file">
                        <input
                          type="checkbox"
                          aria-label={`All matches in ${g.file}`}
                          disabled={isUnsaved}
                          checked={on === g.rows.length}
                          ref={(el) => {
                            if (el) el.indeterminate = on > 0 && on < g.rows.length
                          }}
                          onChange={(e) => toggle(g.rows, e.target.checked)}
                        />
                        <FileIcon name={g.file.split('/').pop() ?? g.file} />
                        <span className="file-label">{g.file.split('/').pop()}</span>
                        <span className="hint">{g.file.includes('/') ? g.file.slice(0, g.file.lastIndexOf('/')) : g.rootLabel}</span>
                        {isUnsaved && <span className="usage-tag usage-unsaved" title="Save or discard the changes in the pane that shows it, then search again">unsaved changes: skipped</span>}
                        <span className="file-count">{isUnsaved ? g.rows.length : `${on}/${g.rows.length}`}</span>
                      </li>
                      {g.rows.map((r) => (
                        <li key={rowKey(r)} className={'rename-row' + (isUnsaved ? ' off' : '')}>
                          <label>
                            <input type="checkbox" disabled={isUnsaved} checked={!isUnsaved && ticked.has(rowKey(r))} onChange={(e) => toggle([r], e.target.checked)} />
                            <span className="finder-line usage-line">{r.match.line}</span>
                            <span className="palette-hint finder-text">
                              <Marked row={r} />
                            </span>
                          </label>
                          {r.definition && <span className="usage-tag usage-def">definition</span>}
                          {r.match.nonCode && <span className="usage-tag" title="In a comment or a string, as far as the guess goes">comment/string</span>}
                        </li>
                      ))}
                    </Fragment>
                  )
                })}
                {rows.length === 0 && <li className="empty">{busy ? 'Searching…' : 'Nothing found.'}</li>}
              </ul>
            )}
            {mode === 'rename' ? (
              <div className="usages-actions">
                <span className="hint">
                  Text based: every whole-word match of <code>{word}</code> counts, whatever it means (another variable, a property of the same name). Only ticked matches are written, in the folders of the branch scope. Files with unsaved changes are skipped.
                </span>
                <button onClick={onClose}>Cancel</button>
                <button className="primary" disabled={!nameOk || toWrite.length === 0 || applying || busy} onClick={() => void apply()}>
                  {applying ? 'Renaming…' : `Rename ${toWrite.length} match${toWrite.length === 1 ? '' : 'es'}`}
                </button>
              </div>
            ) : (
              <p className="hint">Text based: whole-word matches, case matters, no idea what the name means. Enter opens the file at the line. Definitions (<code>class X</code>, <code>const X =</code> …) come first.</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** What a rename did: the counts, and the files that were left alone. */
function RenameReport({ result, unsaved, from, to, onClose }: { result: RenameResult; unsaved: string[]; from: string; to: string; onClose: () => void }) {
  const changed = result.files.filter((f) => f.applied > 0)
  const applied = changed.reduce((n, f) => n + f.applied, 0)
  const stale = result.files.reduce((n, f) => n + f.stale, 0)
  const failed = result.files.filter((f) => f.error)
  return (
    <div className="usages-report" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <h3>Renamed</h3>
      <p>
        <code>{from}</code> is <code>{to}</code> now at {applied} place{applied === 1 ? '' : 's'} in {changed.length} file{changed.length === 1 ? '' : 's'}. Open File panes show the new text.
      </p>
      {unsaved.length > 0 && (
        <div className="usage-skipped">
          <p>Skipped, because they have unsaved changes in a pane ({unsaved.length}):</p>
          <ul>{unsaved.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {stale > 0 && <p className="hint">{stale} place{stale === 1 ? '' : 's'} left alone: the file had changed since the search.</p>}
      {failed.length > 0 && (
        <div className="usage-skipped">
          <p>Not written:</p>
          <ul>{failed.map((f) => <li key={f.path}>{f.path}: {f.error}</li>)}</ul>
        </div>
      )}
      <p className="hint">Nothing is committed: the changes show up under Changes in the file side, and ⌘Z in a pane does not undo them (discard them there).</p>
      <div className="usages-actions">
        <button className="primary" autoFocus onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
