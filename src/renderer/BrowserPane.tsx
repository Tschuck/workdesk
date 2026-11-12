import { useContext, useEffect, useRef, useState } from 'react'
import { describePartition, partitionFor, partitionForUrl, isSitePartition, resolvePartition, sessionsFor, SITE_PARTITION, type BrowserSession, type BrowserSessionsConfig } from '../main/domain/browser-sessions'
import { normalizeUrl } from '../main/domain/url'
import { getSearchEngine } from './search-engine'
import { BookmarkControls, BookmarkStart } from './Bookmarks'
import { SplitPicker } from './SplitPicker'
import { isCertificateError, SecurityInfo, type LoadFailure } from './SecurityInfo'
import { SiteSettings } from './SiteSettings'
import { FindBar, type Findable } from './FindBar'
import { ContextMenu } from './ContextMenu'
import { loadBrowserSessions, setBrowserSessions, useBrowserSessions } from './browser-sessions'
import { OpenLinkContext } from './OpenLink'
import { PageMenu } from './PageRefs'
import { restoreScroll } from './tab-hibernation'

interface Props {
  url: string
  /** the Pane, to put a page that was unloaded back where it was scrolled to */
  paneId?: string
  /** what the session picked for a domain of several sessions is kept under: the Pane, or the Tab of the Browser page */
  rememberKey?: string
  /** where the page is now, with its title and icon (saved by the caller) */
  onLocation: (location: { url: string; title?: string; favicon?: string }) => void
}

interface WebviewElement extends HTMLElement {
  loadURL(url: string): Promise<void>
  goBack(): void
  canGoBack(): boolean
  goForward(): void
  reload(): void
  getURL(): string
  getTitle(): string
  getWebContentsId(): number
}

/** A web page in a Pane. It runs in the session of its domain (see Settings → Browser sessions); the others share one. */
export function BrowserPane(props: Props) {
  const config = useBrowserSessions()
  // the session of a page is fixed when it is created, so the rules are needed first
  return config ? <Gate {...props} config={config} /> : <div className="browser" />
}

const sessionKey = (key?: string): string => `workdesk.pageSession.${key ?? ''}`
const rememberedSession = (key?: string): string | undefined => {
  if (!key) return undefined
  try {
    return localStorage.getItem(sessionKey(key)) ?? undefined
  } catch {
    return undefined
  }
}
const rememberSession = (key: string | undefined, id: string): void => {
  if (!key) return
  try {
    localStorage.setItem(sessionKey(key), id)
  } catch {
    /* not remembered */
  }
}

/**
 * A domain can be in several sessions (a private and a work login of the same site). A page that opens on such a domain asks which one
 * before anything is loaded; what was picked is kept for this Pane or Tab, so it opens there again after a restart.
 */
function Gate(props: Props & { config: BrowserSessionsConfig }) {
  const key = props.rememberKey ?? props.paneId
  const options = sessionsFor(props.config, props.url)
  const [chosen, setChosen] = useState<string | undefined>(() => {
    const id = rememberedSession(key)
    return options.length > 1 && options.some((s) => s.id === id) ? partitionFor(id!) : undefined
  })
  if (options.length > 1 && !chosen) {
    return (
      <div className="browser">
        <SessionChoice url={props.url} options={options} onPick={(s) => (rememberSession(key, s.id), setChosen(partitionFor(s.id)))} />
      </div>
    )
  }
  return <Page {...props} config={props.config} initialPartition={chosen} />
}

