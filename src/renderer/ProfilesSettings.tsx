import { useCallback, useEffect, useState } from 'react'
import { cssColor, DEFAULT_PROFILE_ID, THEME_COLOR, type Profile } from '../main/domain/profiles'
import type { CredentialKind, ProfilesState } from '../main/profiles-ipc'
import { useAccounts } from './accounts'
import { Field, Modal, PageHead } from './Modal'
import { onProfilesRequest, takeProfilesRequest } from './profiles-request'
import './profiles.css'

export const cleanError = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export const CRED_LABEL: Record<CredentialKind, string> = { github: 'GitHub', notion: 'Notion', gitlab: 'GitLab', jira: 'Jira' }

/** The state of the Profiles, kept fresh, with a way to run a change that answers with the new state. */
export function useProfilesState() {
  const api = window.workdesk
  const [state, setState] = useState<ProfilesState>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void api.profilesState().then(setState)
    return api.onProfilesChanged(() => void api.profilesState().then(setState))
  }, [api])
  /** run a change; the answer is the new state, a failure is shown */
  const act = useCallback(async (change: () => Promise<ProfilesState>): Promise<boolean> => {
    setBusy(true)
    setError(undefined)
    try {
      setState(await change())
      return true
    } catch (e) {
      setError(cleanError(e))
      return false
    } finally {
      setBusy(false)
    }
  }, [])
  return { state, error, setError, busy, act }
}

/** Settings → Profiles: the Profiles as a list; + adds one, Edit changes name, colour, Status Repo, Claude Account and logins. Projects and Status Repos have their own pages. */
export function ProfilesSettings({ onOpenProfile }: { onOpenProfile: (id: string) => void }) {
  const api = window.workdesk
  const accounts = useAccounts()
  const { state, error, setError, busy, act } = useProfilesState()
  const [adding, setAdding] = useState(false)
  // the navigation of the Settings asks for a dialog: add a Profile, or edit one
  useEffect(() => {
    const take = () => {
      const r = takeProfilesRequest()
      if (!r) return
      if ('add' in r) (setError(undefined), setAdding(true))
    }
    take()
    return onProfilesRequest(take)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!state) return <p className="hint">Loading …</p>
  const { config, repos } = state

  return (
    <section className="profiles-settings">
      <PageHead title="Profiles" addLabel="Add a Profile" onAdd={() => (setError(undefined), setAdding(true))} />
      <p className="hint">
        A Profile bundles the work of one product: its Todos and WorkDesks, the Status Repo they are kept in, the logins (GitHub, Notion, GitLab, Jira), the Claude Account and the Projects. The selector under the WORKDESK title decides which Profile the sidebar, Dashboard, Work items, palette and search show. Everything keeps running for all Profiles, in view or not.
      </p>
      {error && !adding && <p className="error-text">{error}</p>}

      <ul className="profile-list">
        {config.profiles.map((p) => {
          const creds = state.credentials[p.id]
          const account = accounts?.accounts.find((a) => a.account.id === p.claudeAccountId)?.account.name
          const set = (Object.keys(CRED_LABEL) as CredentialKind[]).filter((k) => creds?.[k]).map((k) => CRED_LABEL[k])
          return (
            <li key={p.id} className="profile-item">
              <span className="profile-dot" style={{ background: cssColor(p.color) }} />
              <span className="profile-item-main">
                <strong>{p.name}</strong>{p.id === DEFAULT_PROFILE_ID && <span className="chip small" title="Everything without a Profile tag, like all data from before Profiles, belongs to it">Profile #1</span>}
                <span className="hint">
                  Status Repo {repos.find((r) => r.id === p.repoId)?.label ?? p.repoId} · Claude {account ?? 'default'} · {state.projects[p.id] ?? 0} Project{(state.projects[p.id] ?? 0) === 1 ? '' : 's'} · logins: {set.length ? set.join(', ') : 'none'}
                </span>
              </span>
              <button onClick={() => onOpenProfile(p.id)}>Details …</button>
            </li>
          )
        })}
      </ul>

      {adding && <AddProfile busy={busy} error={error} repos={repos} onClose={() => setAdding(false)} onAdd={(name, repoId) => void act(() => api.profilesAdd(name, repoId)).then((ok) => ok && setAdding(false))} />}
    </section>
  )
}

function AddProfile({ repos, busy, error, onClose, onAdd }: { repos: ProfilesState['repos']; busy: boolean; error?: string; onClose: () => void; onAdd: (name: string, repoId: string) => void }) {
  const [name, setName] = useState('')
  const [repoId, setRepoId] = useState(repos[0]?.id ?? 'home')
  return (
    <Modal title="Add a Profile" busy={busy} error={error} canSubmit={!!name.trim()} onClose={onClose} onSubmit={() => onAdd(name, repoId)}>
      <Field label="Name"><input type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Product B" /></Field>
      <Field label="Status Repo" hint="Where its new Todos and WorkDesks are kept. Add another repo under Settings → Status Repos.">
        <select value={repoId} onChange={(e) => setRepoId(e.target.value)}>{repos.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
      </Field>
    </Modal>
  )
}
