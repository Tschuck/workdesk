import { useOpenLink } from './OpenLink'
import { useCallback, useEffect, useState } from 'react'
import type { AppState } from '../shared/api'
import type { BranchDetails, BranchSync } from '../main/branches-service'
import type { BranchPrs } from '../main/sources/desk-prs'
import { BranchEnvMenu } from './BranchEnvMenu'
import { DeleteBranchDialog } from './DeleteBranchDialog'
import { PullRequestsPanel } from './PullRequestsPanel'
import { RemoveBranchDialog } from './RemoveBranchDialog'
import { Spinner } from './Spinner'

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function ago(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 31) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

interface Props {
  project: string
  branch: string
  desks: { id: string; name: string; presence: string }[]
  run: (action: () => Promise<AppState>) => Promise<void>
  /** without it the WorkDesk cannot be opened from here (the branch's own WorkDesk is already open) */
  openDesk?: (id: string) => void
  /** the lists on the page have to be read again */
  onChanged: () => void
  /** without it there is no close button (the branch is shown inside something else) */
  onClose?: () => void
  /** start a WorkDesk from this branch; without it the button is not shown */
  onCreateDesk?: () => void
  /** the pull requests of the branch are shown elsewhere (the page is about one of them): leave them out */
  hidePrs?: boolean
  /** shown inside this WorkDesk: it need not be named, it is the one you are in */
  inThisDesk?: string
}

