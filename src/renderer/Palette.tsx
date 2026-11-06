import { useEffect, useRef, useState } from 'react'
import type { FileRoot } from '../main/files'
import type { DeskFiles } from '../main/domain/search-all'
import { currentFileOpener, otherDeskFileCommands, pathQuery, rankCommands, usePaletteList, type Command } from './command-palette'
import { filterFiles } from './file-buffers'

/** The command palette (Cmd+P): type to filter, arrow keys to move, Enter to run, Esc to close. What it offers depends on where you are. */
export function Palette({ onClose, onOpenInDesk }: { onClose: () => void; onOpenInDesk?: (deskId: string, path: string, line?: number) => void }) {
  const all = usePaletteList()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const row = useRef<HTMLLIElement>(null)
  // a path typed in: the files it names, in the folders of the WorkDesk on screen (or the Files page), come first
  const [files, setFiles] = useState<Command[]>([])
  const cache = useRef(new Map<string, { roots: FileRoot[]; lists: Record<string, string[]> }>())
  useEffect(() => {
    const p = pathQuery(query)
    const opener = currentFileOpener()
    if (!p || !opener) return setFiles([])
    let live = true
    void (async () => {
      const api = window.workdesk
      let entry = cache.current.get(opener.deskId)
      if (!entry) {
        const roots = await api.filesRoots(opener.deskId)
        const lists: Record<string, string[]> = {}
        await Promise.all(roots.map((r) => api.filesList(opener.deskId, r.path).then((l) => void (lists[r.path] = l), () => undefined)))
        entry = { roots, lists }
        cache.current.set(opener.deskId, entry)
      }
      if (!live) return
      const { roots, lists } = entry
      // a path from the root of the disk
      const abs = p.path.startsWith('/') ? roots.find((r) => p.path.startsWith(r.path + '/')) : undefined
      const found = abs
        ? [{ root: abs, file: p.path.slice(abs.path.length + 1) }]
        : roots.flatMap((r) => filterFiles(lists[r.path] ?? [], p.path).map((file) => ({ root: r, file }))).slice(0, 8)
      setFiles(
        found.map(({ root, file }): Command => ({
          id: `file:${root.path}/${file}`,
          title: file.split('/').pop() ?? file,
          hint: `${root.label}/${file}`,
          group: 'Open file',
          run: () => opener.open(`${root.path}/${file}`, p.line)
        }))
      )
    })()
    return () => {
      live = false
    }
  }, [query])
  // the same path in the other WorkDesks, after those of the one you are in, each labelled with its WorkDesk
  const [others, setOthers] = useState<Command[]>([])
  const everything = useRef<DeskFiles[] | undefined>(undefined)
  useEffect(() => {
    const p = pathQuery(query)
    if (!p || !onOpenInDesk) return setOthers([])
    let live = true
    void (async () => {
      everything.current ??= await window.workdesk.navFiles().catch(() => [])
      if (!live) return
      const here = currentFileOpener()?.deskId
      setOthers(otherDeskFileCommands(everything.current, here, p.path, p.line, onOpenInDesk))
    })()
    return () => {
      live = false
    }
  }, [query, onOpenInDesk])
  const shown = [...files, ...others, ...rankCommands(all, query)].slice(0, 100)
  const at = Math.min(cursor, Math.max(shown.length - 1, 0))
  useEffect(() => {
    row.current?.scrollIntoView({ block: 'nearest' })
  }, [at, query])
  // closed first, so a command that moves the focus (a new tab) keeps it
  const run = (i: number) => {
    const c = shown[i]
    if (!c) return
    onClose()
    setTimeout(c.run, 0)
  }
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal palette" role="dialog" aria-label="Command palette">
        <input
          autoFocus
          className="palette-input"
          placeholder="Type a command, WorkDesk, tab, favorite…"
          value={query}
          onChange={(e) => (setQuery(e.target.value), setCursor(0))}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'Enter') run(at)
            else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) setCursor(Math.min(shown.length - 1, at + 1))
            else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) setCursor(Math.max(0, at - 1))
            else return
            e.preventDefault()
            e.stopPropagation()
          }}
        />
        <ul className="palette-list" role="listbox">
          {shown.map((c, i) => (
            <li key={c.id} ref={i === at ? row : undefined} role="option" aria-selected={i === at} className={i === at ? 'selected' : ''} onMouseMove={() => i !== at && setCursor(i)} onClick={() => run(i)}>
              <span className="palette-title">{c.title}</span>
              {c.hint && <span className="palette-hint">{c.hint}</span>}
              <span className="palette-group">{c.group}</span>
            </li>
          ))}
          {shown.length === 0 && <li className="empty">Nothing matches “{query}”.</li>}
        </ul>
      </div>
    </div>
  )
}
