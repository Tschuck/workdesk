import { useEffect, useRef, useState } from 'react'
import './editor-git.css'
import { attachComments, type CommentsHost } from './review-comments'
import { toggleFileWrap, useFileWrap } from './file-wrap'
import { ICONS } from './Icons'
import { ContextMenu } from './ContextMenu'

type MonacoApi = (typeof import('./monaco-setup'))['monaco']

export type DiffMode = 'head' | 'review'

export interface DiffRequest {
  /** absolute path of the file (the working tree's version is on the right) */
  path: string
  /** the folder (Branch) it belongs to */
  rootPath: string
  mode: DiffMode
  /** the file's name before a rename (review mode) */
  oldPath?: string
  /** what the left side is called in the title (the base branch in review mode) */
  baseLabel?: string
  /** a line (of the right side) to show */
  line?: number
}

interface Props {
  deskId: string
  request: DiffRequest
  /** line comments on the right side; none: the gutter is plain */
  comments?: CommentsHost
  /** changes when the comments changed elsewhere */
  commentsKey?: unknown
  onEdit: (line: number) => void
  onClose: () => void
  /** told when the right side has changes that are not saved (to ask before the file is left) */
  onDirty?: (dirty: boolean) => void
}

/** The file against HEAD (or the merge base): Monaco's diff editor, the working tree on the right. It can be edited here (⌘S saves); the left side is read-only. */
export function DiffView({ deskId, request, comments, commentsKey, onEdit, onClose, onDirty }: Props) {
  const baseLabel = request.baseLabel ?? (request.mode === 'head' ? 'HEAD' : 'base')
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string>()
  const [note, setNote] = useState<string>()
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  const onDirtyRef = useRef(onDirty)
  onDirtyRef.current = onDirty
  useEffect(() => {
    onDirtyRef.current?.(dirty)
  }, [dirty])
  // leaving the file takes the flag with it
  useEffect(
    () => () => {
      onDirtyRef.current?.(false)
    },
    []
  )
  const [inline, setInline] = useState(false)
  const [titleMenu, setTitleMenu] = useState<{ x: number; y: number }>()
  const requestRef = useRef(request)
  requestRef.current = request
  // the map at the right edge: where the changes are in the whole file; kept on this machine
  const [mini, setMini] = useState(() => {
    try {
      return localStorage.getItem('workdesk.diffMinimap') !== '0'
    } catch {
      return true
    }
  })
  const miniRef = useRef(mini)
  miniRef.current = mini
  // word wrap is the one setting of the File panes (⌥Z, the icon in the file bar)
  const wrap = useFileWrap()
  const wrapRef = useRef(wrap)
  wrapRef.current = wrap
  const diff = useRef<ReturnType<MonacoApi['editor']['createDiffEditor']> | undefined>(undefined)
  const attached = useRef<{ refresh: () => void; dispose: () => void } | undefined>(undefined)
  const commentsRef = useRef(comments)
  commentsRef.current = comments

  useEffect(() => {
    let live = true
    let cleanup = () => undefined as void
    setError(undefined)
    setNote(undefined)
    void (async () => {
      const api = window.workdesk
      const [{ monaco: m, prepareCodeModel }, original, modified] = await Promise.all([
        import('./monaco-setup'),
        (request.mode === 'head'
          ? api.gitHead(deskId, request.rootPath, request.path)
          : api.reviewBaseFile(deskId, request.rootPath, request.oldPath ?? request.path)),
        api.filesRead(deskId, request.path).catch(() => ({ content: '', size: 0, refused: undefined }))
      ])
      if (!live || !host.current) return
      if (original.refused || modified.refused) setNote('One side is binary or too large: the diff shows what could be read.')
      const ed = m.editor.createDiffEditor(host.current, {
        theme: 'workdesk',
        automaticLayout: true,
        readOnly: false,
        originalEditable: false,
        renderSideBySide: !inline,
        // Monaco switches to one column by itself when the editor is narrow; the button decides here
        useInlineViewWhenSpaceIsLimited: false,
        minimap: { enabled: miniRef.current, renderCharacters: false, maxColumn: 60, showSlider: 'always' },
        fontSize: 13,
        wordWrap: wrapRef.current ? 'on' : 'off',
        fontFamily: 'ui-monospace, Menlo, monospace',
        scrollBeyondLastLine: false,
        glyphMargin: !!commentsRef.current,
        renderOverviewRuler: true
      })
      diff.current = ed
      // the path of the file, from the right-click menu of the lines
      // the relative path comes with the right-clicked line: `path:line`
      const copy = (relative: boolean, line?: number) => {
        const r = requestRef.current
        void api.writeClipboard((relative && r.path.startsWith(r.rootPath + '/') ? r.path.slice(r.rootPath.length + 1) : r.path) + (relative && line ? `:${line}` : ''))
      }
      ed.getModifiedEditor().addAction({ id: 'workdesk.copy-relative-path', label: 'Copy Relative Path', contextMenuGroupId: '9_cutcopypaste', contextMenuOrder: 10, run: (e) => copy(true, e.getPosition()?.lineNumber) })
      ed.getModifiedEditor().addAction({ id: 'workdesk.copy-path', label: 'Copy Path', contextMenuGroupId: '9_cutcopypaste', contextMenuOrder: 11, run: () => copy(false) })
      const left = m.editor.createModel(original.content, undefined, m.Uri.from({ scheme: 'workdesk-base', path: request.path }))
      const right = m.editor.createModel(modified.content, undefined, m.Uri.from({ scheme: 'workdesk-work', path: request.path }))
      ed.setModel({ original: left, modified: right })
      // saved as in the File pane: only on ⌘S, to the file of the Branch folder
      let saved = right.getAlternativeVersionId()
      const sub = right.onDidChangeContent(() => setDirty(right.getAlternativeVersionId() !== saved))
      ed.getModifiedEditor().addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => {
        void api.filesWrite(deskId, requestRef.current.path, right.getValue()).then(
          () => {
            saved = right.getAlternativeVersionId()
            setDirty(false)
            setError(undefined)
          },
          (e: Error) => setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
        )
      })
      if (request.line) ed.getModifiedEditor().revealLineInCenter(request.line)
      void prepareCodeModel(left).catch(() => undefined)
      void prepareCodeModel(right).catch(() => undefined)
      if (commentsRef.current) {
        attached.current = attachComments(m, ed.getModifiedEditor(), {
          comments: () => commentsRef.current?.comments() ?? [],
          onAdd: (l, t) => commentsRef.current!.onAdd(l, t),
          onUpdate: (i, t) => commentsRef.current!.onUpdate(i, t),
          onRemove: (i) => commentsRef.current!.onRemove(i),
          onError: (e) => setError(e)
        })
      }
      cleanup = () => {
        sub.dispose()
        attached.current?.dispose()
        attached.current = undefined
        ed.dispose()
        left.dispose()
        right.dispose()
        diff.current = undefined
      }
    })().catch((e: Error) => live && setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
    return () => {
      live = false
      cleanup()
    }
    // the editor is made again for another file or another comparison
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deskId, request.path, request.rootPath, request.mode, request.oldPath])

  useEffect(() => attached.current?.refresh(), [commentsKey])
  // a comment was picked in the list: its line is shown
  useEffect(() => {
    const line = request.line
    if (!line) return
    const t = setTimeout(() => diff.current?.getModifiedEditor().revealLineInCenter(line), 150)
    return () => clearTimeout(t)
  }, [request.line, request.path, request.mode])
  useEffect(() => diff.current?.updateOptions({ renderSideBySide: !inline }), [inline])
  useEffect(() => diff.current?.updateOptions({ wordWrap: wrap ? 'on' : 'off' }), [wrap])
  useEffect(() => diff.current?.updateOptions({ minimap: { enabled: mini, renderCharacters: false, maxColumn: 60, showSlider: 'always' } }), [mini])

  const name = request.path.split('/').pop()
  return (
    <div
      className="diff-view"
      onKeyDownCapture={(e) => {
        // ⌥Z: word wrap, as in the File panes
        if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyZ') (e.preventDefault(), e.stopPropagation(), toggleFileWrap())
      }}
    >
      {titleMenu && (
        <ContextMenu
          x={titleMenu.x}
          y={titleMenu.y}
          onClose={() => setTitleMenu(undefined)}
          items={[
            { label: 'Copy relative path', onClick: () => void window.workdesk.writeClipboard(request.path.startsWith(request.rootPath + '/') ? request.path.slice(request.rootPath.length + 1) : request.path) },
            { label: 'Copy path', onClick: () => void window.workdesk.writeClipboard(request.path) }
          ]}
        />
      )}
      <div className="diff-bar">
        <span className="diff-title" title={request.path} onContextMenu={(e) => (e.preventDefault(), setTitleMenu({ x: e.clientX, y: e.clientY }))}>{name}{dirty ? ' ●' : ''} <span className="hint">{baseLabel} ↔ working tree</span></span>
        <span className="file-spacer" />
        <button type="button" className={'icon-toggle' + (wrap ? ' on' : '')} title={wrap ? 'Word wrap is on (⌥Z)' : 'Word wrap is off (⌥Z)'} aria-pressed={wrap} onClick={() => toggleFileWrap()}>{ICONS.wrap}</button>
        <button
          type="button"
          className={mini ? 'on' : ''}
          title={mini ? 'Hide the map of the changes at the right edge' : 'Show a map of the file at the right edge, with the changes marked'}
          onClick={() => {
            setMini(!mini)
            try {
              localStorage.setItem('workdesk.diffMinimap', mini ? '0' : '1')
            } catch {
              /* not remembered */
            }
          }}
        >
          Map
        </button>
        <button type="button" title="One column instead of two" className={inline ? 'on' : ''} onClick={() => setInline(!inline)}>Inline</button>
        <button type="button" title="Back to the editor, at the line of the cursor" onClick={() => (!dirtyRef.current || window.confirm('This file has changes that are not saved (⌘S). Go on and lose them?')) && onEdit(diff.current?.getModifiedEditor().getPosition()?.lineNumber ?? 1)}>Open in editor</button>
        <button type="button" title="Close the diff" onClick={() => (!dirtyRef.current || window.confirm('This file has changes that are not saved (⌘S). Close and lose them?')) && onClose()}>Close diff</button>
      </div>
      {note && <p className="file-note">{note}</p>}
      {error && <p className="file-note error">{error}</p>}
      <div className="diff-host" ref={host} />
    </div>
  )
}
