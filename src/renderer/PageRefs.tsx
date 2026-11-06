import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { AppState } from '../shared/api'
import { attachableTodos, filterTodos, hasRef, markdownLink, refLabel, hostOf, type PageRef } from '../main/domain/page-refs'
import type { Todo } from '../main/domain/types'
import { ContextMenu } from './ContextMenu'
import { ICONS } from './Icons'
import { useOpenLink } from './OpenLink'
import { usePaletteCommands, type Command } from './command-palette'
import './page-refs.css'

export type RefTarget = { kind: 'desk' | 'todo'; id: string }
export interface RefPage {
  url: string
  title?: string
  favicon?: string
}

/** What a browser pane inside a WorkDesk can attach a page to: the WorkDesk itself, or one of its open Todos. */
export interface AttachTargets {
  deskId: string
  deskName: string
  deskRefs: PageRef[] | undefined
  todos: Todo[]
  attach: (target: RefTarget, page: RefPage) => Promise<void>
}
export const AttachContext = createContext<AttachTargets | undefined>(undefined)

/** The attach targets of a WorkDesk, for its panes. */
export function attachTargets(desk: { id: string; name: string; refs?: PageRef[] }, state: AppState, run: (action: () => Promise<AppState>) => Promise<void>): AttachTargets {
  const open = attachableTodos(state.todos, desk.id)
  return {
    deskId: desk.id,
    deskName: desk.name,
    deskRefs: desk.refs,
    todos: open,
    attach: (target, page) => run(() => window.workdesk.addPageRef(target, page))
  }
}

// Of the browser panes that are mounted (hidden WorkDesks stay mounted), the palette is for the one you used last
let lastUsed: object | undefined
const usedListeners = new Set<() => void>()
const markUsed = (token: object): void => {
  if (lastUsed === token) return
  lastUsed = token
  usedListeners.forEach((l) => l())
}

const isWeb = (url: string): boolean => /^https?:\/\//i.test(url)

/** The "…" menu of a browser pane's address bar: copy the URL as a Markdown link, attach the page to the WorkDesk or to a Todo. Also offers them to the command palette while the pane is the one in use. */
export function PageMenu({ url, title, favicon, pageId }: { url: string; title?: string; favicon?: string; pageId?: number }) {
  const targets = useContext(AttachContext)
  const button = useRef<HTMLButtonElement>(null)
  const token = useRef({}).current
  const [menu, setMenu] = useState<{ x: number; y: number; kind: 'main' | 'todos' }>()
  const [note, setNote] = useState<string>()
  const [mine, setMine] = useState(false)
  const [inView, setInView] = useState(false)

  // the pane (the .browser around the bar) was used: its address bar, its page, a click
  useEffect(() => {
    const root = button.current?.closest('.browser')
    if (!root) return
    const sync = () => setMine(lastUsed === token)
    usedListeners.add(sync)
    if (!lastUsed) markUsed(token)
    sync()
    const use = () => markUsed(token)
    root.addEventListener('focusin', use)
    root.addEventListener('mousedown', use, true)
    const seen = new IntersectionObserver(([e]) => setInView(e.isIntersecting))
    seen.observe(root)
    return () => {
      usedListeners.delete(sync)
      root.removeEventListener('focusin', use)
      root.removeEventListener('mousedown', use, true)
      seen.disconnect()
      if (lastUsed === token) lastUsed = undefined
    }
  }, [token])

  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(undefined), 1800)
    return () => clearTimeout(t)
  }, [note])

  const web = isWeb(url)
  // the page's own right-click menu (main process) offers attaching only inside a WorkDesk, and asks this pane to carry it out
  const deskName = targets?.deskName
  useEffect(() => {
    if (pageId === undefined) return
    void window.workdesk.setPageAttachable(pageId, deskName ?? null)
    return () => void window.workdesk.setPageAttachable(pageId, null)
  }, [pageId, deskName])
  const latest = useRef<{ attach: (t: RefTarget, w: string) => void; pick: () => void }>({ attach: () => undefined, pick: () => undefined })
  useEffect(
    () =>
      window.workdesk.onPageMenuAction((id, action) => {
        if (id !== pageId || !targets) return
        if (action === 'attach-desk') latest.current.attach({ kind: 'desk', id: targets.deskId }, targets.deskName)
        else latest.current.pick()
      }),
    [pageId, targets?.deskId, targets?.deskName] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const page: RefPage = { url, title, favicon }
  const here = () => {
    const r = button.current?.getBoundingClientRect()
    return { x: r ? r.right - 220 : 200, y: r ? r.bottom + 2 : 60 }
  }
  const copy = () => {
    if (!web) return
    void navigator.clipboard.writeText(markdownLink(url, title)).then(
      () => setNote('Copied as Markdown link'),
      () => setNote('Could not copy')
    )
  }
  const attach = (target: RefTarget, what: string) => {
    if (!targets) return
    void targets.attach(target, page).then(
      () => setNote(`Attached to ${what}`),
      (e: Error) => setNote(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    )
  }
  const attached = !!targets && hasRef(targets.deskRefs, url)
  latest.current = { attach, pick: () => setMenu({ ...here(), kind: 'todos' }) }

  const palette: Command[] =
    mine && inView && web
      ? [
          { id: 'page-copy-md', title: 'Copy URL as Markdown link', group: 'Page', hint: title || hostOf(url), keywords: 'copy markdown link url title address clipboard', run: copy },
          ...(targets
            ? [
                { id: 'page-attach-desk', title: `Attach this page to ${targets.deskName}`, group: 'Page', hint: title || hostOf(url), keywords: 'reference pin keep link workdesk', run: () => attach({ kind: 'desk', id: targets.deskId }, targets.deskName) } as Command,
                { id: 'page-attach-todo', title: 'Attach this page to a Todo…', group: 'Page', keywords: 'reference pin keep link', run: () => setMenu({ ...here(), kind: 'todos' }) } as Command
              ]
            : [])
        ]
      : []
  usePaletteCommands(`page:${tokenId(token)}`, palette)

  return (
    <>
      <button
        ref={button}
        type="button"
        className={'page-menu-btn' + (note ? ' noted' : '')}
        title={note ?? 'Copy the URL as a Markdown link, attach this page to the WorkDesk or to a Todo'}
        onClick={() => setMenu({ ...here(), kind: 'main' })}
      >
        {note ? '✓' : '⋯'}
      </button>
      {note && <span className="page-note" role="status">{note}</span>}
      {menu?.kind === 'main' && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(undefined)}
          items={[
            { label: 'Copy URL as Markdown link', onClick: copy, disabled: !web, why: 'Only web pages' },
            ...(targets
              ? [
                  { label: attached ? `Attached to ${targets.deskName}` : `Attach to ${targets.deskName}`, onClick: () => attach({ kind: 'desk', id: targets.deskId }, targets.deskName), disabled: !web || attached, why: attached ? 'This page is attached already' : 'Only web pages can be attached' },
                  { label: 'Attach to a Todo…', onClick: () => setTimeout(() => setMenu({ ...menu, kind: 'todos' }), 0), disabled: !web, why: 'Only web pages can be attached' }
                ]
              : [])
          ]}
        />
      )}
      {menu?.kind === 'todos' && targets && (
        <TodoPicker
          todos={targets.todos}
          deskId={targets.deskId}
          url={url}
          onCancel={() => setMenu(undefined)}
          onPick={(t) => (setMenu(undefined), attach({ kind: 'todo', id: t.id }, 'the Todo'))}
        />
      )}
    </>
  )
}

