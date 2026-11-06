import { useEffect, useRef, useState } from 'react'
import type { DeskFiles, WorkspaceHit } from '../main/domain/search-all'
import { filterFiles } from './file-buffers'
import './nav.css'

type Mode = 'files' | 'text' | 'terminals'
const MODES: { mode: Mode; label: string; hint: string }[] = [
  { mode: 'files', label: 'Files', hint: 'Part of a file name, in every WorkDesk' },
  { mode: 'text', label: 'Text', hint: 'Text in the files of every WorkDesk (grep)' },
  { mode: 'terminals', label: 'Terminals', hint: 'Output (and scrollback) of the terminals of every WorkDesk' }
]

interface Row {
  key: string
  title: string
  hint: string
  desk: string
  open: () => void
}

/**
 * Search over all started WorkDesks: file names, text in files (git grep) and the output of tmux panes. Enter opens the
 * hit in its WorkDesk (a file at the line, or the Tab of the terminal).
 */
export function SearchAll({ onClose, onOpenFile: openFile, onOpenTab: openTab }: { onClose: () => void; onOpenFile: (deskId: string, path: string, line?: number) => void; onOpenTab: (deskId: string, tabId: string) => void }) {
  const api = window.workdesk
  // the latest callbacks without searching again when the caller renders
  const latest = useRef({ openFile, openTab })
  latest.current = { openFile, openTab }
  const onOpenFile = (d: string, p: string, l?: number) => latest.current.openFile(d, p, l)
  const onOpenTab = (d: string, t: string) => latest.current.openTab(d, t)
  const [mode, setMode] = useState<Mode>('text')
  const [query, setQuery] = useState('')
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [at, setAt] = useState(0)
  const files = useRef<DeskFiles[] | undefined>(undefined)
  const row = useRef<HTMLLIElement>(null)

  useEffect(() => {
    const q = query.trim()
    if (!q) return setRows([])
    let live = true
    setBusy(true)
    const timer = setTimeout(
      () => {
        void (async () => {
          let next: Row[] = []
          try {
            if (mode === 'files') {
              files.current ??= await api.navFiles()
              next = files.current.flatMap((d) =>
                d.roots.flatMap((r) => filterFiles(r.files, q).slice(0, 30).map((f): Row => ({ key: `${d.deskId}:${r.path}/${f}`, title: f.split('/').pop() ?? f, hint: `${r.label}/${f}`, desk: d.deskName, open: () => onOpenFile(d.deskId, `${r.path}/${f}`) })))
              )
            } else if (mode === 'text') {
              const hits = await api.navGrep({ text: q, regex, caseSensitive, glob: '' })
              next = hits.map((h, i) => textRow(h, i, onOpenFile))
            } else {
              const hits = await api.navTerminals({ text: q, regex, caseSensitive })
              next = hits.map((h, i): Row => ({ key: `${h.deskId}:${h.paneId}:${h.line}:${i}`, title: h.text, hint: h.tabName ?? '', desk: h.deskName, open: () => onOpenTab(h.deskId, h.tabId!) }))
            }
          } catch {
            next = []
          }
          if (!live) return
          setRows(next.slice(0, 300))
          setAt(0)
          setBusy(false)
        })()
      },
      mode === 'files' ? 0 : 250
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, mode, query, regex, caseSensitive])

  useEffect(() => row.current?.scrollIntoView({ block: 'nearest' }), [at, rows])

  const pick = (i: number) => {
    const r = rows[i]
    if (!r) return
    onClose()
    setTimeout(r.open, 0)
  }
  const cycle = (d: number) => setMode(MODES[(MODES.findIndex((m) => m.mode === mode) + d + MODES.length) % MODES.length].mode)
  const textual = mode !== 'files'
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal palette search-all" role="dialog" aria-label="Search all WorkDesks">
        <div className="search-all-modes" role="tablist">
          {MODES.map((m) => (
            <button key={m.mode} role="tab" aria-selected={m.mode === mode} className={m.mode === mode ? 'on' : ''} title={m.hint} onClick={() => setMode(m.mode)}>
              {m.label}
            </button>
          ))}
          {textual && (
            <>
              <label className="search-all-opt" title="Regular expression">
                <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> .*
              </label>
              <label className="search-all-opt" title="Match case">
                <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> Aa
              </label>
            </>
          )}
        </div>
        <input
          autoFocus
          className="palette-input"
          placeholder={MODES.find((m) => m.mode === mode)!.hint + '…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'Enter') pick(at)
            else if (e.key === 'Tab') cycle(e.shiftKey ? -1 : 1)
            else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) setAt(Math.min(rows.length - 1, at + 1))
            else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) setAt(Math.max(0, at - 1))
            else return
            e.preventDefault()
            e.stopPropagation()
          }}
        />
        <ul className="palette-list" role="listbox">
          {rows.map((r, i) => (
            <li key={r.key} ref={i === at ? row : undefined} role="option" aria-selected={i === at} className={i === at ? 'selected' : ''} onMouseMove={() => i !== at && setAt(i)} onClick={() => pick(i)}>
              <span className="palette-title search-all-title">{r.title}</span>
              <span className="palette-hint">{r.hint}</span>
              <span className="palette-group">{r.desk}</span>
            </li>
          ))}
          {rows.length === 0 && <li className="empty">{!query.trim() ? 'Type what to look for. Tab switches between Files, Text and Terminals.' : busy ? 'Searching…' : 'Nothing found.'}</li>}
        </ul>
      </div>
    </div>
  )
}

const textRow = (h: WorkspaceHit, i: number, open: (deskId: string, path: string, line?: number) => void): Row => ({
  key: `${h.deskId}:${h.rootPath}/${h.path}:${h.line}:${i}`,
  title: h.text.trim(),
  hint: `${h.rootLabel}/${h.path}:${h.line}`,
  desk: h.deskName,
  open: () => open(h.deskId, `${h.rootPath}/${h.path}`, h.line)
})
