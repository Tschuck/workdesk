import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppState } from '../shared/api'
import {
  DEFAULT_PR_FILTER, filterPrs, isCandidate, isReviewed, prTodoStatus, statusLabel,
  type PrFilter, type PrItem, type PrTodoStatus, type ReviewFilter, type ReviewState, type StatusFilter
} from '../main/domain/prs'
import type { PrsState } from '../main/sources/prs-service'
import type { SettingsSection } from './SettingsView'
import { ReloadButton } from './Icons'
import { AddButton, Field, Modal } from './Modal'
import { SettingsLink } from './SettingsLink'
import { prItem, type WorkItem } from '../main/domain/work-items'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { useOpenLink } from './OpenLink'
import { planItems, StartItemsPanel, WorkItemDetail } from './WorkItems'

const BADGES: Partial<Record<ReviewState, { text: string; title: string }>> = {
  approved: { text: '✓ approved', title: 'You approved this' },
  changes: { text: '✗ changes', title: 'You requested changes' },
  commented: { text: '💬 commented', title: 'You commented' },
  're-review': { text: '↻ re-review', title: 'Your review was requested again' },
  requested: { text: 'requested', title: 'Your review was requested' },
  mine: { text: 'yours', title: 'You authored this' }
}

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

interface Props {
  state: AppState
  run: (action: () => Promise<AppState>) => Promise<void>
  openDesk: (id: string) => void
  openSettings: (section: SettingsSection) => void
}

