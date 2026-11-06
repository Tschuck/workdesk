import { useState } from 'react'
import { cssColor, DEFAULT_PROFILE_ID, THEME_COLOR } from '../main/domain/profiles'
import type { CredentialKind } from '../main/profiles-ipc'
import { useAccounts } from './accounts'
import { Field, Modal } from './Modal'
import { CRED_LABEL, useProfilesState } from './ProfilesSettings'
import './profiles.css'

/** Settings → the Profile in view: its name and colour, Status Repo, Claude Account, logins and Projects on one page (changes apply at once). */
export function ProfileDetail() {
  const api = window.workdesk
  const accounts = useAccounts()
  const { state, error, setError, busy, act } = useProfilesState()
  const [name, setName] = useState<{ id: string; text: string }>()
  const [token, setToken] = useState<{ kind: CredentialKind; text: string }>()
  const [removing, setRemoving] = useState(false)
  if (!state) return <p className="hint">Loading …</p>
  const p = state.config.profiles.find((x) => x.id === state.config.active)
  if (!p) return <p className="hint">No Profile is in view.</p>
  const creds = state.credentials[p.id]
  const projects = state.projects[p.id] ?? 0
  const text = name?.id === p.id ? name.text : p.name

  const saveName = () => {
    const clean = text.trim()
    setName(undefined)
    if (clean && clean !== p.name) void act(() => api.profilesUpdate(p.id, { name: clean }))
  }

  return (
    <section className="profile-detail">
      <div className="profile-detail-head">
        <input type="color" aria-label="Colour" value={p.color === THEME_COLOR ? '#fabd2f' : p.color} onChange={(e) => void act(() => api.profilesUpdate(p.id, { color: e.target.value }))} />
        <input
          type="text"
          className="profile-detail-name"
          aria-label="Name"
          value={text}
          spellCheck={false}
          onChange={(e) => setName({ id: p.id, text: e.target.value })}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {p.id === DEFAULT_PROFILE_ID && <span className="chip small" title="Everything without a Profile tag, like all data from before Profiles, belongs to it">Profile #1</span>}
      </div>
      <p className="hint">
        What belongs to this Profile: its Todos and WorkDesks, the Status Repo they are kept in, the logins, the Claude Account and the Projects. Switch Profiles with the selector above or in the Settings navigation.
      </p>
      {error && !token && !removing && <p className="error-text">{error}</p>}

      <dl className="profile-detail-fields">
        <dt>Status Repo</dt>
        <dd>
          <select value={p.repoId} disabled={busy} onChange={(e) => void act(() => api.profilesUpdate(p.id, { repoId: e.target.value }))}>
            {state.repos.map((r) => <option key={r.id} value={r.id}>{r.label}{r.available ? '' : ' (not available)'}</option>)}
          </select>
          <small className="hint">New Todos and WorkDesks go there; what exists stays where it is. Repos are managed under Settings → Status Repos.</small>
        </dd>
        <dt>Claude Account</dt>
        <dd>
          <select value={p.claudeAccountId ?? ''} disabled={busy} onChange={(e) => void act(() => api.profilesUpdate(p.id, { claudeAccountId: e.target.value || null }))}>
            <option value="">default{accounts ? ` (${accounts.accounts.find((a) => a.isDefault)?.account.name ?? ''})` : ''}</option>
            {(accounts?.accounts ?? []).map((a) => <option key={a.account.id} value={a.account.id}>{a.account.name}</option>)}
          </select>
          <small className="hint">For the terminals of WorkDesks of this Profile that have no Account of their own.</small>
        </dd>
        <dt>Projects</dt>
        <dd>{projects} Project{projects === 1 ? '' : 's'} <small className="hint">listed under this Profile (set under Projects)</small></dd>
        <dt>Logins</dt>
        <dd>
          {(Object.keys(CRED_LABEL) as CredentialKind[]).map((k) => (
            <div key={k} className="cred-row">
              <span className="cred-name">{CRED_LABEL[k]}</span>
              <span className={creds?.[k] ? 'ok' : 'none'}>{creds?.[k] ? 'set' : 'none'}</span>
              {k !== 'notion' &&
                (creds?.[k] ? (
                  <button type="button" disabled={busy} onClick={() => void act(() => api.profilesClearToken(p.id, k))}>Remove</button>
                ) : (
                  <button type="button" disabled={busy} onClick={() => (setError(undefined), setToken({ kind: k, text: '' }))}>Set token …</button>
                ))}
            </div>
          ))}
          <small className="hint">
            Notion is connected on its own page, and GitLab / Jira addresses are set on theirs, while this Profile is the one in view. The Keychain items are named <code>workdesk-profile-{p.id}-…</code>; a GitHub login through <code>gh</code> is shared by all Profiles.
          </small>
        </dd>
      </dl>

      {p.id !== DEFAULT_PROFILE_ID && (
        <div className="profile-detail-danger">
          <button className="danger" onClick={() => (setError(undefined), setRemoving(true))}>Remove this Profile …</button>
        </div>
      )}

      {token && (
        <Modal
          title={`${CRED_LABEL[token.kind]} token for ${p.name}`}
          submitLabel="Save"
          busy={busy}
          error={error}
          canSubmit={!!token.text.trim()}
          onClose={() => setToken(undefined)}
          onSubmit={() => void act(() => api.profilesSetToken(p.id, token.kind, token.text)).then((ok) => ok && setToken(undefined))}
        >
          <Field label="Token" hint="It goes to the Keychain and is never shown again.">
            <input type="password" autoFocus autoComplete="off" value={token.text} onChange={(e) => setToken({ ...token, text: e.target.value })} />
          </Field>
        </Modal>
      )}
      {removing && (
        <Modal title={`Remove the Profile "${p.name}"?`} submitLabel="Remove" busy={busy} error={error} onClose={() => setRemoving(false)} onSubmit={() => void act(() => api.profilesRemove(p.id)).then((ok) => ok && setRemoving(false))}>
          <p className="hint">
            Its Todos, WorkDesks{projects ? ` and ${projects} Project${projects === 1 ? '' : 's'}` : ''} are not deleted: they move to the Default Profile. Its stored tokens are removed from the Keychain. Its Status Repo stays registered and nothing in it is touched.
          </p>
        </Modal>
      )}
    </section>
  )
}