/** One branch: its commits, how it relates to the default branch, its pull requests, and what can be done with it. */
export function BranchDetail({ project, branch, desks, run, openDesk, onChanged, onClose, onCreateDesk, hidePrs, inThisDesk }: Props) {
  const api = window.workdesk
  const openLink = useOpenLink()
  const [d, setD] = useState<BranchDetails>()
  const [error, setError] = useState<string>()
  const [prs, setPrs] = useState<BranchPrs>()
  const [prsLoading, setPrsLoading] = useState(false)
  const [target, setTarget] = useState('')
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<'local' | 'remote'>()
  const [removing, setRemoving] = useState(false)
  // how far the branch is from its remote branch, when a WorkDesk has it checked out
  const [sync, setSync] = useState<BranchSync>()
  const [fetching, setFetching] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string>()

  const load = useCallback(async () => {
    try {
      setD(await api.branchDetails(project, branch))
      setError(undefined)
    } catch (e) {
      setD(undefined)
      setError(clean(e as Error))
    }
  }, [api, project, branch])

  const loadPrs = useCallback(async () => {
    setPrsLoading(true)
    try {
      setPrs(await api.branchPrs(project, branch))
    } finally {
      setPrsLoading(false)
    }
  }, [api, project, branch])

  useEffect(() => {
    setD(undefined)
    setPrs(undefined)
    setTarget('')
    void load()
    if (!hidePrs) void loadPrs()
  }, [load, loadPrs, hidePrs])

  const deskId = d?.inDesk?.id
  const loadSync = useCallback(async () => {
    if (!deskId) return setSync(undefined)
    try {
      setSync((await api.deskSync(deskId)).find((s) => s.project === project && s.branch === branch))
    } catch {
      setSync(undefined)
    }
  }, [api, deskId, project, branch])
  useEffect(() => void loadSync(), [loadSync])
  const fetchNow = async () => {
    if (!deskId) return
    setFetching(true)
    setSyncMsg(undefined)
    try {
      setSync((await api.deskFetch(deskId)).find((s) => s.project === project && s.branch === branch))
      onChanged()
    } catch (e) {
      setSyncMsg(clean(e as Error))
    } finally {
      setFetching(false)
    }
  }
  const pull = async () => {
    if (!deskId) return
    setPulling(true)
    setSyncMsg(undefined)
    try {
      const r = await api.deskPull(deskId, project, branch)
      if ('message' in r) setSyncMsg(r.message)
      await loadSync()
      void load()
      onChanged()
    } finally {
      setPulling(false)
    }
  }

  const targets = desks.filter((x) => x.presence !== 'parked' && x.presence !== 'planned')
  const taken = !!d?.inDesk || !!d?.checkedOutAt

  return (
    <div className="branch-detail">
      <div className="detail-head">
        <h3><code>{branch}</code> <small className="hint">{project}</small></h3>
        {onClose && <button title="Close" onClick={onClose}>×</button>}
      </div>
      {error && <div className="error">{error}</div>}
      {!d && !error && <p className="hint"><Spinner /> Reading the branch…</p>}
      {d && (
        <>
          <div className="pills">
            {d.local && <span className="chip small">local</span>}
            {d.remote && <span className="chip small">origin</span>}
            {d.isDefault && <span className="chip small kind-review" title="the default branch of the Project">default</span>}
            {d.merged && <span className="chip small pr-state-merged" title={`all its commits are in ${d.defaultBranch}`}>merged into {d.defaultBranch}</span>}
            {d.inDesk && (openDesk ? <button className="chip small link" onClick={() => openDesk(d.inDesk!.id)}>in {d.inDesk.name}</button> : <span className="chip small">in this WorkDesk</span>)}
            {!d.inDesk && d.checkedOutAt && <span className="chip small" title={d.checkedOutAt}>checked out elsewhere</span>}
          </div>

          {d.githubUrl ? (
            <p>
              <button onClick={() => void openLink(d.githubUrl!)} title={d.githubUrl}>Open on GitHub ↗</button>
            </p>
          ) : (
            d.local && !d.remote && <p className="hint">Not pushed yet, so there is no page on GitHub.</p>
          )}

          <dl className="facts">
            {d.defaultBranch && !d.isDefault && (
              <>
                <dt>Compared to {d.defaultBranch}</dt>
                <dd>{d.ahead} commit{d.ahead === 1 ? '' : 's'} ahead, {d.behind} behind</dd>
              </>
            )}
            <dt>Last commit</dt>
            <dd>{d.subject} <small className="hint">{d.author} · {ago(d.date)}</small></dd>
            {d.checkedOutAt && (<><dt>Folder</dt><dd><code>{d.checkedOutAt}</code></dd></>)}
          </dl>

          {!hidePrs && (
            <PullRequestsPanel
              data={prs && { fetchedAt: Date.now(), branches: [prs] }}
              loading={prsLoading}
              onRefresh={() => void loadPrs()}
              openUrl={(u) => void openLink(u)}
            />
          )}

          <div className="panel">
            <h3>WorkDesk</h3>
            {d.inDesk ? (
              <>
                <div className="detail-actions">
                  {d.inDesk.id !== inThisDesk && (
                    <>
                      <span>In <strong>{d.inDesk.name}</strong></span>
                      {openDesk && <button onClick={() => openDesk(d.inDesk!.id)}>Open</button>}
                    </>
                  )}
                  <span className="grow" />
                  <button className="danger" title="Delete its folder in the WorkDesk; the branch is kept" onClick={() => setRemoving(true)}>
                    Remove from WorkDesk…
                  </button>
                </div>
                {syncMsg && <div className="error" onClick={() => setSyncMsg(undefined)}>{syncMsg}</div>}
                <div className="detail-actions sync-line">
                  {sync ? (
                    <>
                      {sync.dirty && <span className="chip small" title="uncommitted changes">changed</span>}
                      {!sync.upstream && <span className="chip small" title="this branch has no remote branch yet">not pushed</span>}
                      {sync.ahead > 0 && <span className="chip small">↑{sync.ahead} not pushed</span>}
                      {sync.behind > 0 && <span className="chip small st-today">↓{sync.behind} new on {sync.upstream}</span>}
                      {sync.upstream && sync.ahead === 0 && sync.behind === 0 && <span className="hint">level with {sync.upstream}</span>}
                      {sync.behind > 0 && sync.ahead > 0 && <span className="chip small" title="rebase or merge in a terminal">diverged</span>}
                    </>
                  ) : (
                    <span className="hint">Reading…</span>
                  )}
                  <span className="grow" />
                  <button disabled={fetching} title="Fetch the remote, to see what was pushed from elsewhere" onClick={() => void fetchNow()}>
                    {fetching && <Spinner />} Fetch
                  </button>
                  {sync && sync.behind > 0 && sync.ahead === 0 && (
                    <button disabled={pulling} title="Fast-forward to the remote branch" onClick={() => void pull()}>
                      {pulling ? <Spinner /> : 'Pull'}
                    </button>
                  )}
                </div>
                <div className="env-line">
                  <span className="hint">.env files</span>
                  <BranchEnvMenu deskId={d.inDesk.id} project={project} branch={branch} />
                </div>
              </>
            ) : (
              <>
                {d.checkedOutAt && <p className="hint">It is checked out in a folder of yours, so it cannot be checked out again.</p>}
                <div className="detail-actions">
                  <select value={target} disabled={taken || targets.length === 0} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">Add to WorkDesk…</option>
                    {targets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  <button
                    disabled={!target || adding || taken}
                    onClick={async () => {
                      setAdding(true)
                      await run(() => api.addExistingBranches(target, [{ project, branch }]))
                      setAdding(false)
                      const id = target
                      setTarget('')
                      onChanged()
                      void load()
                      openDesk?.(id)
                    }}
                  >
                    {adding && <Spinner />} Add
                  </button>
                  {onCreateDesk && <button className="primary" disabled={taken} onClick={onCreateDesk}>New WorkDesk…</button>}
                </div>
              </>
            )}
          </div>

          <div className="panel">
            <h3>Commits</h3>
            <ul className="commits">
              {d.commits.map((c) => (
                <li key={c.sha}>
                  <code className="sha">{c.sha.slice(0, 7)}</code>
                  <span className="csubject" title={c.subject}>{c.subject}</span>
                  <small className="hint">{c.author} · {ago(c.date)}</small>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel danger-zone">
            <h3>Delete</h3>
            {d.isDefault ? (
              <p className="hint">The default branch of {project} is not deleted here.</p>
            ) : (
              <div className="detail-actions">
                {d.inDesk && d.local ? (
                  <button className="danger" title={`Delete its folder in the WorkDesk "${d.inDesk.name}" (asking first), then delete the local branch`} onClick={() => setRemoving(true)}>
                    Remove from WorkDesk and delete…
                  </button>
                ) : (
                  <button className="danger" disabled={!d.local || taken} title={!d.local ? 'There is no local branch' : taken ? `It is checked out in ${d.checkedOutAt}: switch that folder to another branch first` : undefined} onClick={() => setDeleting('local')}>
                    Delete local branch…
                  </button>
                )}
                <button className="danger" disabled={!d.remote} title={!d.remote ? 'It is not on the remote' : 'Removes it from origin for everyone'} onClick={() => setDeleting('remote')}>
                  Delete remote branch…
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {d && deleting && (
        <DeleteBranchDialog
          details={d}
          initial={deleting}
          onClose={(deleted) => {
            setDeleting(undefined)
            if (!deleted) return
            onChanged()
            // a branch that is gone locally and remotely leaves the page; otherwise show what is left
            void api.branchDetails(project, branch).then(setD, () => onClose?.())
          }}
        />
      )}
      {d?.inDesk && removing && (
        <RemoveBranchDialog
          deskId={d.inDesk.id}
          deskName={d.inDesk.name}
          project={project}
          branch={branch}
          run={run}
          onClose={(removed) => {
            setRemoving(false)
            if (!removed) return
            onChanged()
            // the folder is gone: offer to delete the branch itself, which was not possible while the WorkDesk had it
            void api.branchDetails(project, branch).then(
              (fresh) => {
                setD(fresh)
                if (fresh.local && !fresh.isDefault && !fresh.checkedOutAt) setDeleting('local')
              },
              () => void load()
            )
          }}
        />
      )}
    </div>
  )
}
