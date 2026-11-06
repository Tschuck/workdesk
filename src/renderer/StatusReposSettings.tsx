import { useState } from 'react'
import { Field, Modal, PageHead } from './Modal'
import { StatusRepoPanel } from './StatusRepoPanel'
import { useProfilesState } from './ProfilesSettings'
import './profiles.css'

/** Settings → Status Repos: the git repos Todos and WorkDesks are kept in, one or several; + points to a folder or clones a remote. Which Profile uses which is set on the Profile. */
export function StatusReposSettings() {
  const api = window.workdesk
  const { state, error, setError, busy, act } = useProfilesState()
  const [adding, setAdding] = useState(false)
  const [backup, setBackup] = useState<string>()
  if (!state) return <p className="hint">Loading …</p>
  const { config, repos } = state
  const backupRepo = repos.find((r) => r.id === backup)

  return (
    <section className="profiles-settings">
      <PageHead title="Status Repos" addLabel="Add a Status Repo" onAdd={() => (setError(undefined), setAdding(true))} />
      <p className="hint">
        Your Todos and WorkDesks are kept in git repos you own. Profiles can share a Status Repo (each then sees only its own Todos and WorkDesks) or have one each. Repeating WorkDesks, templates, Projects, favorites and the other settings shared by all Profiles stay in the first one (<code>workdesk-status</code>).
      </p>
      {error && !adding && <p className="error-text">{error}</p>}
      <ul className="repo-list">
        {repos.map((r) => (
          <li key={r.id}>
            <div className="repo-head">
              <strong>{r.label}</strong> {r.available ? '' : <span className="error-text">not available{r.error ? `: ${r.error}` : ''}</span>}
              <span className="repo-actions">
                {r.available && <button onClick={() => setBackup(r.id)}>Backup remote …</button>}
                {r.id !== 'home' && r.profileIds.length === 0 && r.todos + r.desks === 0 && <button disabled={busy} onClick={() => void act(() => api.profilesForgetRepo(r.id))}>Forget</button>}
              </span>
            </div>
            <div><code>{r.path}</code></div>
            <div className="hint">
              {r.todos} Todos, {r.desks} WorkDesks · used by {r.profileIds.map((id) => config.profiles.find((p) => p.id === id)?.name).filter(Boolean).join(', ') || 'no Profile'}
              {r.remote ? <> · pushed to <code>{r.remote}</code></> : ' · local only'}
            </div>
          </li>
        ))}
      </ul>
      {adding && <AddRepo busy={busy} error={error} onClose={() => setAdding(false)} onAdd={(input) => void act(() => api.profilesAddRepo(input)).then((ok) => ok && setAdding(false))} />}
      {backupRepo && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setBackup(undefined)}>
          <div className="modal form-modal wide" role="dialog" aria-label={`Backup of ${backupRepo.label}`}>
            <h3>{backupRepo.label}</h3>
            <StatusRepoPanel repoId={backupRepo.id} />
            <div className="modal-actions"><button onClick={() => setBackup(undefined)}>Close</button></div>
          </div>
        </div>
      )}
    </section>
  )
}

function AddRepo({ busy, error, onClose, onAdd }: { busy: boolean; error?: string; onClose: () => void; onAdd: (input: { mode: 'point' | 'clone'; path: string; url: string; label: string }) => void }) {
  const [mode, setMode] = useState<'point' | 'clone'>('point')
  const [path, setPath] = useState('')
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  return (
    <Modal
      title="Add a Status Repo"
      submitLabel={mode === 'point' ? 'Add Status Repo' : 'Clone and add'}
      busy={busy}
      error={error}
      canSubmit={mode === 'point' ? !!path.trim() : !!url.trim()}
      onClose={onClose}
      onSubmit={() => onAdd({ mode, path, url, label })}
    >
      <Field label="How">
        <select value={mode} onChange={(e) => setMode(e.target.value as 'point' | 'clone')}>
          <option value="point">Use a folder (new or existing)</option>
          <option value="clone">Clone a remote</option>
        </select>
      </Field>
      {mode === 'clone' && <Field label="Remote address"><input autoFocus placeholder="git@github.com:you/status-b.git" value={url} spellCheck={false} onChange={(e) => setUrl(e.target.value)} /></Field>}
      <Field label="Folder" hint={mode === 'point' ? 'Absolute path; made and git-initialised if new.' : 'Empty = next to the WorkDesks.'}>
        <input autoFocus={mode === 'point'} placeholder={mode === 'point' ? '/Users/you/status-b' : 'optional'} value={path} spellCheck={false} onChange={(e) => setPath(e.target.value)} />
      </Field>
      <Field label="Name (optional)"><input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
    </Modal>
  )
}
