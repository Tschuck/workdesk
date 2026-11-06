import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppState } from '../shared/api'
import type { ProjectBranches } from '../main/branches-service'
import { isChoreBranch } from '../main/domain/branches'
import { BranchDetail } from './BranchDetail'
import { ReloadButton } from './Icons'
import { Spinner } from './Spinner'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { AddButton, Field, Modal } from './Modal'
import { StartPanel, type StartRequest } from './StartPanel'

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const key = (project: string, branch: string) => `${project}\u0000${branch}`

function ago(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 31) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

interface Props {
  /** a branch to show details of when the page opens (from a click on a branch elsewhere) */
  focus?: { project: string; branch: string }
  desks: { id: string; name: string; presence: string }[]
  run: (action: () => Promise<AppState>) => Promise<void>
  openDesk: (id: string) => void
}

/** Existing branches of every Project: pick one or several and start a WorkDesk from them. */
export function BranchesView({ focus, desks, run, openDesk }: Props) {
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; items: MenuItem[] }>()
  const api = window.workdesk
  const [data, setData] = useState<ProjectBranches[]>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [text, setText] = useState('')
  const [hideTaken, setHideTaken] = useState(true)
  // chore and dependency-bot branches are hidden each time the page opens, like dependency updates on the Pull Requests page
  const [hideChore, setHideChore] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [start, setStart] = useState<StartRequest>()
  // the branch whose details are shown on the right
  const [detail, setDetail] = useState<{ project: string; branch: string } | undefined>(focus)
  useEffect(() => setDetail(focus), [focus])
  const [newProject, setNewProject] = useState('')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [newFrom, setNewFrom] = useState('')
  const [addTo, setAddTo] = useState<string>()
  const [adding, setAdding] = useState(false)
  const targets = desks.filter((d) => d.presence !== 'parked' && d.presence !== 'planned')

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true)
      try {
        setData(await api.listBranches(refresh))
        setError(undefined)
      } catch (e) {
        setError(clean(e as Error))
      } finally {
        setLoading(false)
      }
    },
    [api]
  )

  useEffect(() => void load(false), [load])

  const groups = useMemo(() => {
    const q = text.trim().toLowerCase()
    return (data ?? []).map((p) => ({
      ...p,
      shown: p.branches.filter(
        (b) => (!hideTaken || (!b.inDesk && !b.checkedOutAt)) && !(hideChore && isChoreBranch(b.name)) && (!q || b.name.toLowerCase().includes(q) || b.subject.toLowerCase().includes(q) || b.author.toLowerCase().includes(q))
      )
    }))
  }, [data, text, hideTaken, hideChore])
  const choreCount = useMemo(() => (data ?? []).reduce((n, p) => n + p.branches.filter((b) => isChoreBranch(b.name)).length, 0), [data])

  const projectRows = data?.find((p) => p.project === (newProject || data[0]?.project))
  const wantsNew = newName.trim() !== ''
  const newBranch = wantsNew ? [{ project: projectRows?.project ?? '', branch: newName.trim(), from: newFrom.trim() || undefined }] : []
  const nameTaken = projectRows?.branches.some((b) => b.name === newName.trim())

  const toggle = (k: string) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))
  const refs = selected.map((k) => {
    const [project, branch] = k.split('\u0000')
    return { project, branch }
  })

  return (
    <div className="split-page branches-split">
    <section className="split-main branches-page">
      {rowMenu && <ContextMenu x={rowMenu.x} y={rowMenu.y} items={rowMenu.items} onClose={() => setRowMenu(undefined)} />}
      <h2>Branches {data && data.length > 0 && <AddButton label="New branch" onClick={() => setCreating(true)} />} <ReloadButton title="Fetch every Project's remote and read the branches again" busy={loading} onClick={() => void load(true)} /></h2>
      <p className="hint">
        Start a WorkDesk from branches that already exist, in one or several Projects. Each branch gets its own worktree; branches that sit
        on top of each other become a Stack. Reload to fetch what is new on the remotes.
      </p>

      <div className="pr-head">
        <input className="grow" placeholder="Filter by branch, last commit or author…" value={text} onChange={(e) => setText(e.target.value)} />
        <label className="pr-toggle" title="Hide branches that a WorkDesk has or that are checked out in your own clone">
          <input type="checkbox" checked={hideTaken} onChange={(e) => setHideTaken(e.target.checked)} /> hide taken
        </label>
        <label className="pr-toggle" title="chore/…, renovate/…, dependabot/… branches">
          <input type="checkbox" checked={hideChore} onChange={(e) => setHideChore(e.target.checked)} /> hide chore{choreCount > 0 ? ` (${choreCount})` : ''}
        </label>
      </div>
      {error && <div className="error" onClick={() => setError(undefined)}>{error}</div>}

      {creating && data && data.length > 0 && (
        <Modal
          title="New branch"
          submitLabel="Create WorkDesk …"
          canSubmit={wantsNew && !nameTaken}
          onClose={() => setCreating(false)}
          onSubmit={() => (setCreating(false), setStart({ kind: 'branches', todoIds: [], branches: refs, newBranches: newBranch, defaultName: newName.trim() }))}
        >
          <Field label="Project">
            <select value={projectRows?.project ?? ''} onChange={(e) => (setNewProject(e.target.value), setNewFrom(''))}>
              {data.map((p) => <option key={p.project} value={p.project}>{p.project}</option>)}
            </select>
          </Field>
          <Field label="New branch name"><input autoFocus value={newName} spellCheck={false} onChange={(e) => setNewName(e.target.value)} /></Field>
          <Field label="Starts from" hint="An existing branch of this Project; empty = its default branch.">
            <input list="new-branch-from" value={newFrom} spellCheck={false} onChange={(e) => setNewFrom(e.target.value)} />
            <datalist id="new-branch-from">
              {projectRows?.branches.map((b) => <option key={b.name} value={b.name}>{b.subject}</option>)}
            </datalist>
          </Field>
          <p className="hint">
            {nameTaken ? `${newName.trim()} exists already: tick it in the list below instead.`
              : 'Creates the branch and a WorkDesk for it. Branches you tick in the list are included, so one WorkDesk can mix new and existing ones.'}
          </p>
        </Modal>
      )}
      {data?.length === 0 && <p className="empty">Register a Project first (Projects page).</p>}

      {groups.map((g) => {
        const open = !collapsed.includes(g.project)
        return (
          <div key={g.project} className="pr-group">
            <div className="pr-group-head" onClick={() => setCollapsed((c) => (open ? [...c, g.project] : c.filter((x) => x !== g.project)))}>
              <span className="chevron">{open ? '▾' : '▸'}</span>
              <strong>{g.project}</strong>
              {!g.error && <span className="count">{g.shown.length}{g.shown.length !== g.branches.length ? ` / ${g.branches.length}` : ''}</span>}
            </div>
            {open && g.error && <div className="error">{g.error}</div>}
            {open && !g.error && g.shown.length === 0 && <div className="empty">{g.branches.length === 0 ? 'No branches' : 'All filtered out'}</div>}
            {open &&
              g.shown.map((b) => {
                const taken = !!b.inDesk || !!b.checkedOutAt
                const k = key(g.project, b.name)
                return (
                  <div
                    key={k}
                    className={'branch-row' + (taken ? ' dim' : '') + (selected.includes(k) ? ' selected' : '') + (detail?.project === g.project && detail.branch === b.name ? ' open' : '')}
                    onClick={() => setDetail({ project: g.project, branch: b.name })}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      const items: MenuItem[] = [
                        { label: 'Show details', onClick: () => setDetail({ project: g.project, branch: b.name }) },
                        { label: selected.includes(k) ? 'Unselect' : 'Select for a new WorkDesk', disabled: taken, why: 'It is already in a WorkDesk or checked out', onClick: () => toggle(k) },
                        ...(b.inDesk ? [{ label: `Open ${b.inDesk.name}`, onClick: () => openDesk(b.inDesk!.id) }] : []),
                        { label: 'Copy branch name', onClick: () => void navigator.clipboard.writeText(b.name) },
                      ]
                      setRowMenu({ x: e.clientX, y: e.clientY, items })
                    }}
                    title="Show details"
                  >
                    <input type="checkbox" disabled={taken} checked={selected.includes(k)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(k)} />
                    <code className="bname">{b.name}</code>
                    {b.local && <span className="chip small" title="a local branch exists">local</span>}
                    {b.remote && <span className="chip small" title="on origin">origin</span>}
                    {b.inDesk && (
                      <button className="chip small link" title="Open that WorkDesk" onClick={(e) => (e.preventDefault(), openDesk(b.inDesk!.id))}>
                        in {b.inDesk.name}
                      </button>
                    )}
                    {!b.inDesk && b.checkedOutAt && <span className="chip small" title={b.checkedOutAt}>checked out elsewhere</span>}
                    <span className="bsubject" title={b.subject}>{b.subject}</span>
                    <span className="bmeta">{b.author} · {ago(b.date)}</span>
                  </div>
                )
              })}
          </div>
        )
      })}

      {selected.length > 0 && (
        <div className="selection-bar">
          <span>
            {selected.length} branch{selected.length === 1 ? '' : 'es'} selected
            <small className="hint"> in {[...new Set(refs.map((r) => r.project))].join(', ')}</small>
          </span>
          <button onClick={() => setSelected([])}>Clear</button>
          {targets.length > 0 && (
            <>
              <select value={addTo ?? ''} onChange={(e) => setAddTo(e.target.value || undefined)} title="An open WorkDesk to add the branches to">
                <option value="">Add to WorkDesk…</option>
                {targets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <button
                disabled={!addTo || adding}
                onClick={async () => {
                  const id = addTo!
                  setAdding(true)
                  await run(() => api.addExistingBranches(id, refs))
                  setAdding(false)
                  setAddTo(undefined)
                  setSelected([])
                  void load(false)
                  openDesk(id)
                }}
              >
                {adding && <Spinner />} Add
              </button>
            </>
          )}
          <button className="primary" onClick={() => setStart({ kind: 'branches', todoIds: [], branches: refs, defaultName: refs[0].branch })}>
            Create WorkDesk…
          </button>
        </div>
      )}
      {start && (
        <StartPanel
          request={start}
          run={run}
          onClose={() => setStart(undefined)}
          onStarted={(st) => {
            setSelected([])
            setNewName('')
            setNewFrom('')
            void load(false)
            // open the WorkDesk that was just made
            const known = new Set((data ?? []).flatMap((p) => p.branches.map((b) => b.inDesk?.id)).filter(Boolean))
            const asked = [...refs, ...(start?.newBranches ?? []).map((n) => ({ project: n.project, branch: n.branch }))]
            const made = [...st.desks].reverse().find((d) => !known.has(d.id) && d.branches.some((b) => asked.some((r) => r.project === b.project && r.branch === b.branch)))
            if (made) openDesk(made.id)
          }}
        />
      )}
    </section>
    <aside className="side-pane">
      {detail ? (
        <BranchDetail
          key={detail.project + '\u0000' + detail.branch}
          project={detail.project}
          branch={detail.branch}
          desks={desks}
          run={run}
          openDesk={openDesk}
          onChanged={() => void load(false)}
          onClose={() => setDetail(undefined)}
          onCreateDesk={() => setStart({ kind: 'branches', todoIds: [], branches: [{ project: detail.project, branch: detail.branch }], defaultName: detail.branch })}
        />
      ) : (
        <p className="empty">Click a branch to see its details, add it to a WorkDesk, or delete it.</p>
      )}
    </aside>
    </div>
  )
}
