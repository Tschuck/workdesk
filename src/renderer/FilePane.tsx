import { Chevron, FileIcon } from './FileIcon'
import { PANEL_SIZES, Resizer } from './Resizer'
import { ScopeSwitch } from './ScopeSwitch'
import { scopedRoots, useScope } from './scope'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileRoot, SearchHit } from '../main/files'
import { ContextMenu } from './ContextMenu'
import { foldersOf, searchRoots } from './search-in'
import { ICONS } from './Icons'
import { toggleFileWrap, useFileWrap } from './file-wrap'
import { buildTree, filterFiles, setFileDirty, type TreeNode } from './file-buffers'
import { DiffView, type DiffRequest } from './DiffView'
import { cleanError, isGitRoot, notifyGitChanged, useMarks, type RootMarks } from './git-state'
import { PdfView } from './PdfView'
import { attachComments } from './review-comments'
import { useCommentsHost } from './comments-host'
import { loadEditorState, makeState, pruneEditorStates, restorable, saveEditorState } from './editor-state'
import { canStep, historyDirection, recordPlace, stepPlace, forgetFile } from './nav-history'
import { KIND_LETTER } from '../main/domain/git-status'
import { UsagesDialog } from './UsagesDialog'
import { symbolFor } from './usages'
import { onDirtyQuery, onWritten, USAGES_EVENT, type UsagesMode } from './usages-events'
import './editor-git.css'

/** the tabs of the File pane's side */
export type SideTab = 'files' | 'search'
let pruned = false

type MonacoApi = (typeof import('./monaco-setup'))['monaco']
type Editor = ReturnType<MonacoApi['editor']['create']>

export const TREE_KEY = 'workdesk.fileTree'
export const readTreePref = (): boolean => {
  try {
    return localStorage.getItem(TREE_KEY) !== '0'
  } catch {
    return true
  }
}
const rel = (root: string, path: string): string => (path.startsWith(root + '/') ? path.slice(root.length + 1) : path)

interface Props {
  /** the WorkDesk whose folders it shows, or `GLOBAL_DESK` on the Files page */
  deskId: string
  /** who it is, for its unsaved changes (the Pane's id, or the Files page's tab) */
  paneId: string
  path?: string
  line?: number
  /** show another file here (or none: the file tree again); the owner remembers it */
  navigate: (path: string | undefined, line?: number) => void | Promise<void>
  /** the tree and search are the page's, not this pane's (the Files page has one for all its tabs): ⌘B and ⇧⌘F go to the page */
  page?: { sideShown: boolean; onToggleSide: () => void; onSearch: () => void }
  /** show a file beside this one: a new Pane next to it, or a new tab on the Files page */
  beside: (path: string, line?: number) => void | Promise<void>
}

/** Puts the keyboard in the search field of the File side inside `scope`, with its text selected (it is not there yet while the Search tab opens). */
export function focusSearch(scope: ParentNode | null | undefined): void {
  const find = () => scope?.querySelector<HTMLInputElement>('.file-side input[placeholder="Search…"]')
  const go = (): boolean => {
    const input = find()
    input?.focus()
    input?.select()
    return !!input
  }
  if (!go()) setTimeout(go, 60)
}

/** Tells a File pane to open its search and take the keyboard (⇧⌘F from anywhere in the WorkDesk). */
export const SEARCH_EVENT = 'workdesk:file-search'
/** Asks the WorkDesk to open its file finder (`find`: by name, `definition`: go to definition); sent from the page of a new file. */
export const FINDER_EVENT = 'workdesk:file-finder'

