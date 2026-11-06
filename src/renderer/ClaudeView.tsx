import { useEffect, useState } from 'react'
import type { AccountView } from '../main/claude/accounts'
import type { ClaudeDirStatus } from '../main/claude/config'
import { limitLevel } from '../main/domain/claude-accounts'
import { useAccounts } from './accounts'
import './claude-accounts.css'
import { Spinner } from './Spinner'
import { AddButton, Field, Modal } from './Modal'
import { SkillsPanel } from './SkillsPanel'

const plain = (e: Error): string => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function Meter({ label, pct, resets }: { label: string; pct?: number; resets?: string }) {
  if (pct === undefined) return null
  const level = limitLevel(pct)
  return (
    <div className="usage-limit">
      <div className="usage-label-row">
        <span>{label}</span>
        <span className={'usage-pct usage-' + level}>{pct}% used</span>
      </div>
      <div className="usage-bar big"><span className={'usage-fill usage-' + level} style={{ width: Math.min(100, pct) + '%' }} /></div>
      {resets && <div className="hint">Resets {resets}</div>}
    </div>
  )
}

/** One Account: name, folder, login and its usage. */
function AccountCard({ view, folders, only, onError }: { view: AccountView; folders: string[]; only: boolean; onError: (m: string | undefined) => void }) {
  const api = window.workdesk
  const { account, usage } = view
  const [name, setName] = useState(account.name)
  const [dir, setDir] = useState(account.configDir ?? '')
  useEffect(() => setName(account.name), [account.name])
  useEffect(() => setDir(account.configDir ?? ''), [account.configDir])
  const act = (p: Promise<unknown>) => p.then(() => onError(undefined), (e: Error) => onError(plain(e)))

  return (
    <div className={'panel acct-card' + (view.isDefault ? ' is-default' : '')}>
      <div className="acct-head">
        <input
          className="acct-name-input"
          value={name}
          aria-label="Account name"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => (name.trim() && name.trim() !== account.name ? void act(api.accountsRename(account.id, name.trim())) : setName(account.name))}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {view.isDefault ? <span className="badge" title="WorkDesks without their own choice run Claude under this Account">default</span> : <button onClick={() => void act(api.accountsSetDefault(account.id))}>Make default</button>}
        <span className="grow" />
        <button disabled={only} title={only ? 'The last Account cannot be removed' : 'Forget this Account (the login itself is not touched)'} onClick={() => void act(api.accountsRemove(account.id))}>Remove</button>
      </div>
      <label className="field">
        <span>Config folder (CLAUDE_CONFIG_DIR)</span>
        <input
          list={'acct-dirs-' + account.id}
          placeholder="empty = the default login of Claude Code"
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          onBlur={() => dir.trim() !== (account.configDir ?? '') && void act(api.accountsSetDir(account.id, dir.trim()))}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <datalist id={'acct-dirs-' + account.id}>{folders.map((f) => <option key={f} value={f} />)}</datalist>
      </label>

      {!usage.enabled ? (
        <p className="hint">Usage is switched off below.</p>
      ) : !usage.auth && usage.loading ? (
        <p className="hint">Checking the login…</p>
      ) : usage.auth && !usage.auth.loggedIn ? (
        <div className="login-box">
          <p><strong>Not logged in</strong></p>
          <p className="hint">{usage.auth.error ?? 'WorkDesk needs a login to read the usage. Nothing is opened until you press the button.'}</p>
          {usage.login.running ? (
            <div className="actions">
              <span className="hint"><Spinner /> Finish the login in your browser…</span>
              <button onClick={() => void api.accountsCancelLogin(account.id)}>Cancel</button>
            </div>
          ) : (
            <div className="actions"><button className="primary" onClick={() => void api.accountsLogin(account.id)}>Log in to Claude</button></div>
          )}
          {usage.login.url && usage.login.running && (
            <p className="hint">
              Browser did not open? <a className="detail-link" href={usage.login.url} onClick={(e) => (e.preventDefault(), void api.openExternal(usage.login.url!))}>Open the login page</a>
            </p>
          )}
          {usage.login.error && <div className="error">{usage.login.error}</div>}
        </div>
      ) : !usage.auth ? (
        <p className="hint">Not read yet. {usage.why}</p>
      ) : (
        <>
          <dl className="facts">
            <dt>Login</dt>
            <dd>{usage.auth.email ?? 'logged in'}{usage.auth.orgName ? ` · ${usage.auth.orgName}` : ''}</dd>
            <dt>Plan</dt>
            <dd>{[usage.auth.plan, usage.auth.method].filter(Boolean).join(' · ') || '—'}</dd>
          </dl>
          {usage.usage ? (
            <>
              <Meter label="Current session (5 hours)" pct={usage.usage.session} resets={usage.usage.sessionResets} />
              <Meter label="Current week (all models)" pct={usage.usage.week} resets={usage.usage.weekResets} />
              <p className="hint">
                Last read {new Date(usage.usage.at).toLocaleTimeString()}
                {usage.retryAt && ` · rate limited by Claude, trying again at ${new Date(usage.retryAt).toLocaleTimeString()}`}
              </p>
            </>
          ) : (
            <p className="hint">
              {usage.loading ? 'Reading usage…'
                : usage.retryAt ? `Claude's usage endpoint is rate limited; trying again at ${new Date(usage.retryAt).toLocaleTimeString()}, waiting longer each time.`
                : `No usage reading: ${usage.why || 'waiting'}`}
            </p>
          )}
          <p className="actions">
            <button disabled={usage.loading} title={usage.retryAt ? 'Claude asked to wait; this only asks again after that' : undefined} onClick={() => void api.accountsRefresh(account.id)}>Refresh</button>
            <span className="grow" />
            <button title="Log this Account out of Claude Code" onClick={() => void act(api.accountsLogout(account.id))}>Log out</button>
          </p>
        </>
      )}
    </div>
  )
}

