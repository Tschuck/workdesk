import { useEffect, useState } from 'react'
import type { GithubAuth } from '../main/sources/github/transport'
import { Field, Modal } from './Modal'

export function GithubSetup({ onReady }: { onReady: (connected: boolean) => void }) {
  const api = window.workdesk
  const [auth, setAuth] = useState<GithubAuth>()
  const [token, setToken] = useState('')
  const [adding, setAdding] = useState(false)
  const apply = (a: GithubAuth) => {
    setAuth(a)
    onReady(a.kind !== 'none')
  }
  useEffect(() => void api.githubStatus().then(apply), []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <p className="hint">
        Pull Requests where you are asked for a review. A Pull Request is reviewed in a WorkDesk when you start it, or in a planned one when you add it to today.
        Login: {auth?.kind === 'token' ? 'personal access token (Keychain)' : auth?.kind === 'gh' ? 'GitHub CLI (gh)' : 'not connected'}
      </p>
      <p>
        <button onClick={() => setAdding(true)}>{auth?.kind === 'token' ? 'Change token …' : 'Set a token …'}</button>{' '}
        {auth?.kind === 'token' && <button onClick={() => void api.githubClearToken().then(apply)}>Remove token</button>}
      </p>
      {adding && (
        <Modal title="GitHub personal access token" submitLabel="Save token" canSubmit={!!token.trim()} onClose={() => (setAdding(false), setToken(''))} onSubmit={() => void api.githubSetToken(token).then((a) => (setToken(''), setAdding(false), apply(a)))}>
          <Field label="Token" hint="Stored in the macOS Keychain.">
            <input type="password" autoFocus autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
          </Field>
        </Modal>
      )}
    </>
  )
}