/** One file in a light editor (Monaco), with a file tree and a search on the left; ⌘B shows or hides them, ⌘S saves. */
export function FilePane({ deskId, paneId, path, line, navigate, beside, page }: Props) {
  const api = window.workdesk
  const [showTree, setShowTree] = useState(readTreePref)
  const wrap = useFileWrap()
  const [side, setSide] = useState<SideTab>('files')
  const [roots, setRoots] = useState<FileRoot[]>([])
  // the diff against HEAD / the merge base shown over the editor, and the review comments in the gutter
  const [diff, setDiff] = useState<DiffRequest>()
  const [commentsOn, setCommentsOn] = useState(false)
  const [modelPath, setModelPath] = useState<string>()
  const tracking = useRef(false)
  const diskText = useRef('')
  // the file was changed on disk (by Claude, a terminal, git) while it has changes here that are not saved
  const [diskChanged, setDiskChanged] = useState(false)
  const stateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  // Find usages / Rename symbol (text based), for the name at the cursor
  const [usages, setUsages] = useState<{ mode: UsagesMode; word: string }>()
  const [refused, setRefused] = useState<string>()
  // a PDF is drawn by pdf.js (with a find bar), from the bytes of the file
  const [pdf, setPdf] = useState<Uint8Array>()
  // the file is too large for the grammars of VS Code: Monaco's own tokenizer colours it
  const [simplified, setSimplified] = useState(false)
  // the grammars of VS Code did not start: why
  const [colourError, setColourError] = useState<string>()
  const [error, setError] = useState<string>()
  const host = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const editor = useRef<Editor | undefined>(undefined)
  const monaco = useRef<MonacoApi | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const saved = useRef(0)
  const current = useRef<{ path?: string; scratch: boolean }>({ scratch: false })
  // the first file of a pane is loaded when the pane is made (or made again after a split or a move): the keyboard stays where it was then
  const loaded = useRef(false)

  const toggleTree = useCallback((on?: boolean) => {
    setShowTree((cur) => {
      const next = on ?? !cur
      try {
        localStorage.setItem(TREE_KEY, next ? '1' : '0')
      } catch {
        // remembering is a convenience only
      }
      return next
    })
  }, [])

  useEffect(() => void api.filesRoots(deskId).then(setRoots, () => setRoots([])), [api, deskId, path])
  const rootOf = (p: string): FileRoot | undefined => roots.find((r) => p === r.path || p.startsWith(r.path + '/'))

  // the editor itself: made when the first File Pane opens (Monaco is large and loads lazily)
  useEffect(() => {
    let disposed = false
    void import('./monaco-setup').then(({ monaco: m }) => {
      if (disposed || !host.current) return
      monaco.current = m
      const ed = m.editor.create(host.current, {
        theme: 'workdesk',
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: 'ui-monospace, Menlo, monospace',
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        renderLineHighlight: 'all',
        wordWrap: wrap ? 'on' : 'off',
        model: null
      })
      editor.current = ed
      ed.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => void save())
      // text based (no language server): also in the editor's right-click menu
      ed.addAction({ id: 'workdesk.find-usages', label: 'Find Usages (text based)', keybindings: [m.KeyMod.Alt | m.KeyMod.Shift | m.KeyCode.F7], contextMenuGroupId: 'navigation', contextMenuOrder: 1.6, run: () => openUsagesRef.current('usages') })
      // the path of the file shown, from the editor's right-click menu
      ed.addAction({ id: 'workdesk.copy-relative-path', label: 'Copy Relative Path', contextMenuGroupId: '9_cutcopypaste', contextMenuOrder: 10, run: (e) => copyPathRef.current(true, e.getPosition()?.lineNumber) })
      ed.addAction({ id: 'workdesk.copy-path', label: 'Copy Path', contextMenuGroupId: '9_cutcopypaste', contextMenuOrder: 11, run: () => copyPathRef.current(false) })
      ed.addAction({ id: 'workdesk.rename-symbol', label: 'Rename Symbol (text based)', keybindings: [m.KeyMod.Alt | m.KeyMod.Shift | m.KeyCode.F6], contextMenuGroupId: 'navigation', contextMenuOrder: 1.7, run: () => openUsagesRef.current('rename') })
      // the cursor history (⌃- / ⌃⇧-) and what is remembered across restarts follow the cursor and the scroll
      ed.onDidChangeCursorPosition((e) => {
        const p = current.current.path
        if (tracking.current && p) recordPlace(deskId, { path: p, line: e.position.lineNumber, column: e.position.column })
        rememberSoon()
      })
      ed.onDidScrollChange(() => rememberSoon())
      ed.onDidChangeModelContent(() => rememberSoon())
      if (!pruned) ((pruned = true), pruneEditorStates())
      setReady(true)
    })
    return () => {
      disposed = true
      remember()
      clearTimeout(stateTimer.current)
      editor.current?.getModel()?.dispose()
      editor.current?.dispose()
      editor.current = undefined
      setFileDirty(paneId, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // word wrap follows the setting, for every File pane at once
  useEffect(() => {
    editor.current?.updateOptions({ wordWrap: wrap ? 'on' : 'off' })
  }, [wrap, ready])

  /** writes cursor, scroll and unsaved text of the file shown, for the next start */
  const remember = () => {
    const ed = editor.current
    const model = ed?.getModel()
    const p = current.current.path
    if (!ed || !model || !p || !loaded.current) return
    const pos = ed.getPosition()
    if (!pos) return
    saveEditorState(paneId, makeState(p, { line: pos.lineNumber, column: pos.column }, ed.getScrollTop(), current.current.scratch ? undefined : { text: model.getValue(), diskText: diskText.current }))
  }
  const rememberSoon = () => {
    clearTimeout(stateTimer.current)
    stateTimer.current = setTimeout(remember, 500)
  }

  const save = async () => {
    const ed = editor.current
    const model = ed?.getModel()
    const p = current.current.path
    if (!ed || !model || !p) return
    try {
      await api.filesWrite(deskId, p, model.getValue())
      saved.current = model.getAlternativeVersionId()
      diskText.current = model.getValue()
      setDirty(false)
      setFileDirty(paneId, false)
      notifyGitChanged()
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save

  /** Find usages / Rename symbol for the selected name or the one at the cursor */
  const openUsages = (mode: UsagesMode) => {
    const ed = editor.current
    const model = ed?.getModel()
    const pos = ed?.getPosition()
    const sel = ed?.getSelection()
    const word = ed && model && pos ? symbolFor(sel && !sel.isEmpty() ? model.getValueInRange(sel) : '', model.getLineContent(pos.lineNumber), pos.column - 1) : ''
    if (mode === 'rename' && !word) return setError('Put the cursor on a name (or select one) to rename it.')
    setUsages({ mode, word })
  }
  const openUsagesRef = useRef(openUsages)
  openUsagesRef.current = openUsages
  useEffect(() => {
    const el = root.current
    const on = (e: Event) => openUsagesRef.current((e as CustomEvent<UsagesMode>).detail)
    el?.addEventListener(USAGES_EVENT, on)
    // a rename in some dialog asks which files have unsaved changes here, and tells which ones it wrote
    const offQuery = onDirtyQuery((p) => p === current.current.path && !current.current.scratch && dirtyRef.current)
    const offWritten = onWritten((paths) => {
      const p = current.current.path
      if (p && paths.includes(p) && !dirtyRef.current) void reloadFromDisk()
    })
    return () => {
      el?.removeEventListener(USAGES_EVENT, on)
      offQuery()
      offWritten()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** The file was written behind the editor's back (a rename): show the text on disk, as saved, keeping the cursor */
  const reloadFromDisk = async (force = false) => {
    const p = current.current.path
    const ed = editor.current
    const model = ed?.getModel()
    if (!p || !ed || !model) return
    const file = await api.filesRead(deskId, p).catch(() => undefined)
    if (!file || file.refused || (dirtyRef.current && !force) || file.content === model.getValue()) return setDiskChanged(false)
    const pos = ed.getPosition()
    const top = ed.getScrollTop()
    model.setValue(file.content)
    ed.setScrollTop(top)
    setDiskChanged(false)
    diskText.current = file.content
    saved.current = model.getAlternativeVersionId()
    setDirty(false)
    setFileDirty(paneId, false)
    if (pos) ed.setPosition(pos)
  }

  // a file changed behind the editor's back (Claude, a terminal, git) shows up: at once when it has no unsaved changes here, else as a note
  useEffect(() => {
    const look = async () => {
      const p = current.current.path
      const model = editor.current?.getModel()
      if (!p || !model || current.current.scratch || document.hidden || !root.current || root.current.offsetParent === null) return
      const file = await api.filesRead(deskId, p).catch(() => undefined)
      if (!file || file.refused || p !== current.current.path) return
      if (file.content === diskText.current) return setDiskChanged(false)
      if (dirtyRef.current) setDiskChanged(true)
      else void reloadFromDisk()
    }
    const timer = setInterval(() => void look(), 2000)
    window.addEventListener('focus', look)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', look)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deskId])

  // the file the Pane shows
  useEffect(() => {
    const ed = editor.current
    const m = monaco.current
    if (!ready || !ed || !m) return
    let live = true
    setRefused(undefined)
    setSimplified(false)
    setError(undefined)
    remember()
    tracking.current = false
    setModelPath(undefined)
    ed.getModel()?.dispose()
    ed.setModel(null)
    setDirty(false)
    setFileDirty(paneId, false)
    current.current = { path, scratch: false }
    setPdf(undefined)
    if (!path) return
    if (/\.pdf$/i.test(path)) {
      void api.filesReadBinary(deskId, path).then(
        (bytes) => live && setPdf(bytes),
        (e) => live && setError(cleanError(e))
      )
      return () => {
        live = false
      }
    }
    void api.filesRead(deskId, path).then(
      (file) => {
        if (!live) return
        if (file.refused) return setRefused(file.refused === 'binary' ? 'This file is not text.' : `This file is too large to open here (${Math.round(file.size / 1024 / 1024)} MB).`)
        const uri = m.Uri.file(path)
        m.editor.getModel(uri)?.dispose()
        diskText.current = file.content
        // after a restart the pane shows what it showed: cursor, scroll and unsaved changes (only if the file is as it was)
        const back = loaded.current ? undefined : restorable(loadEditorState(paneId), path, file.content)
        const model = m.editor.createModel(file.content, undefined, uri)
        ed.setModel(model)
        setModelPath(path)
        void import('./monaco-setup').then(({ prepareCodeModel }) => prepareCodeModel(model)).then((r) => live && (setSimplified(r.simplified), setColourError(r.failed)), () => undefined)
        saved.current = model.getAlternativeVersionId()
        if (back?.text !== undefined) model.setValue(back.text)
        current.current = { path, scratch: path.includes('/scratch/') }
        let timer: ReturnType<typeof setTimeout> | undefined
        model.onDidChangeContent(() => {
          const changed = model.getAlternativeVersionId() !== saved.current
          setDirty(changed)
          // scratch files are written as you type; files of a Branch only when you save
          if (current.current.scratch) {
            clearTimeout(timer)
            timer = setTimeout(() => void saveRef.current(), 800)
          } else setFileDirty(paneId, changed)
        })
        // the restored unsaved text differs from the file on disk: it is a change that is not saved
        if (back?.text !== undefined && !current.current.scratch) {
          setDirty(true)
          setFileDirty(paneId, true)
        }
        if (back) {
          ed.setPosition({ lineNumber: back.line, column: back.column })
          ed.setScrollTop(back.scrollTop)
        } else if (line) {
          ed.revealLineInCenter(line)
          ed.setPosition({ lineNumber: line, column: 1 })
        }
        // from here on the cursor makes history; the place the file was opened at is the first one
        tracking.current = true
        const at = ed.getPosition()
        if (at) recordPlace(deskId, { path, line: at.lineNumber, column: at.column })
        // a file chosen in an open pane takes the keyboard; a pane that was just made leaves it alone
        if (loaded.current) ed.focus()
        loaded.current = true
      },
      (e: Error) => live && setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, path, line])

  /** Show another file: here, or beside this Pane; asks first when this one has changes that are not saved. */
  const openPath = async (to: string, at?: number, besideFlag?: boolean) => {
    if (!besideFlag && dirty && !current.current.scratch && !window.confirm('This file has changes that are not saved. Open the other file and lose them?')) return
    if (besideFlag) {
      await beside(to, at)
      return
    }
    // an empty scratch file that was never written to goes when it is left
    if (path && path !== to && current.current.scratch) void api.filesDropEmptyScratch(deskId, path)
    setDiff(undefined)
    await navigate(to, at)
  }

  /** The diff of a file (against HEAD or the merge base) over the editor; the file itself is opened under it, unless it is gone. */
  const showDiff = async (req: DiffRequest) => {
    if (req.path !== path && (await api.filesRead(deskId, req.path).then(() => true, () => false))) {
      if (dirty && !current.current.scratch && !window.confirm('This file has changes that are not saved. Open the other file and lose them?')) return
      await navigate(req.path)
    }
    setDiff(req)
  }

  /** A file was renamed (`to`) or removed (no `to`): a Pane that shows it follows it, or goes back to the file tree. */
  const moved = (from: string, to?: string) => {
    forgetFile(deskId, from, to)
    // a folder that was removed takes the file shown in it along
    if (from === path || (!to && path?.startsWith(from + '/'))) void navigate(to)
  }

  /** ⌃- / ⌃⇧-: back / forward to the places the cursor was, also in other files */
  const goHistory = (dir: -1 | 1) => {
    const place = stepPlace(deskId, dir)
    if (!place) return
    const ed = editor.current
    setDiff(undefined)
    if (place.path === current.current.path && ed) {
      ed.revealLineInCenter(place.line)
      ed.setPosition({ lineNumber: place.line, column: place.column })
      ed.focus()
    } else void openPath(place.path, place.line)
  }

  // the git side of this file: its folder, the changes and review comments there
  const subject = diff?.path ?? path
  const subjectRoot = subject ? rootOf(subject) : undefined
  const gitRoot = subjectRoot && isGitRoot(subjectRoot) ? subjectRoot : undefined
  const marks = useMarks(deskId, gitRoot ? [gitRoot] : [])
  const rootMarks: RootMarks | undefined = gitRoot ? marks[gitRoot.path] : undefined
  const commentsHost = useCommentsHost(deskId, gitRoot?.path, gitRoot && subject ? rel(gitRoot.path, subject) : undefined, rootMarks?.allComments, setError)
  const myComments = rootMarks?.allComments
  // the comments of a file that has some are shown without asking
  const commentCount = gitRoot && subject ? (rootMarks?.comments[rel(gitRoot.path, subject)] ?? 0) : 0
  useEffect(() => {
    const ed = editor.current
    const m = monaco.current
    if (!commentsHost || !ed || !m || !modelPath || diff || !(commentsOn || commentCount > 0)) return
    ed.updateOptions({ glyphMargin: true })
    const a = attachComments(m, ed, commentsHost)
    attachedComments.current = a
    return () => {
      attachedComments.current = undefined
      a.dispose()
      ed.updateOptions({ glyphMargin: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentsHost, modelPath, diff, commentsOn, commentCount > 0])
  useEffect(() => attachedComments.current?.refresh(), [myComments])
  const attachedComments = useRef<{ refresh: () => void; dispose: () => void } | undefined>(undefined)
  /** false when the file that is about to be renamed or removed is the one shown, with changes that would be lost */
  const mayChange = (abs: string): boolean => abs !== path || !dirty || current.current.scratch || window.confirm('This file has changes that are not saved. Go on and lose them?')

  const [barMenu, setBarMenu] = useState<{ x: number; y: number }>()
  const newScratch = async () => {
    const created = await api.filesNewScratch(deskId)
    await openPath(created)
    if (!page) toggleTree(false)
  }

  // the search tab, shown and in the keyboard's hands (also when it was open already)
  const openSearch = () => {
    if (page) page.onSearch()
    else (setSide('search'), toggleTree(true))
    focusSearch(page ? root.current?.closest('.files-view') : root.current)
  }
  const openSearchRef = useRef(openSearch)
  openSearchRef.current = openSearch
  useEffect(() => {
    const el = root.current
    const on = () => openSearchRef.current()
    el?.addEventListener(SEARCH_EVENT, on)
    return () => el?.removeEventListener(SEARCH_EVENT, on)
  }, [])

  // the path of the file shown, to the clipboard: whole, or from its folder (the Branch's, notes, …)
  // `line`: the line that was right-clicked; the relative path then comes as `path:line`
  const copyPath = (relative: boolean, line?: number) => {
    const p = current.current.path
    if (!p) return
    const r = rootOf(p)
    void api.writeClipboard((relative && r ? rel(r.path, p) : p) + (relative && line ? `:${line}` : ''))
  }
  const copyPathRef = useRef(copyPath)
  copyPathRef.current = copyPath
  const [nameMenu, setNameMenu] = useState<{ x: number; y: number }>()

  const name = path ? path.split('/').pop() : 'No file'
  const where = path && rootOf(path) ? `${rootOf(path)!.label}/${rel(rootOf(path)!.path, path)}` : path

  return (
    <div
      className="file-pane"
      ref={root}
      tabIndex={-1}
      onKeyDownCapture={(e) => {
        // ⌥Z: word wrap, as in VS Code
        if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyZ') return void (e.preventDefault(), e.stopPropagation(), toggleFileWrap())
        // ⌃- / ⌃⇧-: back / forward through the places of the cursor
        const dir = historyDirection(e)
        if (dir) return void (e.preventDefault(), e.stopPropagation(), goHistory(dir))
        if (!e.metaKey || e.ctrlKey || e.altKey) return
        const k = e.key.toLowerCase()
        if (k === 'b' && !e.shiftKey) (e.preventDefault(), e.stopPropagation(), page ? page.onToggleSide() : toggleTree())
        else if (k === 'f' && e.shiftKey) (e.preventDefault(), e.stopPropagation(), openSearch())
        else if (k === 's' && !e.shiftKey) (e.preventDefault(), e.stopPropagation(), void save())
      }}
    >
      {nameMenu && (
        <ContextMenu
          x={nameMenu.x}
          y={nameMenu.y}
          onClose={() => setNameMenu(undefined)}
          items={[
            { label: 'Copy relative path', onClick: () => copyPath(true) },
            { label: 'Copy path', onClick: () => copyPath(false) }
          ]}
        />
      )}
      {barMenu && (
        <ContextMenu
          x={barMenu.x}
          y={barMenu.y}
          onClose={() => setBarMenu(undefined)}
          items={[
            { label: 'Back (⌃-)', disabled: !canStep(deskId, -1), why: 'No earlier place', onClick: () => goHistory(-1) },
            { label: 'Forward (⌃⇧-)', disabled: !canStep(deskId, 1), why: 'No later place', onClick: () => goHistory(1) },
            ...(gitRoot && path ? [{ label: diff ? 'Close the diff' : 'Diff against HEAD', onClick: () => (diff ? setDiff(undefined) : setDiff({ path, rootPath: gitRoot.path, mode: 'head' as const })) }] : []),
            ...(gitRoot && path && !diff ? [{ label: commentsOn ? `Hide review comments${commentCount ? ` (${commentCount})` : ''}` : `Review comments${commentCount ? ` (${commentCount})` : ''}`, onClick: () => setCommentsOn(!commentsOn) }] : []),
            ...(path && !current.current.scratch ? [{ label: dirty ? 'Reload from disk (drops unsaved changes)' : 'Reload from disk', onClick: () => (dirty && !window.confirm('Drop your unsaved changes and show the file as it is on disk?') ? undefined : void reloadFromDisk(true)) }] : []),
            { label: 'New scratch file', onClick: () => void newScratch() },
            ...(path ? [{ label: 'Show in VS Code', onClick: () => void api.filesOpenInEditor(deskId, path, editor.current?.getPosition()?.lineNumber) }] : []),
          ]}
        />
      )}
      {!page && showTree && <FileSide deskId={deskId} roots={roots} side={side} onSide={setSide} current={path} onOpen={openPath} onMoved={moved} mayChange={mayChange} onDiff={(req) => void showDiff(req)} />}
      <div className="file-main">
        <div className="file-bar">
          <button type="button" title="Show or hide the files and the search (⌘B)" className={(page ? page.sideShown : showTree) ? 'on' : ''} onClick={() => (page ? page.onToggleSide() : toggleTree())}>☰</button>
          <span className="file-name" title={where} onContextMenu={(e) => path && (e.preventDefault(), setNameMenu({ x: e.clientX, y: e.clientY }))}>{name}{dirty && !current.current.scratch ? ' ●' : ''}</span>
          <span className="file-where hint">{where && where !== name ? where : ''}</span>
          <span className="file-spacer" />
          <button type="button" className={'icon-toggle' + (wrap ? ' on' : '')} title={wrap ? 'Word wrap is on (⌥Z)' : 'Word wrap is off (⌥Z)'} aria-pressed={wrap} onClick={() => toggleFileWrap()}>{ICONS.wrap}</button>
          <button
            type="button"
            title="More: back / forward, diff, review comments, scratch file, VS Code"
            aria-label="More actions"
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect()
              setBarMenu({ x: box.right - 220, y: box.bottom + 2 })
            }}
          >
            ⋯
          </button>
        </div>
        {diff && (
          <DiffView
            deskId={deskId}
            request={diff}
            comments={commentsHost}
            commentsKey={myComments}
            onEdit={(line) => {
              setDiff(undefined)
              if (diff.path !== path) return void navigate(diff.path, line)
              editor.current?.revealLineInCenter(line)
              editor.current?.setPosition({ lineNumber: line, column: 1 })
              editor.current?.focus()
            }}
            onClose={() => setDiff(undefined)}
          />
        )}
        {colourError && !diff && <p className="file-note file-warning">The colours of the VS Code theme are not available (Monaco colours this file): {colourError}</p>}
        {simplified && !diff && <p className="file-note file-warning">This file is large, so it is coloured in a simpler way (the colours of the editor itself, not of the VS Code theme).</p>}
        {diskChanged && !diff && (
          <p className="file-note">
            This file was changed on disk, and you have changes here that are not saved. <button className="link" onClick={() => void reloadFromDisk(true)}>Reload it</button> (your changes are dropped) or save to overwrite it.
          </p>
        )}
        {(error || (!diff && refused)) && <p className="file-note">{!diff && refused ? refused : error}</p>}
        {!path && !error && !diff && (
          <NewFile
            deskId={deskId}
            roots={roots}
            onCreated={(created) => void openPath(created)}
            onScratch={() => void newScratch()}
            onSearch={openSearch}
            onFinder={(mode) => window.dispatchEvent(new CustomEvent(FINDER_EVENT, { detail: { deskId, mode } }))}
          />
        )}
        {usages && (
          <UsagesDialog
            deskId={deskId}
            mode={usages.mode}
            word={usages.word}
            onClose={() => (setUsages(undefined), editor.current?.focus())}
            onOpen={(to, at) => {
              setUsages(undefined)
              // a place in the file shown: just go there
              if (to !== path || !at || !editor.current) return void openPath(to, at)
              editor.current.revealLineInCenter(at)
              editor.current.setPosition({ lineNumber: at, column: 1 })
              editor.current.focus()
            }}
          />
        )}
        <div className="file-editor" ref={host} style={{ display: path && !refused && !pdf && !diff ? undefined : 'none' }} />
        {pdf && !diff && <PdfView bytes={pdf} name={name ?? ''} />}
      </div>
    </div>
  )
}

/** What a File Pane without a file shows: make a new file (where, and its name), or a scratch file; the tree and the search are on the left. */
function NewFile({ deskId, roots, onCreated, onScratch, onSearch, onFinder }: { deskId: string; roots: FileRoot[]; onCreated: (path: string) => void; onScratch: () => void; onSearch: () => void; onFinder: (mode: 'find' | 'definition') => void }) {
  const api = window.workdesk
  // not scratch (that has its own button), and a Branch's folder is a choice you make on purpose: notes / knowledge first
  const choices = roots.filter((r) => !r.scratch)
  const [where, setWhere] = useState<string>()
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const target = choices.find((r) => r.path === where) ?? choices.find((r) => r.label === 'notes') ?? choices.find((r) => r.label === 'knowledge') ?? choices[0]
  const create = async () => {
    if (!target || !name.trim()) return
    // a name without an extension is a Markdown note
    const clean = name.trim()
    const file = clean.split('/').pop()!.includes('.') ? clean : `${clean}.md`
    try {
      onCreated(await api.filesCreate(deskId, target.path, file))
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  return (
    <div className="file-new">
      <h3>Open or create a file</h3>
      <div className="file-new-cards">
        <section className="file-new-card">
          <h4>New note</h4>
          <p className="hint">A Markdown file in your notes or knowledge folder. Without a dot in the name it becomes <code>.md</code>; folders are made.</p>
          <div className="file-new-row">
            <select value={target?.path ?? ''} onChange={(e) => setWhere(e.target.value)} aria-label="Folder">
              {choices.map((r) => (
                <option key={r.path} value={r.path}>{r.label}</option>
              ))}
            </select>
            <input
              className="file-focus"
              autoFocus
              placeholder="name.md, or folder/name.ts"
              value={name}
              onChange={(e) => (setName(e.target.value), setError(undefined))}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
            />
            <button className="primary" disabled={!name.trim() || !target} onClick={() => void create()}>Create</button>
          </div>
          {error && <p className="error">{error}</p>}
        </section>

        <section className="file-new-card">
          <h4>Scratch file</h4>
          <p className="hint">Written as you type, kept with this WorkDesk, gone when it is cleared. For a command, a snippet, a thought.</p>
          <button className="file-new-action" onClick={onScratch}>
            <span>Start a scratch file</span>
          </button>
        </section>

        <section className="file-new-card">
          <h4>Find something</h4>
          <button className="file-new-action" onClick={() => onFinder('find')}>
            <span>Find a file by name</span>
            <kbd>⌘P</kbd>
          </button>
          <button className="file-new-action" onClick={onSearch}>
            <span>Search the text of the files</span>
            <kbd>⇧⌘F</kbd>
          </button>
          <button className="file-new-action" onClick={() => onFinder('definition')}>
            <span>Go to the definition of a name</span>
            <kbd>⌘D</kbd>
          </button>
          <p className="hint">Or pick a file in the list on the left (⌘B shows or hides it).</p>
        </section>
      </div>
    </div>
  )
}

/** The left side of a File Pane: the files of the WorkDesk's folders, and the search through them. */
export function FileSide({ deskId, roots, side, onSide, current, onOpen, onMoved, mayChange, onDiff }: { deskId: string; roots: FileRoot[]; side: SideTab; onSide: (s: SideTab) => void; current?: string; onOpen: (path: string, line?: number, beside?: boolean) => void; onMoved: (from: string, to?: string) => void; mayChange: (abs: string) => boolean; onDiff?: (req: DiffRequest) => void }) {
  // where the search looks (a path from the roots of the tree); "Search in…" on a folder fills it
  const [searchIn, setSearchIn] = useState('')
  // the branch the tree and the search look at, when the WorkDesk has several
  const scope = useScope(deskId)
  const scoped = scopedRoots(roots, scope)
  const marks = useMarks(deskId, scoped)
  const tab = side === 'search' ? 'search' : 'files'
  return (
    <>
    <aside className="file-side">
      <ScopeSwitch deskId={deskId} roots={roots} />
      <div className="file-side-tabs">
        <button className={tab === 'files' ? 'active' : ''} onClick={() => onSide('files')}>Files</button>
        <button className={tab === 'search' ? 'active' : ''} onClick={() => onSide('search')}>Search</button>
      </div>
      {tab === 'files' ? (
        <FilesTab deskId={deskId} roots={scoped} marks={marks} current={current} onOpen={onOpen} onMoved={onMoved} mayChange={mayChange} onSearchIn={(where) => (setSearchIn(where), onSide('search'))} onDiff={onDiff} />
      ) : (
        <SearchTab deskId={deskId} roots={scoped} searchIn={searchIn} onSearchIn={setSearchIn} onOpen={onOpen} />
      )}
    </aside>
    <Resizer size={PANEL_SIZES.files} min={160} max={640} edge="right" panel={(h) => h.previousElementSibling as HTMLElement | null} className="files-resizer" />
    </>
  )
}

/** What the tree can do with a file or folder; the menu and the inline inputs of the tree use it. */
/** Git marker, review comments and type problems next to a file or folder of the tree; `path` is relative to its Branch folder. */
function Marks({ m, path, folder }: { m?: RootMarks; path: string; folder?: boolean }) {
  if (!m) return null
  const kind = m.git[path]
  const comments = folder ? 0 : (m.comments[path] ?? 0)
  const problems = m.problems?.[path] ?? 0
  if (!kind && !comments && !problems) return null
  return (
    <span className="file-marks">
      {problems > 0 && <span className="mark-problems" title={`${problems} type problem${problems === 1 ? '' : 's'}`}>{problems}</span>}
      {comments > 0 && <span className="rv-count" title={`${comments} review comment${comments === 1 ? '' : 's'}`}>💬 {comments}</span>}
      {kind && (folder ? <span className={`mark-dot mark-${kind}`} title={`Contains ${kind} files`} /> : <span className={`mark-letter mark-${kind}`} title={kind}>{KIND_LETTER[kind]}</span>)}
    </span>
  )
}

/** On the Branch folder's row: all the changes and problems inside. */
function RootMarkSummary({ m }: { m?: RootMarks }) {
  if (!m) return null
  const problems = m.problems?.[''] ?? 0
  const comments = m.allComments.length
  if (!m.entries.length && !problems && !comments) return null
  return (
    <span className="file-marks">
      {problems > 0 && <span className="mark-problems" title={`${problems} type problem${problems === 1 ? '' : 's'} in this branch`}>{problems}</span>}
      {comments > 0 && <span className="rv-count" title="review comments">💬 {comments}</span>}
      {m.entries.length > 0 && <span className="mark-modified" title={`${m.entries.length} changed file${m.entries.length === 1 ? '' : 's'}`}>{m.entries.length}</span>}
    </span>
  )
}

interface TreeOps {
  marks?: Record<string, RootMarks>
  current?: string
  /** the folders that are open (absolute paths, the roots too) */
  open: Set<string>
  toggleDir: (abs: string) => void
  onOpen: (path: string, line?: number, beside?: boolean) => void
  /** the right-click menu of a file or folder (absolute path) */
  onMenu: (e: React.MouseEvent, abs: string, isDir: boolean, root: FileRoot) => void
  /** the file whose new name is being typed, and the folder in which a new file's name is */
  renaming?: string
  creating?: string
  /** the folder in which the name of a new folder is being typed */
  creatingFolder?: string
  /** a file is being dragged to another folder, and the folder it is over */
  dragged?: string
  over?: string
  onDragFile: (abs?: string) => void
  onOver: (dir?: string) => void
  onDropOn: (dir: string) => void
  onRename: (abs: string, name?: string) => void
  onCreate: (dir: string, name?: string) => void
  onCreateFolder: (dir: string, name?: string) => void
}

function NameInput({ initial, placeholder, onDone }: { initial: string; placeholder?: string; onDone: (name?: string) => void }) {
  return (
    <input
      autoFocus
      className="file-rename"
      defaultValue={initial}
      placeholder={placeholder}
      onFocus={(e) => {
        const dot = e.target.value.lastIndexOf('.')
        e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length)
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') onDone(e.currentTarget.value)
        else if (e.key === 'Escape') onDone(undefined)
      }}
      onBlur={() => onDone(undefined)}
    />
  )
}

function FilesTab({ deskId, roots, marks, current, onOpen, onMoved, mayChange, onSearchIn, onDiff }: { deskId: string; roots: FileRoot[]; marks: Record<string, RootMarks>; onDiff?: (req: DiffRequest) => void; onSearchIn: (where: string) => void; current?: string; onOpen: (path: string, line?: number, beside?: boolean) => void; onMoved: (from: string, to?: string) => void; mayChange: (abs: string) => boolean }) {
  const api = window.workdesk
  const [lists, setLists] = useState<Record<string, string[]>>({})
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; abs: string; isDir: boolean; root: FileRoot }>()
  const [renaming, setRenaming] = useState<string>()
  const [creating, setCreating] = useState<string>()
  const [creatingFolder, setCreatingFolder] = useState<string>()
  // the file that is being moved to knowledge (the dialog asks for the folder)
  const [movingToKnowledge, setMovingToKnowledge] = useState<string>()
  const [dragged, setDragged] = useState<string>()
  const [over, setOver] = useState<string>()
  const [error, setError] = useState<string>()
  const load = useCallback(
    (root: FileRoot) => {
      if (lists[root.path]) return
      // an entry ending in `/` is an empty folder (made by hand in scratch, notes or knowledge)
      void Promise.all([api.filesList(deskId, root.path), api.filesEmptyFolders(deskId, root.path).catch(() => [] as string[])]).then(
        ([l, empty]) => setLists((cur) => ({ ...cur, [root.path]: [...l, ...empty.map((f) => f + '/')] })),
        (e: Error) => {
          // an empty folder and a folder that could not be read must not look the same
          setLists((cur) => ({ ...cur, [root.path]: [] }))
          setError(`Could not list the files of ${root.label}: ${e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').split('\n')[0]}`)
        }
      )
    },
    [api, deskId, lists]
  )
  const reload = (root: FileRoot) => setLists((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) => k !== root.path)))
  // the first folder is open to start with; the filter needs every list
  useEffect(() => {
    if (roots[0]) {
      setOpen((o) => (o.size === 0 ? new Set([roots[0].path]) : o))
    }
  }, [roots])
  useEffect(() => {
    for (const r of roots) if (open.has(r.path) || filter) load(r)
  }, [roots, open, filter, load])

  // the file in the editor is shown in the tree: the folders above it open, and the row comes into view
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = current ? roots.find((r) => current.startsWith(r.path + '/')) : undefined
    if (!current || !root) return
    const dirs = [root.path]
    for (const part of current.slice(root.path.length + 1).split('/').slice(0, -1)) dirs.push(`${dirs[dirs.length - 1]}/${part}`)
    setOpen((o) => (dirs.every((d) => o.has(d)) ? o : new Set([...o, ...dirs])))
    // the rows are there after the list is read and the folders are open
    const t = setTimeout(() => wrap.current?.querySelector('.file-leaf.on')?.scrollIntoView({ block: 'nearest' }), 80)
    return () => clearTimeout(t)
  }, [current, roots, lists])

  const rootOf = (abs: string): FileRoot | undefined => roots.find((r) => abs === r.path || abs.startsWith(r.path + '/'))
  /** runs a change of the files, shows what went wrong, and reads the folder again */
  const change = async (abs: string | string[], job: () => Promise<void>) => {
    try {
      setError(undefined)
      await job()
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
    for (const a of [abs].flat()) {
      const r = rootOf(a)
      if (r) reload(r)
    }
  }
  const toggleDir = (abs: string) => setOpen((o) => new Set(o.has(abs) ? [...o].filter((x) => x !== abs) : [...o, abs]))
  const ops: TreeOps = {
    marks,
    current,
    open,
    toggleDir,
    onOpen,
    renaming,
    creating,
    creatingFolder,
    dragged,
    over,
    onDragFile: setDragged,
    onOver: setOver,
    onDropOn: (dir) => {
      const from = dragged
      setDragged(undefined)
      setOver(undefined)
      if (!from || from.slice(0, from.lastIndexOf('/')) === dir || !mayChange(from)) return
      void change([from, dir], async () => onMoved(from, await api.filesMove(deskId, from, dir)))
    },
    onMenu: (e, abs, isDir, root) => (e.preventDefault(), e.stopPropagation(), setMenu({ x: e.clientX, y: e.clientY, abs, isDir, root })),
    onRename: (abs, name) => {
      setRenaming(undefined)
      if (name === undefined || name.trim() === '' || name === abs.split('/').pop() || !mayChange(abs)) return
      void change(abs, async () => onMoved(abs, await api.filesRename(deskId, abs, name)))
    },
    onCreate: (dir, name) => {
      setCreating(undefined)
      if (!name?.trim()) return
      void change(dir, async () => onOpen(await api.filesCreate(deskId, dir, name)))
    },
    onCreateFolder: (dir, name) => {
      setCreatingFolder(undefined)
      if (!name?.trim()) return
      void change(dir, async () => {
        const made = await api.filesMakeFolder(deskId, dir, name)
        setOpen((o) => new Set([...o, dir, made]))
      })
    }
  }

  const matches = filter.trim()
    ? roots.flatMap((r) => filterFiles((lists[r.path] ?? []).filter((f) => !f.endsWith('/')), filter).map((f) => ({ root: r, file: f }))).slice(0, 200)
    : []
  const name = menu?.abs.split('/').pop() ?? ''
  // where a file of scratch or notes can be kept for good: the knowledge of the Profile in view
  const knowledge = roots.find((r) => r.label === 'knowledge' && r.plain)
  return (
    <div className="file-tree-wrap" ref={wrap}>
      {movingToKnowledge && knowledge && (
        <MoveToKnowledge
          file={movingToKnowledge}
          knowledge={knowledge}
          folders={(lists[knowledge.path] ?? []).flatMap((f) => (f.endsWith('/') ? [f.slice(0, -1)] : f.includes('/') ? [f.slice(0, f.lastIndexOf('/'))] : []))}
          onCancel={() => setMovingToKnowledge(undefined)}
          onMove={(folder) => {
            const from = movingToKnowledge
            setMovingToKnowledge(undefined)
            void change([from, knowledge.path], async () => onMoved(from, await api.filesMoveInto(deskId, from, knowledge.path, folder)))
          }}
        />
      )}
      <input className="file-filter file-focus" placeholder="Find a file…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {error && <p className="error" onClick={() => setError(undefined)}>{error}</p>}
      {filter.trim() ? (
        <ul className="file-results">
          {matches.map(({ root, file }) => (
            <li
              key={root.path + file}
              title={file}
              className={current === `${root.path}/${file}` ? 'on' : ''}
              onClick={(e) => onOpen(`${root.path}/${file}`, undefined, e.metaKey)}
              onContextMenu={(e) => ops.onMenu(e, `${root.path}/${file}`, false, root)}
            >
              {renaming === `${root.path}/${file}` ? (
                <NameInput initial={file.split('/').pop() ?? ''} onDone={(name) => ops.onRename(`${root.path}/${file}`, name)} />
              ) : (
                <>
                  <span>{file.split('/').pop()}</span>
                  <span className="hint">{root.label}/{file}</span>
                </>
              )}
            </li>
          ))}
          {matches.length === 0 && <li className="empty">No file matches.</li>}
        </ul>
      ) : (
        <div className="file-tree">
          {roots.map((r) => (
            <div key={r.path}>
              <div
                className={'file-root' + (over === r.path ? ' over' : '')}
                onClick={() => toggleDir(r.path)}
                onContextMenu={(e) => ops.onMenu(e, r.path, true, r)}
                onDragOver={(e) => dragged && (e.preventDefault(), setOver(r.path))}
                onDragLeave={() => setOver(undefined)}
                onDrop={(e) => (e.preventDefault(), ops.onDropOn(r.path))}
              >
                <Chevron open={open.has(r.path)} />
                <span className="file-label">{r.label}</span>
                <RootMarkSummary m={marks[r.path]} />
              </div>
              {open.has(r.path) && (
                <>
                  {creating === r.path && <div className="file-leaf"><NameInput initial="" placeholder="new file name" onDone={(n) => ops.onCreate(r.path, n)} /></div>}
                  {creatingFolder === r.path && <div className="file-leaf"><NameInput initial="" placeholder="new folder name" onDone={(n) => ops.onCreateFolder(r.path, n)} /></div>}
                  <TreeList nodes={buildTree(lists[r.path] ?? [])} root={r} depth={1} ops={ops} />
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(undefined)}
          items={
            menu.isDir
              ? [
                  { label: 'New file…', onClick: () => (setOpen((o) => new Set([...o, menu.abs])), setCreating(menu.abs)) },
                  // git keeps no empty folders: only where the files are not in git (scratch, notes, knowledge)
                  ...(menu.root.scratch || menu.root.plain ? [{ label: 'New folder…', onClick: () => (setOpen((o) => new Set([...o, menu.abs])), setCreatingFolder(menu.abs)) }] : []),
                  // a folder of scratch, notes or knowledge (not the root itself): to the Trash, with what is in it
                  ...((menu.root.scratch || menu.root.plain) && menu.abs !== menu.root.path && mayChange(menu.abs)
                    ? [{ label: 'Delete folder…', onClick: () => window.confirm(`Move the folder “${name}” and everything in it to the Trash?`) && void change(menu.abs, async () => (await api.filesRemoveFolder(deskId, menu.abs), onMoved(menu.abs))) }]
                    : []),
                  {
                    label: 'Search in…',
                    onClick: () => {
                      const rel = menu.abs === menu.root.path ? '' : menu.abs.slice(menu.root.path.length + 1)
                      onSearchIn(rel ? `${menu.root.label}/${rel}` : menu.root.label)
                    }
                  },
                  { label: 'Copy relative path', onClick: () => void api.writeClipboard(menu.abs === menu.root.path ? '.' : rel(menu.root.path, menu.abs)) },
                  { label: 'Copy path', onClick: () => void api.writeClipboard(menu.abs) }
                ]
              : [
                  { label: 'Open', onClick: () => onOpen(menu.abs) },
                  ...(onDiff && isGitRoot(menu.root) ? [{ label: 'Diff against HEAD', onClick: () => onDiff({ path: menu.abs, rootPath: menu.root.path, mode: 'head' as const }) }] : []),
                  { label: 'Open beside', onClick: () => onOpen(menu.abs, undefined, true) },
                  ...(knowledge && (menu.root.scratch || (menu.root.plain && menu.root.label !== 'knowledge' && !isGitRoot(menu.root))) && mayChange(menu.abs) ? [{ label: 'Move to knowledge…', onClick: () => setMovingToKnowledge(menu.abs) }] : []),
                  { label: 'Duplicate', onClick: () => void change(menu.abs, async () => onOpen(await api.filesDuplicate(deskId, menu.abs))) },
                  { label: 'Rename…', onClick: () => setRenaming(menu.abs) },
                  { label: 'Delete', onClick: () => mayChange(menu.abs) && window.confirm(`Move “${name}” to the Trash?`) && void change(menu.abs, async () => (await api.filesRemove(deskId, menu.abs), onMoved(menu.abs))) },
                  { label: 'Copy relative path', onClick: () => void api.writeClipboard(rel(menu.root.path, menu.abs)) },
                  { label: 'Copy path', onClick: () => void api.writeClipboard(menu.abs) }
                ]
          }
        />
      )}
    </div>
  )
}

function TreeList({ nodes, root, depth, ops }: { nodes: TreeNode[]; root: FileRoot; depth: number; ops: TreeOps }) {
  const open = ops.open
  return (
    <ul className="file-nodes" style={{ ['--guide' as string]: `${(depth - 1) * 18 + 14}px` }}>
      {nodes.map((n) => {
        const abs = `${root.path}/${n.path}`
        return n.children ? (
          <li key={n.path}>
            <div
              className={'file-folder' + (ops.over === abs ? ' over' : '')}
              style={{ paddingLeft: depth * 18 + 6 }}
              onDragOver={(e) => ops.dragged && (e.preventDefault(), ops.onOver(abs))}
              onDragLeave={() => ops.onOver(undefined)}
              onDrop={(e) => (e.preventDefault(), ops.onDropOn(abs))}
              onClick={() => ops.toggleDir(abs)}
              onContextMenu={(e) => ops.onMenu(e, abs, true, root)}
            >
              <Chevron open={open.has(abs) || ops.creating === abs || ops.creatingFolder === abs} />
              <span className="file-label">{n.name}</span>
              <Marks m={ops.marks?.[root.path]} path={n.path} folder />
            </div>
            {(open.has(abs) || ops.creating === abs || ops.creatingFolder === abs) && (
              <>
                {ops.creating === abs && <div className="file-leaf" style={{ paddingLeft: (depth + 1) * 18 + 6 }}><NameInput initial="" placeholder="new file name" onDone={(name) => ops.onCreate(abs, name)} /></div>}
                {ops.creatingFolder === abs && <div className="file-leaf" style={{ paddingLeft: (depth + 1) * 18 + 6 }}><NameInput initial="" placeholder="new folder name" onDone={(name) => ops.onCreateFolder(abs, name)} /></div>}
                <TreeList nodes={n.children} root={root} depth={depth + 1} ops={ops} />
              </>
            )}
          </li>
        ) : (
          <li key={n.path}>
            {ops.renaming === abs ? (
              <div className="file-leaf" style={{ paddingLeft: depth * 18 + 6 }}>
                <NameInput initial={n.name} onDone={(name) => ops.onRename(abs, name)} />
              </div>
            ) : (
              <div
                className={'file-leaf' + (ops.current === abs ? ' on' : '')}
                style={{ paddingLeft: depth * 18 + 6 }}
                title={n.path}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', abs)
                  ops.onDragFile(abs)
                }}
                onDragEnd={() => (ops.onDragFile(undefined), ops.onOver(undefined))}
                onClick={(e) => ops.onOpen(abs, undefined, e.metaKey)}
                onContextMenu={(e) => ops.onMenu(e, abs, false, root)}
              >
                <FileIcon name={n.name} />
                <span className="file-label">{n.name}</span>
                <Marks m={ops.marks?.[root.path]} path={n.path} />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** The text of a result with what was searched for marked. */
export function highlight(line: string, text: string, regex: boolean, caseSensitive: boolean): ReactNode {
  let re: RegExp
  try {
    re = new RegExp(regex ? text : text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi')
  } catch {
    return line
  }
  const out: ReactNode[] = []
  let last = 0
  for (const m of line.matchAll(re)) {
    if (m[0] === '') continue
    if (m.index > last) out.push(line.slice(last, m.index))
    out.push(<mark key={m.index}>{m[0]}</mark>)
    last = m.index + m[0].length
  }
  out.push(line.slice(last))
  return out
}

function SearchTab({ deskId, roots: allRoots, searchIn, onSearchIn, onOpen }: { deskId: string; roots: FileRoot[]; searchIn: string; onSearchIn: (where: string) => void; onOpen: (path: string, line?: number, beside?: boolean) => void }) {
  const api = window.workdesk
  const roots = searchRoots(allRoots, searchIn)
  // the folders to suggest, read when the field is first used
  const [folders, setFolders] = useState<string[]>()
  const suggest = () => {
    if (folders) return
    setFolders([])
    void Promise.all(allRoots.map((r) => api.filesList(deskId, r.path).then((l) => foldersOf(r.label, l), () => [r.label]))).then((all) => setFolders(all.flat()))
  }
  const [text, setText] = useState('')
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [glob, setGlob] = useState('')
  const [hits, setHits] = useState<{ root: FileRoot; hits: SearchHit[] }[]>([])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const run = useRef(0)
  const rootsKey = roots.map((r) => r.path).join('|')

  useEffect(() => {
    if (!text) {
      setHits([])
      setError(undefined)
      return
    }
    const mine = ++run.current
    const timer = setTimeout(() => {
      setBusy(true)
      void Promise.all(roots.map((r) => api.filesSearch(deskId, r.path, { text, regex, caseSensitive, glob }).then((h) => ({ root: r, hits: h, error: undefined as string | undefined }), (e: Error) => ({ root: r, hits: [] as SearchHit[], error: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })))).then((all) => {
        if (run.current !== mine) return
        setBusy(false)
        setError(all.find((a) => a.error)?.error)
        setHits(all.filter((a) => a.hits.length > 0))
      })
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, regex, caseSensitive, glob, rootsKey, deskId])

  // the files and folders of the results that are folded
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const toggle = (k: string) => setFolded((f) => new Set(f.has(k) ? [...f].filter((x) => x !== k) : [...f, k]))
  const total = hits.reduce((n, h) => n + h.hits.length, 0)
  const byFile = (h: SearchHit[]): [string, SearchHit[]][] => {
    const m = new Map<string, SearchHit[]>()
    for (const x of h) m.set(x.path, [...(m.get(x.path) ?? []), x])
    return [...m]
  }
  return (
    <div className="file-search">
      <div className="file-search-row">
        <input className="file-filter file-focus" autoFocus placeholder="Search…" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="button" className={'toggle' + (regex ? ' on' : '')} title="Regular expression" onClick={() => setRegex(!regex)}>.*</button>
        <button type="button" className={'toggle' + (caseSensitive ? ' on' : '')} title="Match case" onClick={() => setCaseSensitive(!caseSensitive)}>Aa</button>
      </div>
      <div className="file-search-row">
        <input
          className="file-filter"
          list="file-search-in"
          placeholder="Search in… (everywhere, or a folder such as knowledge/sub)"
          title="Where to look: empty is every folder of the tree; a folder path starts at the names of the tree's roots"
          value={searchIn}
          onFocus={suggest}
          onChange={(e) => onSearchIn(e.target.value)}
        />
        {searchIn && <button type="button" title="Search everywhere again" onClick={() => onSearchIn('')}>✕</button>}
        <datalist id="file-search-in">{(folders && folders.length > 0 ? folders : allRoots.map((r) => r.label)).slice(0, 3000).map((f) => <option key={f} value={f} />)}</datalist>
      </div>
      {searchIn.trim() && roots.length === 0 && <p className="hint">No folder “{searchIn.trim()}”.</p>}
      <input className="file-filter" placeholder="Files, e.g. *.ts, src/**/*.tsx, !dist/**" value={glob} onChange={(e) => setGlob(e.target.value)} />
      {error && <p className="error">{error}</p>}
      {text && !error && <p className="hint">{busy ? 'Searching…' : `${total}${total >= 500 ? '+' : ''} result${total === 1 ? '' : 's'}`}</p>}
      <div className="file-hits">
        {hits.map(({ root, hits: list }) => (
          <div key={root.path}>
            <div className="file-hit-root" onClick={() => toggle(root.path)}>
              <Chevron open={!folded.has(root.path)} />
              <span className="file-label">{root.label}</span>
              <span className="file-count">{list.length}</span>
            </div>
            {!folded.has(root.path) &&
              byFile(list).map(([file, fileHits]) => {
                const key = root.path + '/' + file
                const name = file.slice(file.lastIndexOf('/') + 1)
                return (
                  <div key={key} className="file-hit-group">
                    <div className="file-hit-file" title={`${root.label}/${file}`} style={{ paddingLeft: 24 }} onClick={() => toggle(key)}>
                      <Chevron open={!folded.has(key)} />
                      <FileIcon name={name} />
                      <span className="file-label">{name}</span>
                      <span className="hint">{file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : root.label}</span>
                      <span className="file-count">{fileHits.length}</span>
                    </div>
                    {!folded.has(key) &&
                      fileHits.map((h) => (
                        <div key={h.line} className="file-hit" title={`line ${h.line}`} onClick={(e) => onOpen(`${root.path}/${file}`, h.line, e.metaKey)}>
                          <span className="file-hit-text">{highlight(h.text.trim(), text, regex, caseSensitive)}</span>
                        </div>
                      ))}
                  </div>
                )
              })}
          </div>
        ))}
      </div>
    </div>
  )
}


/** Moves a file of scratch or notes into the knowledge: the folder is typed (`payments`, `payments/specs`; empty is the top), made when it is not there. */
function MoveToKnowledge({ file, knowledge, folders, onMove, onCancel }: { file: string; knowledge: FileRoot; folders: string[]; onMove: (folder: string) => void; onCancel: () => void }) {
  const [folder, setFolder] = useState('')
  const known = [...new Set(folders.flatMap((f) => f.split('/').map((_, i, a) => a.slice(0, i + 1).join('/'))))].sort()
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault()
          onMove(folder)
        }}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <h3>Move to knowledge</h3>
        <p className="hint">{file.split('/').pop()} goes into the {knowledge.label} of the Status Repo, where it is kept and committed. A new folder is made when it is not there yet, e.g. one per topic.</p>
        <label className="field">
          <span>Folder in knowledge (empty: the top)</span>
          <input autoFocus list="knowledge-folders" value={folder} placeholder="payments" onChange={(e) => setFolder(e.target.value)} />
          <datalist id="knowledge-folders">
            {known.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary">Move</button>
        </div>
      </form>
    </div>
  )
}