/** Which of the sessions that name an address should it open in? */
function SessionChoice({ url, options, onPick, onCancel }: { url: string; options: BrowserSession[]; onPick: (s: BrowserSession) => void; onCancel?: () => void }) {
  let host = url
  try {
    host = new URL(url).hostname
  } catch {
    // keep the address
  }
  return (
    <div className="session-choice" role="dialog" aria-label="Choose the session">
      <p>
        <strong>{host}</strong> is in more than one session. Which one should open it?
      </p>
      <div className="session-choice-options">
        {options.map((s) => (
          <button key={s.id} type="button" className="primary" autoFocus={s === options[0]} onClick={() => onPick(s)}>
            {s.name}
          </button>
        ))}
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

function Page({ url, paneId, rememberKey, onLocation, config, initialPartition }: Props & { config: BrowserSessionsConfig; initialPartition?: string }) {
  const view = useRef<WebviewElement>(null)
  const blank = url === 'about:blank'
  const [address, setAddress] = useState(blank ? '' : url)
  const [title, setTitle] = useState('')
  // typing in the address bar opens the picker (favorites, visited pages, addresses, searches) with what was typed; the bar itself keeps its address
  const [omni, setOmni] = useState<string>()
  const addressInput = useRef<HTMLInputElement>(null)
  const [favicon, setFavicon] = useState<string>()
  // Command+F: search in the page
  const [finding, setFinding] = useState(false)
  // a small progress bar under the address while the page loads, and why a page did not load
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>('idle')
  const [failure, setFailure] = useState<LoadFailure>()
  // the page is on the block list: this page says so, and offers a pass for it
  const [blocked, setBlocked] = useState<{ url: string; rule: string }>()
  // the page was moved to another session because the address it went to belongs to that session
  const [moved, setMoved] = useState<{ host: string; url: string; from: { id?: string; name: string }; to: { id?: string; name: string }; note?: string }>()
  useEffect(() => {
    if (phase !== 'done') return
    const t = setTimeout(() => setPhase('idle'), 700)
    return () => clearTimeout(t)
  }, [phase])
  const [current, setCurrent] = useState(url)
  // the id of the page's web contents, once it is attached: which tab the extension buttons are for
  const [pageId, setPageId] = useState<number>()
  // the page and its session; a page that has to change session is a new web view (n)
  const [target, setTarget] = useState({ url, partition: initialPartition ?? partitionForUrl(config, url), n: 0 })
  // an address that several sessions name, while the page is in none of them: asked before it loads
  // the list of sessions under the session label
  const [sessionMenu, setSessionMenu] = useState<{ x: number; y: number }>()
  const [asking, setAsking] = useState<{ to: string; options: BrowserSession[]; fromBack: boolean }>()
  const configRef = useRef(config)
  configRef.current = config
  const targetRef = useRef(target)
  // pages left behind when a link moved the page to another session (a new web view with an empty history)
  const earlier = useRef<string[]>([])
  const goBack = () => {
    const v = view.current
    try {
      if (v?.canGoBack()) return v.goBack()
    } catch {
      // not attached yet
    }
    const prev = earlier.current.pop()
    if (prev) go(prev, true)
  }
  targetRef.current = target
  const locate = useRef(onLocation)
  locate.current = onLocation
  // inside a WorkDesk a link opened with the middle mouse button becomes a Tab of it
  const openTab = useContext(OpenLinkContext)
  const openTabRef = useRef(openTab)
  openTabRef.current = openTab

  /** Opens an address here: in this web view, or in a new one when its domain has another session. */
  const go = (to: string, fromBack = false, picked?: BrowserSession, announce = false) => {
    const t = targetRef.current
    let partition: string
    if (picked) {
      partition = partitionFor(picked.id)
      rememberSession(rememberKey ?? paneId, picked.id)
    } else {
      const choice = /^https?:/i.test(to) ? resolvePartition(configRef.current, to, t.partition) : { partition: t.partition }
      if ('ask' in choice) return setAsking({ to, options: choice.ask, fromBack })
      partition = choice.partition
    }
    if (/^https?:/i.test(to) && partition !== t.partition) {
      // a new web view has no history: the page it came from is kept here, for the back button
      if (!fromBack) {
        try {
          const was = view.current?.getURL()
          if (was && was !== 'about:blank') earlier.current.push(was)
        } catch {
          // not attached yet
        }
      }
      // the page was sent to another session by a link or a redirect (nobody was asked): say so, and why a login can start over
      if (announce && !picked) {
        const cfg = configRef.current
        const nameOf = (p: string): { id?: string; name: string } => {
          const s = cfg.sessions.find((x) => partitionFor(x.id) === p)
          return { id: s?.id, name: s?.name ?? (isSitePartition(p) ? p.slice(SITE_PARTITION.length) : 'Shared session') }
        }
        let host = to
        try {
          host = new URL(to).hostname
        } catch {
          // keep the address
        }
        setMoved({ host, url: to, from: nameOf(t.partition), to: nameOf(partition) })
      }
      setCurrent(to)
      setAddress(to)
      setTarget({ url: to, partition, n: t.n + 1 })
    } else void view.current?.loadURL(to)
  }

  useEffect(() => {
    const el = view.current!
    const offTab = window.workdesk.onOpenTab((id, link) => {
      try {
        if (el.getWebContentsId() === id) openTabRef.current?.(link)
      } catch {
        // the page is not attached (yet)
      }
    })
    const offSwitch = window.workdesk.onSwitchSession((id, to) => {
      try {
        if (el.getWebContentsId() !== id) return
        // the page only moves when no question is asked and the session really changes; `go` says so then
        go(to, false, undefined, true)
      } catch {
        // the page is not attached (yet)
      }
    })
    const offBlocked = window.workdesk.onSiteBlocked((id, link, rule) => {
      try {
        if (el.getWebContentsId() === id) setBlocked({ url: link, rule })
      } catch {
        // the page is not attached (yet)
      }
    })
    return () => (offTab(), offSwitch(), offBlocked())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.n])

  useEffect(() => {
    const el = view.current!
    if (paneId) restoreScroll(paneId, el as unknown as Parameters<typeof restoreScroll>[1])
    // the page's icon, as the page announces it; a navigation to another site forgets it until the next one comes
    let icon: string | undefined
    const save = () => {
      const now = el.getURL()
      setAddress(now === 'about:blank' ? '' : now)
      setCurrent(now)
      setTitle(now === 'about:blank' ? '' : el.getTitle())
      setFavicon(icon)
      locate.current({ url: now, title: now === 'about:blank' ? '' : el.getTitle() || undefined, favicon: icon })
    }
    const onIcon = (e: Event) => {
      icon = (e as Event & { favicons?: string[] }).favicons?.[0]
      save()
    }
    const onNavigate = () => {
      icon = undefined
      setBlocked(undefined)
      save()
    }
    // a page that changes its address by itself (a single-page site) does not load anything: the block list is asked here
    const onInPage = (e: Event) => {
      const nav = e as Event & { url?: string; isMainFrame?: boolean }
      if (nav.isMainFrame === false || !nav.url) return
      void window.workdesk.siteBlockCheck(nav.url).then((rule) => rule && setBlocked({ url: nav.url!, rule }))
    }
    const onStart = () => {
      setFailure(undefined)
      // from the start again, so a second load does not run backwards
      setPhase('idle')
      requestAnimationFrame(() => setPhase('loading'))
    }
    const onStop = () => setPhase('done')
    const onFail = (e: Event) => {
      const f = e as Event & { isMainFrame?: boolean; errorCode?: number; errorDescription?: string; validatedURL?: string }
      // -3 is a load that was cancelled by the next one
      // -20 is what a blocked site looks like (the block list says so itself)
      if (f.isMainFrame && f.errorCode && f.errorCode !== -3 && f.errorCode !== -20) {
        setFailure({ url: f.validatedURL ?? '', code: f.errorCode, description: f.errorDescription ?? '' })
        // the address that did not load, not the page before
        if (f.validatedURL) setAddress(f.validatedURL)
      }
    }
    const onReady = () => {
      try {
        const id = el.getWebContentsId()
        setPageId(id)
        window.workdesk.extensionsSelectTab(id)
      } catch {
        // not attached yet
      }
    }
    el.addEventListener('dom-ready', onReady)
    el.addEventListener('focus', onReady)
    el.addEventListener('did-start-loading', onStart)
    el.addEventListener('did-stop-loading', onStop)
    el.addEventListener('did-fail-load', onFail)
    const events = ['did-navigate-in-page', 'page-title-updated']
    events.forEach((e) => el.addEventListener(e, save))
    el.addEventListener('did-navigate', onNavigate)
    el.addEventListener('did-navigate-in-page', onInPage)
    el.addEventListener('page-favicon-updated', onIcon)
    return () => {
      events.forEach((e) => el.removeEventListener(e, save))
      el.removeEventListener('did-navigate', onNavigate)
      el.removeEventListener('did-navigate-in-page', onInPage)
      el.removeEventListener('dom-ready', onReady)
      el.removeEventListener('focus', onReady)
      el.removeEventListener('did-start-loading', onStart)
      el.removeEventListener('did-stop-loading', onStop)
      el.removeEventListener('did-fail-load', onFail)
      el.removeEventListener('page-favicon-updated', onIcon)
    }
  }, [target.n])

  // Command+F while the page itself has the focus reaches the app through the main process, with the id of the page
  useEffect(
    () =>
      window.workdesk.onFindInPage((id) => {
        try {
          if (view.current?.getWebContentsId() === id) setFinding(true)
        } catch {
          // not attached yet
        }
      }),
    []
  )

  return (
    <div className="browser" onKeyDown={(e) => e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f' && (e.preventDefault(), setFinding(true))}>
      <form
        className="browser-bar"
        onSubmit={(e) => {
          e.preventDefault()
          go(normalizeUrl(address, getSearchEngine()))
        }}
      >
        <button type="button" onClick={goBack}>←</button>
        <button type="button" onClick={() => view.current?.goForward()}>→</button>
        <button type="button" onClick={() => view.current?.reload()}>↻</button>
        <SecurityInfo url={current} failure={failure} />
        {(() => {
          // which session the page is in; with a domain of several sessions a click lists them, one click opens the page in it
          const info = describePartition(config, target.partition)
          const named = /^https?:/i.test(current) ? sessionsFor(config, current) : []
          const several = named.length > 1 || (named.length === 1 && partitionFor(named[0].id) !== target.partition)
          return (
            <button
              type="button"
              className={'session-chip ' + info.kind}
              title={`Session: ${info.name}${info.kind === 'shared' ? ' (shared by the sites that have none of their own)' : info.kind === 'site' ? " (the site's own)" : ''}${several ? '. Click to pick another session of this domain' : ''}`}
              disabled={!several}
              onClick={(e) => {
                const box = e.currentTarget.getBoundingClientRect()
                setSessionMenu({ x: box.left, y: box.bottom + 2 })
              }}
            >
              {info.name}
              {several && ' ▾'}
            </button>
          )
        })()}
        {sessionMenu && (
          <ContextMenu
            x={sessionMenu.x}
            y={sessionMenu.y}
            onClose={() => setSessionMenu(undefined)}
            items={[
              // the page's own session first, ticked, when no rule names it for this address
              ...(sessionsFor(config, current).some((s) => partitionFor(s.id) === target.partition) ? [] : [{ label: `✓ ${describePartition(config, target.partition).name}`, onClick: () => undefined }]),
              ...sessionsFor(config, current).map((s) => {
                const here = partitionFor(s.id) === target.partition
                return { label: `${here ? '✓ ' : ''}${s.name}`, onClick: () => (here ? undefined : go(current, false, s)) }
              })
            ]}
          />
        )}
        <input
          ref={addressInput}
          value={address}
          placeholder="Address or search"
          autoFocus={blank}
          onChange={(e) => setOmni(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
        <button type="button" title="Developer tools of this page (⌥⌘I)" onClick={() => { const v = view.current as unknown as { isDevToolsOpened(): boolean; openDevTools(): void; closeDevTools(): void }; v.isDevToolsOpened() ? v.closeDevTools() : v.openDevTools() }}>&lt;/&gt;</button>
        {pageId !== undefined && <browser-action-list partition={target.partition} tab={String(pageId)} alignment="bottom right" />}
        <SiteSettings url={current} onBlocking={() => view.current?.reload()} />
        <PageMenu url={current} title={title} favicon={favicon} pageId={pageId} />
        <BookmarkControls url={current} title={title} favicon={favicon} />
        <div className={'load-bar ' + phase} aria-hidden="true" />
      </form>
      {asking && (
        <SessionChoice
          url={asking.to}
          options={asking.options}
          onPick={(s) => (setAsking(undefined), go(asking.to, asking.fromBack, s))}
          onCancel={() => setAsking(undefined)}
        />
      )}
      {finding && <FindBar view={view.current as unknown as Findable | null} onClose={() => (setFinding(false), view.current?.focus())} />}
      {omni !== undefined && (
        <SplitPicker
          mode="go"
          title="Go to"
          initial={omni}
          onCancel={() => (setOmni(undefined), addressInput.current?.focus())}
          onPick={(_kind, url, newTab) => {
            setOmni(undefined)
            if (!url) return
            if (newTab && openTabRef.current) openTabRef.current(url)
            else (setAddress(url), go(url))
          }}
        />
      )}
      {current === 'about:blank' && (
        <div className="newtab">
          <BookmarkStart onOpen={go} />
        </div>
      )}
      {moved && (
        <div className="session-moved">
          <span>
            <strong>{moved.host}</strong> belongs to the session “{moved.to.name}”, so the page moved there from “{moved.from.name}”. A login that goes through it can start over, because the
            session’s cookies and the page’s state do not come along. {moved.note}
          </span>
          {moved.from.id && (
            <button
              title={`Add ${moved.host} to the session “${moved.from.name}” and open the page again`}
              onClick={() => {
                const m = moved
                void loadBrowserSessions().then(async (cfg) => {
                  const next = {
                    ...cfg,
                    // out of the session it was in, into the one the page came from
                    sessions: cfg.sessions.map((s) => ({ ...s, domains: s.id === m.from.id ? [...new Set([...s.domains, m.host])] : s.domains.filter((d) => d !== m.host) }))
                  }
                  // the first matching rule wins: a broader rule of the other session (*.example.com) would still take the page
                  if (partitionForUrl(next, m.url) !== partitionFor(m.from.id)) {
                    setMoved({ ...m, note: `A rule of “${m.to.name}” that comes first still takes ${m.host}; change the rules in Settings → Browser → Sessions.` })
                    return
                  }
                  setBrowserSessions(await window.workdesk.browserSessionsSet(next))
                  setMoved(undefined)
                  go(m.url)
                })
              }}
            >
              Keep {moved.host} in “{moved.from.name}”
            </button>
          )}
          <button onClick={() => setMoved(undefined)}>Dismiss</button>
        </div>
      )}
      {blocked && (
        <BlockedPage
          url={blocked.url}
          rule={blocked.rule}
          onBack={() => {
            setBlocked(undefined)
            goBack()
          }}
          onPass={() =>
            void window.workdesk.siteBlockPass(blocked.url).then(() => {
              const to = blocked.url
              setBlocked(undefined)
              go(to)
            })
          }
        />
      )}
      {failure && !blocked && (
        <div className="newtab load-failure">
          <h3>{isCertificateError(failure) ? 'This connection cannot be trusted' : 'This page could not be loaded'}</h3>
          <p className="hint">{failure.url}</p>
          <p>
            {isCertificateError(failure)
              ? 'The server showed a certificate the browser does not accept, so WorkDesk did not load the page. Click the warning sign in the address bar for details.'
              : 'The server did not answer, or the address is wrong.'}{' '}
            <code>{failure.description}</code>
          </p>
          <button className="primary" onClick={() => view.current?.reload()}>Try again</button>
        </div>
      )}
      <webview
        key={`${target.partition}#${target.n}`}
        ref={view as never}
        src={target.url}
        partition={target.partition}
        className="webview"
        {...({ allowpopups: 'true' } as object)}
      />
    </div>
  )
}

/** A page on the block list: it is not loaded. A pass opens this one page for ten minutes, after a short wait. */
function BlockedPage({ url, rule, onBack, onPass }: { url: string; rule: string; onBack: () => void; onPass: () => void }) {
  const [left, setLeft] = useState(10)
  useEffect(() => {
    if (left <= 0) return
    const t = setTimeout(() => setLeft((n) => n - 1), 1000)
    return () => clearTimeout(t)
  }, [left])
  return (
    <div className="newtab site-blocked">
      <h3>{rule} is on your block list</h3>
      <p className="hint">{url}</p>
      <p>You blocked this site so you do not get lost in it. If this one page is what you need, open it: the pass is for this page only, for ten minutes. Any other page of the site is blocked again.</p>
      <div className="site-blocked-actions">
        <button className="primary" onClick={onBack}>Go back</button>
        <button disabled={left > 0} onClick={onPass}>{left > 0 ? `Open this page (${left})` : 'Open this page for 10 minutes'}</button>
      </div>
    </div>
  )
}
