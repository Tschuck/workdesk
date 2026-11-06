import { useOpenLink, useOpenLinks } from './OpenLink'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppState } from '../shared/api'
import type { BranchRow, BranchSync } from '../main/branches-service'
import { prReadiness, prStatusLabel, READINESS_LABEL } from '../main/domain/prs'
import { buildDeskTree, flattenBranches } from '../main/domain/tree'
import type { WorkDesk } from '../main/domain/types'
import type { Project } from '../main/projects/projects'
import type { DeskPrs } from '../main/sources/desk-prs'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { IconButton } from './Icons'
import { Spinner } from './Spinner'
import { AddButton, Field, Modal } from './Modal'

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function ago(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 31) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

interface Props {
  desk: WorkDesk
  run: (action: () => Promise<AppState>) => Promise<void>
  /** the branch whose details are shown (by the page, next to the work items) */
  selected?: { project: string; branch: string }
  onSelect: (branch: { project: string; branch: string }) => void
  /** changes when the page changed something about the branches, so the list reads them again */
  refresh?: number
  /** Pull Requests of the branches, when known */
  prs?: DeskPrs
  /** ask GitHub about them again */
  onRefreshPrs?: () => Promise<void> | void
}

/** The branches of one WorkDesk: the same list and details as the Branches page, filtered to this WorkDesk. */
export function DeskBranches({ desk, run, selected, onSelect, refresh = 0, prs, onRefreshPrs }: Props) {
  const api = window.workdesk
  const openLink = useOpenLink()
  const openLinks = useOpenLinks()
  const parked = desk.presence === 'parked' || desk.presence === 'planned'
  const branchesKey = desk.branches.map((b) => b.project + '/' + b.branch).join('\u0000')
  const [rows, setRows] = useState<BranchRow[]>([])
  const [sync, setSync] = useState<BranchSync[]>([])
  const [fetching, setFetching] = useState(false)
  const [msg, setMsg] = useState<string>()
  const [checkingOut, setCheckingOut] = useState(false)

  // add a branch: an existing one is checked out, a new name is created from `base`
  const [projects, setProjects] = useState<Project[]>([])
  const [addProject, setAddProject] = useState('')
  const [addName, setAddName] = useState('')
  const [addBase, setAddBase] = useState('')
  const [adding, setAdding] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [branchMenu, setBranchMenu] = useState<{ x: number; y: number; items: MenuItem[] }>()
  const [known, setKnown] = useState<BranchRow[]>([])

  const reload = useCallback(async () => {
    const [all, s] = await Promise.all([api.listBranches(false), parked || desk.branches.length === 0 ? Promise.resolve([]) : api.deskSync(desk.id)])
    setRows(all.flatMap((p) => p.branches.filter((b) => b.inDesk?.id === desk.id).map((b) => ({ ...b, project: p.project }) as BranchRow & { project: string })))
    setSync(s)
    if (addProject) setKnown(all.find((p) => p.project === addProject)?.branches ?? [])
  }, [api, desk.id, desk.branches.length, parked, addProject])

  useEffect(() => void reload().catch(() => undefined), [reload, branchesKey, refresh])
  useEffect(() => {
    void api.listProjects().then((p) => (setProjects(p), setAddProject((cur) => cur || p[0]?.name || '')))
  }, [api])
  // the pull requests this WorkDesk reviews that have no folder yet
  const uncheckedPrs = (desk.reviews ?? []).filter((r) => !desk.branches.some((b) => b.pr === `${r.owner}/${r.repo}#${r.number}`)).length
  const info = (project: string, branch: string) => (rows as (BranchRow & { project: string })[]).find((r) => r.project === project && r.name === branch)
  const syncOf = (project: string, branch: string) => sync.find((s) => s.project === project && s.branch === branch)
  const prOf = (project: string, branch: string) => prs?.branches.find((b) => b.project === project && b.branch === branch)

  const fetchNow = async () => {
    setFetching(true)
    setMsg(undefined)
    try {
      setSync(await api.deskFetch(desk.id))
      onRefreshPrs?.()
    } catch (e) {
      setMsg(clean(e as Error))
    } finally {
      setFetching(false)
    }
  }

  const wanted = addName.trim()
  const existing = known.find((b) => b.name === wanted)
  const mine = desk.branches.filter((b) => b.project === addProject)
  const baseUnknown = !existing && !!addBase.trim() && !known.some((b) => b.name === addBase.trim())
  const doAdd = async () => {
    if (!wanted || !addProject) return
    setAdding(true)
    await run(() => api.addBranch(desk.id, addProject, wanted, existing ? undefined : addBase || undefined))
    setAdding(false)
    setAddName('')
    setAddBase('')
    setShowAdd(false)
  }

  const tree = useMemo(() => buildDeskTree(desk), [desk])
  // the open pull requests of all branches: one browser Tab each, in one go
  const openPrs = parked ? [] : (prs?.branches ?? []).flatMap((b) => b.prs.filter((p) => p.state === 'open'))

  return (
    <section className="panel desk-branches">
      {branchMenu && <ContextMenu x={branchMenu.x} y={branchMenu.y} items={branchMenu.items} onClose={() => setBranchMenu(undefined)} />}
      <h3>
        Branches ({desk.branches.length})
        <span className="panel-tools">
          {!parked && <AddButton label="Add a branch" onClick={() => setShowAdd(true)} />}
          {openPrs.length > 0 && (
            <button title={openPrs.map((p) => `#${p.number} ${p.title}`).join('\n')} onClick={() => openLinks(openPrs.map((p) => p.url))}>
              Open pull requests ({openPrs.length})
            </button>
          )}
          {desk.branches.length > 0 && !parked && onRefreshPrs && (
            <IconButton icon="sync" title="Sync branch PRs: look on GitHub for the pull requests of these branches and add the open ones as work items" onClick={() => void onRefreshPrs()} />
          )}
          {desk.branches.length > 0 && !parked && (
            <IconButton icon="fetch" title={fetching ? 'Fetching…' : 'Fetch the remotes, to see what was pushed from elsewhere'} disabled={fetching} onClick={() => void fetchNow()} />
          )}
        </span>
      </h3>
      {msg && <div className="error" onClick={() => setMsg(undefined)}>{msg}</div>}

      {showAdd && !parked && (
        <Modal
          title="Add a branch"
          submitLabel={existing ? 'Check out' : 'Create'}
          busy={adding}
          canSubmit={!!wanted && !!addProject && !(existing && (existing.inDesk || existing.checkedOutAt)) && !baseUnknown}
          onClose={() => setShowAdd(false)}
          onSubmit={() => void doAdd()}
        >
          <Field label="Project">
            <select value={addProject} onChange={(e) => (setAddProject(e.target.value), setAddBase(''))}>
              {projects.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              {projects.length === 0 && <option value="">no Projects</option>}
            </select>
          </Field>
          <Field label="Branch" hint="An existing branch, or a new name.">
            <input autoFocus list={`branches-${desk.id}`} value={addName} spellCheck={false} onChange={(e) => setAddName(e.target.value)} />
            <datalist id={`branches-${desk.id}`}>
              {known.filter((b) => !b.inDesk && !b.checkedOutAt).map((b) => <option key={b.name} value={b.name}>{b.subject}</option>)}
            </datalist>
          </Field>
          {wanted && !existing && (
            <Field label="Starts from" hint="Any existing branch of this Project; empty = its default branch.">
              <input list={`from-${desk.id}`} value={addBase} spellCheck={false} onChange={(e) => setAddBase(e.target.value)} />
              <datalist id={`from-${desk.id}`}>
                {mine.map((b) => <option key={'w' + b.branch} value={b.branch}>in this WorkDesk (Stack)</option>)}
                {known.filter((b) => !mine.some((m) => m.branch === b.name)).map((b) => <option key={b.name} value={b.name}>{b.subject}</option>)}
              </datalist>
            </Field>
          )}
          {wanted && (
            <p className="hint">
              {existing?.inDesk ? `Already in the WorkDesk "${existing.inDesk.name}".`
                : existing?.checkedOutAt ? 'Checked out in another folder of yours.'
                : existing ? 'Existing branch: it is checked out in its own worktree.'
                : baseUnknown ? `No branch called ${addBase.trim()} in ${addProject}.`
                : `New branch: created ${addBase ? `from ${addBase.trim()}${mine.some((m) => m.branch === addBase.trim()) ? ', as a Stack' : ''}` : 'from the default branch'}.`}
            </p>
          )}
        </Modal>
      )}

      <div className="desk-branches-list">
          {uncheckedPrs > 0 && !parked && (
            <div className="checkout-review">
              <p className="hint">
                {uncheckedPrs === 1 ? 'A pull request' : `${uncheckedPrs} pull requests`} of this WorkDesk {uncheckedPrs === 1 ? 'is' : 'are'} not checked out: nothing is cloned or checked out for {uncheckedPrs === 1 ? 'it' : 'them'} yet. Check the branch out when you want to
                run or edit the code; the first time, the repository is cloned.
              </p>
              <button className="primary" disabled={checkingOut} onClick={async () => (setCheckingOut(true), await run(() => api.checkoutReviewBranch(desk.id)), setCheckingOut(false))}>
                {checkingOut && <Spinner />} {checkingOut ? 'Checking out…' : uncheckedPrs === 1 ? 'Check out the branch' : 'Check out the branches'}
              </button>
            </div>
          )}
          {desk.branches.length === 0 && uncheckedPrs === 0 && <p className="empty">No Branches yet.</p>}
          {tree.map((p) => (
            <div key={p.project} className="pr-group">
              <div className="pr-group-head static">
                <strong>{p.project}</strong>
                <span className="count">{flattenBranches(p.branches).length}</span>
              </div>
              {flattenBranches(p.branches).map((n) => {
                const b = n.branch
                const meta = info(b.project, b.branch)
                const st = syncOf(b.project, b.branch)
                const pr = prOf(b.project, b.branch)
                const first = pr?.prs[0]
                const open = selected?.project === b.project && selected.branch === b.branch
                return (
                  <div
                    key={b.project + b.branch}
                    className={'branch-row' + (open ? ' open selected' : '')}
                    onClick={() => onSelect({ project: b.project, branch: b.branch })}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      const items: MenuItem[] = [
                        { label: 'Show details', onClick: () => onSelect({ project: b.project, branch: b.branch }) },
                        ...(first ? [{ label: `Open PR #${first.number}`, onClick: () => void openLink(first.url) }] : []),
                        { label: 'Copy branch name', onClick: () => void navigator.clipboard.writeText(b.branch) },
                        { label: 'Copy folder path', onClick: () => void navigator.clipboard.writeText(b.path) },
                      ]
                      setBranchMenu({ x: e.clientX, y: e.clientY, items })
                    }}
                    title="Show details"
                  >
                    <code className="bname">{b.base ? '↳ ' : ''}{b.branch}</code>
                    {first ? (
                      <button className={'chip small link pr-state-' + (first.draft && first.state === 'open' ? 'draft' : first.state)} title={first.title} onClick={(e) => (e.stopPropagation(), void openLink(first.url))}>
                        PR #{first.number} · {first.state === 'open' ? READINESS_LABEL[prReadiness(first)] : prStatusLabel(first)}
                      </button>
                    ) : (
                      pr?.repo && !pr.error && <span className="chip small" title="No pull request for this branch yet">no PR</span>
                    )}
                    {st?.dirty && <span className="chip small" title="uncommitted changes">changed</span>}
                    {st && !st.upstream && <span className="chip small" title="this branch has no remote branch yet">not pushed</span>}
                    {st && st.ahead > 0 && <span className="chip small" title={`${st.ahead} commit(s) not pushed`}>↑{st.ahead}</span>}
                    {st && st.behind > 0 && <span className="chip small st-today" title={`${st.behind} new commit(s) on ${st.upstream}`}>↓{st.behind}</span>}
                    {st && st.behind > 0 && st.ahead > 0 && <span className="chip small" title="rebase or merge in a terminal">diverged</span>}
                    <span className="bsubject" title={meta?.subject}>{meta?.subject}</span>
                    {meta && <span className="bmeta">{meta.author} · {ago(meta.date)}</span>}
                  </div>
                )
              })}
            </div>
          ))}
      </div>
    </section>
  )
}
