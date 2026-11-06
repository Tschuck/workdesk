import { useEffect, useState } from 'react'
import type { ProjectInfo } from '../main/projects/projects'
import { Field, Modal, PageHead } from './Modal'
import { useProfilesState } from './ProfilesSettings'

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function ProjectRow({ p, index, count, act, profiles, profileId, onProfile }: { p: ProjectInfo; index: number; count: number; act: (promise: Promise<ProjectInfo[]>) => void; profiles: { id: string; name: string }[]; profileId?: string; onProfile: (id: string) => void }) {
  const api = window.workdesk
  const [renaming, setRenaming] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [setup, setSetup] = useState((p.envSetup ?? []).join('\n'))
  const [checkout, setCheckout] = useState((p.checkoutCommands ?? []).join('\n'))

  useEffect(() => setSetup((p.envSetup ?? []).join('\n')), [p.envSetup])
  useEffect(() => setCheckout((p.checkoutCommands ?? []).join('\n')), [p.checkoutCommands])

  return (
    <li className="project-row">
      {renaming ? (
        <input
          className="title"
          autoFocus
          defaultValue={p.name}
          onBlur={() => setRenaming(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setRenaming(false)
            if (e.key === 'Enter') {
              const next = e.currentTarget.value.trim()
              setRenaming(false)
              if (next && next !== p.name) act(api.renameProject(p.name, next))
            }
          }}
        />
      ) : (
        <span className="title">{p.name}</span>
      )}
      <span className="chip small">{p.origin === 'bare-clone' ? 'bare clone' : 'existing clone'}</span>
      {profiles.length > 1 && profileId && (
        <select className="project-profile" value={profileId} aria-label={`Profile of ${p.name}`} title="The Profile this Project is listed under" onChange={(e) => onProfile(e.target.value)}>
          {profiles.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
        </select>
      )}
      <span className="actions">
        <button title="Move up" disabled={index === 0} onClick={() => act(api.moveProject(p.name, index - 1))}>↑</button>
        <button title="Move down" disabled={index === count - 1} onClick={() => act(api.moveProject(p.name, index + 1))}>↓</button>
        <button onClick={() => setRenaming(true)}>Rename</button>
        {confirmRemove ? (
          <>
            <button
              className="danger"
              title="Unregisters the Project; the clone stays on disk"
              onClick={() => (setConfirmRemove(false), act(api.removeProject(p.name)))}
            >
              Really remove
            </button>
            <button onClick={() => setConfirmRemove(false)}>Cancel</button>
          </>
        ) : (
          <button onClick={() => setConfirmRemove(true)}>Remove</button>
        )}
      </span>
      <span className="paths">
        {p.url && <code title="cloned from">{p.url}</code>}
        <code title="stored at">{p.gitDir}</code>
      </span>
      <details className="env-details">
        <summary>
          .env files: {p.envFiles.length === 0 ? 'none stored yet' : `${p.envFiles.length} stored`}
          {p.envSetup && p.envSetup.length > 0 && <span className="chip small">{p.envSetup.length} setup command(s)</span>}
        </summary>
        <label>
          <input type="checkbox" checked={p.sharedEnv !== false} onChange={(e) => act(api.setSharedEnv(p.name, e.target.checked))} /> Use the shared .env files in every new Branch
        </label>
        <p className="hint">
          With the box ticked, the stored files are linked into every new Branch of this Project. Use the <strong>env</strong> button on a Branch in the sidebar to
          store its <code>.env</code> files or to link them again.
        </p>
        {p.envFiles.length > 0 && <ul className="env-files">{p.envFiles.map((f) => <li key={f}><code>{f}</code></li>)}</ul>}
        <label className="field">
          <span>Setup commands that regenerate the .env files (one per line, run in the Branch folder), e.g. pnpm apps:setup-env</span>
          <textarea rows={3} value={setup} onChange={(e) => setSetup(e.target.value)} />
        </label>
        <button onClick={() => act(api.setEnvSetup(p.name, setup.split('\n')))}>Save setup commands</button>
      </details>
      <details className="env-details">
        <summary>
          Commands after checkout
          {p.checkoutCommands && p.checkoutCommands.length > 0 && <span className="chip small">{p.checkoutCommands.length} command(s)</span>}
        </summary>
        <p className="hint">
          Whenever a Branch of this Project is checked out into a WorkDesk, a terminal Tab opens in the Branch folder and these commands are typed in,
          so you see them run. They are chained: the first one that fails stops the rest. The terminal stays open afterwards.
        </p>
        <label className="field">
          <span>One command per line, e.g. pnpm install</span>
          <textarea rows={3} value={checkout} placeholder="pnpm install" onChange={(e) => setCheckout(e.target.value)} />
        </label>
        <button onClick={() => act(api.setCheckoutCommands(p.name, checkout.split('\n')))}>Save commands</button>
      </details>
    </li>
  )
}

/** Register Projects: a bare clone made by the tool, or an existing clone worktrees are made from. */
export function ProjectsView() {
  const api = window.workdesk
  const profiles = useProfilesState()
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => void api.listProjects().then(setProjects), [api])

  const act = (p: Promise<ProjectInfo[]>) =>
    p.then(
      (list) => (setProjects(list), setError(undefined)),
      (e: Error) => setError(clean(e))
    )

  const profileList = profiles.state?.config.profiles ?? []
  const profileOf = (name: string) => profiles.state?.projectList.find((p) => p.name === name)?.profileId

  return (
    <section>
      <PageHead title="Projects" addLabel="Add a Project" onAdd={() => setAdding(true)} />
      <p className="hint">
        A Project is a git repository WorkDesks can check Branches out of. Clone it (kept as a bare clone in <code>.projects/</code>) or
        point to a clone you already have; its <code>.env</code> files are then taken into the env store. The order here is the order
        used when picking Projects. Removing only unregisters; the clone stays on disk.
      </p>
      {error && <div className="error" onClick={() => setError(undefined)}>{error}</div>}
      <ul className="todos">
        {projects.map((p, i) => (
          <ProjectRow
            key={p.name}
            p={p}
            index={i}
            count={projects.length}
            act={(promise) => void act(promise)}
            profiles={profileList}
            profileId={profileOf(p.name)}
            onProfile={(id) => void profiles.act(() => api.profilesSetProjectProfile(p.name, id))}
          />
        ))}
        {projects.length === 0 && <li className="empty">No Projects yet.</li>}
      </ul>
      {adding && (
        <AddProject
          profiles={profileList}
          viewProfile={profiles.state?.config.active}
          onClose={() => setAdding(false)}
          onAdd={async (existing, name, where, profileId) => {
            await act(existing ? api.addProjectExisting(name, where) : api.addProjectClone(name, where))
            if (profileId && profileId !== profileOf(name)) await profiles.act(() => api.profilesSetProjectProfile(name, profileId))
            setAdding(false)
          }}
        />
      )}
    </section>
  )
}

