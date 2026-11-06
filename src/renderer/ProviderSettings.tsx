import { useEffect, useState } from 'react'
import { Field, Modal } from './Modal'
import type { ProviderKind } from '../main/sources/provider'
import type { ProviderStatus, Resolution } from '../main/sources/providers/registry'
import './provider-settings.css'

const KINDS: { kind: ProviderKind; label: string }[] = [
  { kind: 'github', label: 'GitHub' },
  { kind: 'gitlab', label: 'GitLab' },
  { kind: 'bitbucket', label: 'Bitbucket (not built)' },
  { kind: 'azure-devops', label: 'Azure DevOps (not built)' }
]

/** Shown on every provider that was written from the documentation and fixtures only. */
export function UntestedNotice() {
  return (
    <p className="provider-untested">
      Untested against a real account. This connection is built from the documented API and checked with handwritten examples only. If it works (or does not) for you, please say so.
    </p>
  )
}

/** Settings → GitLab / Jira Cloud: where, who, the token, and a test button. */
export function ProviderConnection({ kind }: { kind: 'gitlab' | 'jira' }) {
  const api = window.workdesk
  const [status, setStatus] = useState<ProviderStatus>()
  const [baseUrl, setBaseUrl] = useState('')
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [editing, setEditing] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string }>()
  const [error, setError] = useState('')

  const apply = (all: ProviderStatus[]) => {
    const s = all.find((x) => x.kind === kind)
    setStatus(s)
    setBaseUrl(s?.baseUrl ?? '')
    setEmail(s?.email ?? '')
  }
  useEffect(() => void api.providerStatus().then(apply), [kind]) // eslint-disable-line react-hooks/exhaustive-deps

  const gitlab = kind === 'gitlab'
  return (
    <section>
      <h2>{gitlab ? 'GitLab' : 'Jira Cloud'}</h2>
      <UntestedNotice />
      <p className="hint">
        {gitlab
          ? 'Merge requests, pipelines and approvals through the REST API v4. Create a personal access token with the scope read_api. For a self-hosted GitLab enter its address.'
          : 'Ticket status and transitions through the Jira Cloud REST API v3. Create an API token in your Atlassian account and enter it with the email of that account.'}
      </p>
      <p>
        {status?.hasToken ? <>Connected to <code>{status.baseUrl}</code>{status.email ? ` as ${status.email}` : ''}, token in the Keychain. </> : <span className="hint">No connection yet. </span>}
        <button onClick={() => (setError(''), setEditing(true))}>{status?.hasToken ? 'Change …' : 'Connect …'}</button>{' '}
        <button type="button" disabled={!status?.hasToken} onClick={() => void api.providerTest(kind).then(setResult)}>Test connection</button>{' '}
        {status?.hasToken && <button type="button" onClick={() => void api.providerClear(kind).then((all) => (setResult(undefined), apply(all)))}>Remove token</button>}
      </p>
      {editing && (
        <Modal
          title={gitlab ? 'Connect GitLab' : 'Connect Jira Cloud'}
          submitLabel="Save"
          error={error}
          canSubmit={!!baseUrl.trim()}
          onClose={() => (setEditing(false), setToken(''))}
          onSubmit={() => {
            setError('')
            setResult(undefined)
            api.providerSave(kind, { baseUrl, email, token }).then(
              (all) => (setToken(''), setEditing(false), apply(all)),
              (err: Error) => setError(err.message)
            )
          }}
        >
          <Field label="Address"><input autoFocus placeholder={gitlab ? 'https://gitlab.com' : 'https://your-site.atlassian.net'} value={baseUrl} spellCheck={false} onChange={(e) => setBaseUrl(e.target.value)} /></Field>
          {!gitlab && <Field label="Account email"><input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>}
          <Field label="API token" hint="Stored in the macOS Keychain.">
            <input type="password" autoComplete="off" placeholder={status?.hasToken ? 'stored; type to replace' : ''} value={token} onChange={(e) => setToken(e.target.value)} />
          </Field>
        </Modal>
      )}
      {error && !editing && <p className="provider-result bad">{error}</p>}
      {result && <p className={`provider-result ${result.ok ? 'good' : 'bad'}`}>{result.message}</p>}
    </section>
  )
}

/** Settings → Git hosts: which provider a remote belongs to, found from its host and overridable. */
export function GitHostsSettings() {
  const api = window.workdesk
  const [url, setUrl] = useState('')
  const [found, setFound] = useState<Resolution>()
  const [checking, setChecking] = useState(false)
  const label = (k?: ProviderKind) => KINDS.find((x) => x.kind === k)?.label ?? 'unknown'
  const show = (r: Resolution | undefined) => setFound(r)
  return (
    <section>
      <h2>Git hosts</h2>
      <p className="hint">
        The provider of a repository is found from the host of its git remote: github.com is GitHub, gitlab.* is GitLab, bitbucket.org is Bitbucket, dev.azure.com is Azure DevOps. A host with another name, such as a self-hosted
        GitLab, can be set by hand, for the whole host or for one repository.
      </p>
      <p><button onClick={() => setChecking(true)}>Check a remote …</button></p>
      {checking && (
        <Modal title="Check a remote" submitLabel="Check" canSubmit={!!url.trim()} onClose={() => setChecking(false)} onSubmit={() => void api.providerResolve(url).then((r) => (show(r), setChecking(false)))}>
          <Field label="Remote URL"><input autoFocus placeholder="git@git.example.com:team/app.git" value={url} spellCheck={false} onChange={(e) => setUrl(e.target.value)} /></Field>
        </Modal>
      )}
      {found && (
        <div className="provider-found">
          <p>
            {found.repo.host} / {found.repo.path}: <strong>{label(found.kind)}</strong> {found.by === 'none' ? '' : `(${found.by === 'detected' ? 'from the host name' : found.by === 'host' ? 'set for the host' : 'set for this repository'})`}
          </p>
          {(['host', 'repo'] as const).map((scope) => (
            <div key={scope} className="provider-scope">
              <span>For this {scope}:</span>
              {KINDS.filter((k) => k.kind === 'github' || k.kind === 'gitlab').map((k) => (
                <button key={k.kind} className={found.by === scope && found.kind === k.kind ? 'on' : ''} onClick={() => void api.providerForce(url, scope, k.kind).then(show)}>
                  {k.label}
                </button>
              ))}
              <button onClick={() => void api.providerForce(url, scope, undefined).then(show)}>Automatic</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