/** Claude Accounts (login, usage) and the WorkDesk hooks in their config directories (installed only on click). */
export function ClaudeView() {
  const api = window.workdesk
  const [dirs, setDirs] = useState<ClaudeDirStatus[]>([])
  const [suggested, setSuggested] = useState<string[]>([])
  const [path, setPath] = useState('')
  const [error, setError] = useState<string>()
  const [accountError, setAccountError] = useState<string>()
  const [newName, setNewName] = useState('')
  const [addingAccount, setAddingAccount] = useState(false)
  const [addingDir, setAddingDir] = useState(false)
  const [newDir, setNewDir] = useState('')
  const accounts = useAccounts()

  useEffect(() => {
    void api.claudeDirs().then(setDirs)
    void api.claudeDefaultDirs().then(setSuggested)
  }, [api])

  const act = (p: Promise<ClaudeDirStatus[]>) =>
    p.then((d) => {
      setDirs(d)
      setError(undefined)
    }, (e: Error) => setError(plain(e)))

  const folders = [...new Set([...dirs.map((d) => d.path), ...suggested])]

  return (
    <section>
      <h2>Claude</h2>
      <div className="page-head"><h3>Accounts</h3><AddButton label="Add an Account" onClick={() => (setAccountError(undefined), setAddingAccount(true))} /></div>
      <p className="hint">
        Every Account is one Claude login: a name and, for any but the default login, its own config folder. The usage of all of them shows at the bottom of the sidebar.
        A WorkDesk runs <code>claude</code> in its new terminals under the Account you pick in its settings (the default Account otherwise); terminals that are already open keep theirs.
        Install the hooks below in the folder of every Account, or its Claude sessions raise no Signals and are missing in the Claude overview.
      </p>
      {accountError && !addingAccount && <div className="error" onClick={() => setAccountError(undefined)}>{accountError}</div>}
      {!accounts ? <p className="hint">Loading…</p> : accounts.accounts.map((v) => (
        <AccountCard key={v.account.id} view={v} folders={folders} only={accounts.accounts.length === 1} onError={setAccountError} />
      ))}
      {addingAccount && (
        <Modal
          title="Add a Claude Account"
          error={accountError}
          canSubmit={!!newName.trim() || !!newDir.trim()}
          onClose={() => setAddingAccount(false)}
          onSubmit={() => void api.accountsAdd(newName.trim(), newDir.trim() || undefined).then(() => (setNewName(''), setNewDir(''), setAccountError(undefined), setAddingAccount(false)), (err: Error) => setAccountError(plain(err)))}
        >
          <Field label="Name"><input autoFocus placeholder="Work" value={newName} onChange={(e) => setNewName(e.target.value)} /></Field>
          <Field label="Config folder" hint="Empty = the default login.">
            <input list="acct-dirs-new" value={newDir} spellCheck={false} onChange={(e) => setNewDir(e.target.value)} />
            <datalist id="acct-dirs-new">{folders.map((f) => <option key={f} value={f} />)}</datalist>
          </Field>
        </Modal>
      )}

      <div className="panel">
        <h3>Usage settings</h3>
        <p className="hint">
          To read a usage, WorkDesk starts a hidden Claude Code session on its own tmux server, asks it for <code>/usage</code> and ends it again, one Account after the other (so at most one runs, for a few
          seconds). It reads every interval below, at once when you press reload, when the window comes back after longer than the interval, and after the screen was locked or the window out of focus for more than 30 minutes;
          nothing is read in between. It waits longer when Claude says it is rate limited, and only starts a session for an Account that is logged in.
        </p>
        {accounts && (
          <>
            <label className="pr-toggle">
              <input type="checkbox" checked={accounts.enabled} onChange={(e) => void api.accountsSetEnabled(e.target.checked)} /> show Claude usage
            </label>
            <label className="field inline">
              <span>Read every</span>
              <input
                type="number"
                min={1}
                max={60}
                disabled={!accounts.enabled}
                defaultValue={accounts.intervalMin}
                key={accounts.intervalMin}
                style={{ width: 60 }}
                onBlur={(e) => Number(e.target.value) !== accounts.intervalMin && void api.accountsSetInterval(Number(e.target.value))}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              <span>minutes</span>
            </label>
          </>
        )}
      </div>
      <div className="panel">
      <div className="page-head"><h3>Hooks</h3><AddButton label="Register a Claude config directory" onClick={() => setAddingDir(true)} /></div>
      <p className="hint">
        WorkDesk raises Signals ("Claude needs input", "Claude finished") through Claude Code hooks. Installing adds four hook
        entries (Notification, Stop, UserPromptSubmit, SessionStart) to the <code>settings.json</code> of the chosen
        configuration directory; your other settings stay untouched, and Remove takes exactly these entries out again.
      </p>
      {error && <div className="error" onClick={() => setError(undefined)}>{error}</div>}
      <ul className="todos">
        {dirs.map((d) => (
          <li key={d.path}>
            <span className="title">{d.path}</span>
            <span className={d.installed ? 'badge' : 'chip small'}>{d.installed ? 'installed' : 'not installed'}</span>
            <span className="actions">
              {d.installed ? (
                <button onClick={() => void act(api.claudeUninstall(d.path))}>Uninstall hooks</button>
              ) : (
                <button onClick={() => void act(api.claudeInstall(d.path))}>Install hooks</button>
              )}
              <button onClick={() => void act(api.claudeRemoveDir(d.path))}>Forget</button>
            </span>
          </li>
        ))}
        {dirs.length === 0 && <li className="empty">No Claude config directory registered.</li>}
      </ul>
      {addingDir && (
        <Modal
          title="Register a Claude config directory"
          submitLabel="Register"
          canSubmit={!!path.trim()}
          onClose={() => setAddingDir(false)}
          onSubmit={() => (void act(api.claudeAddDir(path.trim())), setPath(''), setAddingDir(false))}
        >
          <Field label="Directory"><input autoFocus placeholder="~/.claude" list="claude-dirs" value={path} spellCheck={false} onChange={(e) => setPath(e.target.value)} /></Field>
          <datalist id="claude-dirs">{suggested.filter((s) => !dirs.some((d) => d.path === s)).map((s) => <option key={s} value={s} />)}</datalist>
        </Modal>
      )}
      </div>
      <SkillsPanel dirs={dirs.map((d) => d.path)} />
    </section>
  )
}