function AddProject({ profiles, viewProfile, onClose, onAdd }: { profiles: { id: string; name: string }[]; viewProfile?: string; onClose: () => void; onAdd: (existing: boolean, name: string, where: string, profileId?: string) => Promise<void> }) {
  const [existing, setExisting] = useState(false)
  const [name, setName] = useState('')
  const [where, setWhere] = useState('')
  const [profileId, setProfileId] = useState(profiles.find((p) => p.id === viewProfile)?.id ?? profiles[0]?.id)
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      title="Add a Project"
      submitLabel={existing ? 'Use existing clone' : 'Clone'}
      busy={busy}
      canSubmit={!!name.trim() && !!where.trim()}
      onClose={onClose}
      onSubmit={() => (setBusy(true), void onAdd(existing, name.trim(), where.trim(), profileId).finally(() => setBusy(false)))}
    >
      <Field label="How">
        <select value={existing ? 'existing' : 'clone'} onChange={(e) => setExisting(e.target.value === 'existing')}>
          <option value="clone">Clone a remote (kept as a bare clone)</option>
          <option value="existing">Use a clone I already have</option>
        </select>
      </Field>
      <Field label="Name"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={existing ? 'Path of the existing clone' : 'Clone URL'}><input value={where} spellCheck={false} onChange={(e) => setWhere(e.target.value)} /></Field>
      {profiles.length > 1 && (
        <Field label="Profile">
          <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </Field>
      )}
    </Modal>
  )
}