/** Open Pull Requests per Project, with whether a WorkDesk has them, and filters. */
export function GithubView({ state, run, openDesk, openSettings }: Props) {
  const api = window.workdesk
  const openLink = useOpenLink()
  const [prMenu, setPrMenu] = useState<{ x: number; y: number; items: MenuItem[] }>()
  const [prs, setPrs] = useState<PrsState>()
  const [connected, setConnected] = useState<boolean>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [repo, setRepo] = useState('')
  const [watching, setWatching] = useState(false)
  const [filter, setFilter] = useState<PrFilter>(DEFAULT_PR_FILTER)
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [start, setStart] = useState<WorkItem[]>()
  // the pull request whose details are shown on the right
  const [openId, setOpenId] = useState<string>()

  const load = useCallback(
    async (mode: 'none' | 'missing' | 'all') => {
      setLoading(true)
      try {
        setPrs(await api.prsList(mode))
        setError(undefined)
      } catch (e) {
        setError(clean(e as Error))
        setPrs(await api.prsList('none'))
      } finally {
        setLoading(false)
      }
    },
    [api]
  )

  /** straight to the start panel: a pull request is not made a Todo */
  const startReview = (pr: PrItem) => setStart([prItem({ id: pr.id, title: pr.title, url: pr.url, subtitle: `${pr.owner}/${pr.repo} · ${pr.author}`, author: pr.author })])

  useEffect(() => void api.githubStatus().then((a) => setConnected(a.kind !== 'none'), () => setConnected(false)), [api])
  useEffect(() => void load('none'), [load])
  // first visit with a login: fetch what was never fetched
  useEffect(() => {
    if (connected) void load('missing')
  }, [connected, load])

  /** the Project of a repository, to tell whether a WorkDesk has the branch of a pull request */
  const projectOf = useCallback((pr: PrItem) => prs?.repos.find((r) => r.items.some((p) => p.id === pr.id))?.project, [prs])
  const statusOf = useCallback((pr: PrItem): PrTodoStatus => prTodoStatus(pr.id, state.desks, { project: projectOf(pr), head: pr.head }), [state.desks, projectOf])
  const skipped = useMemo(() => new Set(prs?.skipped ?? []), [prs])
  const set = <K extends keyof PrFilter>(key: K, value: PrFilter[K]) => setFilter((f) => ({ ...f, [key]: value }))

  const shownByRepo = (prs?.repos ?? []).map((r) => ({ r, shown: filterPrs(r.items, filter, statusOf) }))
  const act = (p: Promise<PrsState>) => p.then(setPrs, (e: Error) => setError(clean(e)))

  const asItem = (pr: PrItem) => prItem({ id: pr.id, title: pr.title, url: pr.url, subtitle: `${pr.owner}/${pr.repo} · ${pr.author}`, author: pr.author })
  const openPr = (prs?.repos ?? []).flatMap((r) => r.items).find((p) => p.id === openId)

  return (
    <div className="split-page">
    <section className="prs split-main">
      {prMenu && <ContextMenu x={prMenu.x} y={prMenu.y} items={prMenu.items} onClose={() => setPrMenu(undefined)} />}
      <h2>
        Pull Requests
        <ReloadButton title="Reload the pull requests of your Projects" busy={loading} disabled={!connected} updatedAt={prs?.fetchedAt ?? undefined} onClick={() => void load('all')} />
        <SettingsLink section="github" onOpen={openSettings} title="GitHub settings: how the app logs in" />
        <AddButton label="Watch another repository" onClick={() => setWatching(true)} />
      </h2>
      {connected === false && (
        <p className="hint">
          GitHub is not connected. <button onClick={() => openSettings('github')}>Open the GitHub settings</button>
        </p>
      )}

      {error && <div className="error" onClick={() => setError(undefined)}>{error}</div>}

      {watching && (
        <Modal title="Watch a repository" submitLabel="Watch" canSubmit={!!repo.trim()} onClose={() => (setWatching(false), setRepo(''))} onSubmit={() => (void act(api.prsAddRepo(repo)), setRepo(''), setWatching(false))}>
          <Field label="Repository" hint="The Projects' repositories are watched already.">
            <input autoFocus placeholder="owner/name" value={repo} spellCheck={false} onChange={(e) => setRepo(e.target.value)} />
          </Field>
        </Modal>
      )}

      <div className="filters">
        <input placeholder="Filter by title, author or #number…" value={filter.text} onChange={(e) => set('text', e.target.value)} />
        <select value={filter.status} onChange={(e) => set('status', e.target.value as StatusFilter)} title="Whether a WorkDesk has it">
          <option value="all">all</option>
          <option value="none">not started</option>
          <option value="desk">in a WorkDesk</option>
        </select>
        <select value={filter.review} onChange={(e) => set('review', e.target.value as ReviewFilter)} title="Your review">
          <option value="all">any review state</option>
          <option value="needs">needs my review</option>
          <option value="reviewed">reviewed</option>
          <option value="mine">my own</option>
        </select>
        <label className="pr-toggle"><input type="checkbox" checked={filter.showDeps} onChange={(e) => set('showDeps', e.target.checked)} /> dependency updates</label>
        <label className="pr-toggle"><input type="checkbox" checked={filter.hideReviewed} onChange={(e) => set('hideReviewed', e.target.checked)} /> hide reviewed</label>
        <label className="pr-toggle"><input type="checkbox" checked={filter.hideDrafts} onChange={(e) => set('hideDrafts', e.target.checked)} /> hide drafts</label>
      </div>

      {prs?.repos.length === 0 && <p className="empty">No Projects with a GitHub remote yet; register Projects or watch a repository above.</p>}
      {shownByRepo.map(({ r, shown }) => {
        const key = r.repo
        const open = !collapsed.includes(key)
        return (
          <div key={key} className="pr-group">
            <div className="pr-group-head" onClick={() => setCollapsed((c) => (open ? [...c, key] : c.filter((x) => x !== key)))}>
              <span className="chevron">{open ? '▾' : '▸'}</span>
              <strong>{r.project ?? r.repo}</strong>
              {r.project && <small className="hint">{r.repo}</small>}
              {r.fetched && !r.error && <span className="count">{shown.length}{shown.length !== r.items.length ? ` / ${r.items.length}` : ''}</span>}
              {r.manual && (
                <button
                  className="pr-x"
                  title="Stop watching"
                  onClick={(e) => {
                    e.stopPropagation()
                    void act(api.prsRemoveRepo(r.repo))
                  }}
                >
                  ×
                </button>
              )}
            </div>
            {open && (
              <>
                {!r.fetched && <div className="empty">{loading ? 'Loading…' : 'Not fetched yet'}</div>}
                {r.error && <div className="error">{r.error}</div>}
                {r.fetched && !r.error && r.items.length === 0 && <div className="empty">No open pull requests</div>}
                {r.items.length > 0 && shown.length === 0 && <div className="empty">All {r.items.length} filtered out</div>}
                {shown.map((pr) => {
                  const status = statusOf(pr)
                  const badge = BADGES[pr.reviewState]
                  const isSkipped = skipped.has(pr.id)
                  return (
                    <div
                      key={pr.id}
                      className={'pr-row' + (isSkipped || isReviewed(pr) ? ' dim' : isCandidate(pr) ? ' review' : '')}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        const items: MenuItem[] = [
                          { label: 'Show the pull request', onClick: () => setOpenId(pr.id) },
                          { label: 'Open on GitHub', onClick: () => void openLink(pr.url) },
                          { label: 'Copy link', onClick: () => void navigator.clipboard.writeText(pr.url) },
                          status.kind === 'desk' ? { label: 'Open its WorkDesk', onClick: () => openDesk(status.deskId) } : { label: 'Add to today', onClick: () => void planItems([asItem(pr)], run) },
                        ]
                        setPrMenu({ x: e.clientX, y: e.clientY, items })
                      }}
                    >
                      <span className={'pr-title' + (pr.id === openId ? ' open' : '')} title="Show the pull request" onClick={() => setOpenId(pr.id)}>
                        <span className="pr-num">#{pr.number}</span> {pr.title}
                      </span>
                      {pr.draft && <span className="chip small">draft</span>}
                      {badge && <span className={'chip small rs-' + pr.reviewState} title={badge.title}>{badge.text}</span>}
                      <span className="pr-author">{pr.author}</span>
                      <span className={'chip small st-' + status.kind} title="Whether a WorkDesk has it">{statusLabel(status)}</span>
                      <span className="actions">
                        {status.kind === 'desk' && <button onClick={() => openDesk(status.deskId)}>Open</button>}
                      </span>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )
      })}
      {start && <StartItemsPanel
          items={start}
          run={run}
          onClose={() => setStart(undefined)}
          onStarted={(st) => {
            const made = st.desks.reduce<(typeof st.desks)[number] | undefined>((n, d) => (!n || d.createdAt > n.createdAt ? d : n), undefined)
            if (made) openDesk(made.id)
          }}
        />}
    </section>
    <aside className="side-pane">
      <WorkItemDetail
        withPage
        item={openPr ? asItem(openPr) : undefined}
        state={state}
        run={run}
        actions={
          openPr && (
            <>
              {statusOf(openPr).kind === 'none' && <button className="primary" onClick={() => startReview(openPr)}>Start review</button>}
              {statusOf(openPr).kind === 'none' && <button onClick={() => void planItems([asItem(openPr)], run)}>Add to today</button>}
              {statusOf(openPr).kind === 'none' && <button title="Hide it from the dashboard and this list's candidates" onClick={() => void act(api.prsSkip(openPr.id, !skipped.has(openPr.id)))}>{skipped.has(openPr.id) ? 'Unskip' : 'Skip'}</button>}
              {statusOf(openPr).kind === 'desk' && <button onClick={() => openDesk((statusOf(openPr) as { deskId: string }).deskId)}>Open WorkDesk</button>}
            </>
          )
        }
      />
    </aside>
    </div>
  )
}