let nextToken = 0
const ids = new WeakMap<object, number>()
function tokenId(token: object): number {
  let id = ids.get(token)
  if (id === undefined) ids.set(token, (id = ++nextToken))
  return id
}

/** The pages attached to a WorkDesk or a Todo: a click opens one (as a browser tab of the WorkDesk), × detaches it. */
export function PageRefsPanel({ target, refs, run, onOpen, bare }: { target: RefTarget; refs: PageRef[] | undefined; run: (action: () => Promise<AppState>) => Promise<void>; onOpen?: (url: string) => void; bare?: boolean }) {
  const openLink = useOpenLink()
  const open = onOpen ?? openLink
  const list = refs ?? []
  const body = list.length === 0 ? (
    <p className="hint">Attach a page from the “⋯” menu in the address bar of a browser tab.</p>
  ) : (
    <ul className="page-refs">
      {list.map((r) => (
        <li key={r.id} className="page-ref" title={r.url} onClick={() => open(r.url)}>
          <span className="page-ref-icon">{r.favicon ? <img src={r.favicon} alt="" width={14} height={14} onError={(e) => (e.currentTarget.style.display = 'none')} /> : ICONS.globe}</span>
          <span className="page-ref-title">{refLabel(r)}</span>
          <span className="page-ref-host">{hostOf(r.url)}</span>
          <button className="x" title="Detach this page" onClick={(e) => (e.stopPropagation(), void run(() => window.workdesk.removePageRef(target, r.id)))}>×</button>
        </li>
      ))}
    </ul>
  )
  if (bare) return <div className="page-refs-box">{body}</div>
  return (
    <section className="panel page-refs-panel">
      <h3>Pages ({list.length})</h3>
      {body}
    </section>
  )
}

/** Which Todo a page is attached to: the Todos of the WorkDesk, then loose ones; a search field filters when the list is long. */
function TodoPicker({ todos, deskId, url, onPick, onCancel }: { todos: Todo[]; deskId: string; url: string; onPick: (t: Todo) => void; onCancel: () => void }) {
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const shown = filterTodos(todos, query)
  const cursor = Math.min(at, Math.max(shown.length - 1, 0))
  const pick = (t: Todo | undefined) => t && !hasRef(t.refs, url) && onPick(t)
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal palette" role="dialog" aria-label="Attach to a Todo">
        <input
          autoFocus
          className="palette-input"
          placeholder={todos.length > 8 ? 'Attach this page to a Todo… (type to search)' : 'Attach this page to a Todo…'}
          value={query}
          onChange={(e) => (setQuery(e.target.value), setAt(0))}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
            else if (e.key === 'Enter') pick(shown[cursor])
            else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) setAt(Math.min(shown.length - 1, cursor + 1))
            else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) setAt(Math.max(0, cursor - 1))
            else return
            e.preventDefault()
            e.stopPropagation()
          }}
        />
        <ul className="palette-list" role="listbox">
          {shown.map((t, i) => (
            <li key={t.id} role="option" aria-selected={i === cursor} className={i === cursor ? 'selected' : ''} onMouseMove={() => i !== cursor && setAt(i)} onClick={() => pick(t)}>
              <span className="palette-title">{hasRef(t.refs, url) ? '✓ ' : ''}{t.title}</span>
              <span className="palette-hint">{t.deskId === deskId ? 'this WorkDesk' : t.list === 'today' ? 'Today' : 'Todo'}</span>
            </li>
          ))}
          {shown.length === 0 && <li className="empty">{todos.length === 0 ? 'No open Todos. Add one to the WorkDesk or to Today first.' : 'No Todo matches.'}</li>}
        </ul>
      </div>
    </div>
  )
}
