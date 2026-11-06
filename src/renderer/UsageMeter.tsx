import type { AccountView } from '../main/claude/accounts'
import { limitLevel } from '../main/domain/claude-accounts'
import { clock, useAccounts } from './accounts'
import './claude-accounts.css'
import { SideSection } from './SideSection'

function Bar({ label, pct, resets }: { label: string; pct?: number; resets?: string }) {
  if (pct === undefined) return null
  const level = limitLevel(pct)
  return (
    <div className="usage-row" title={resets ? `${label}: resets ${resets}` : label}>
      <span className="usage-label">{label}</span>
      <span className="usage-bar"><span className={'usage-fill usage-' + level} style={{ width: Math.min(100, pct) + '%' }} /></span>
      <span className={'usage-pct usage-' + level}>{pct}%</span>
    </div>
  )
}

/** One Account: its name (when there are several) and its two bars, or why there are none. */
function AccountRows({ view, named, onSettings }: { view: AccountView; named: boolean; onSettings: () => void }) {
  const u = view.usage
  const r = u.usage
  const label = named ? (
    <div className="acct-name" title={u.auth?.email ?? view.account.configDir ?? 'default login'}>
      <span className="acct-label">{view.account.name}</span>
      {view.isDefault && <small className="hint">default</small>}
    </div>
  ) : null
  if (u.auth && !u.auth.loggedIn) {
    return <div className="acct">{label}<button className="usage-off" onClick={onSettings}>not logged in →</button></div>
  }
  return (
    <div className="acct">
      {label}
      {r ? (
        <>
          <Bar label="Session" pct={r.session} resets={r.sessionResets} />
          <Bar label="Week" pct={r.week} resets={r.weekResets} />
          {u.retryAt && <div className="usage-why" title="Claude's usage endpoint asked to wait">Rate limited; trying again at {clock(u.retryAt)}</div>}
        </>
      ) : (
        <div className="usage-why" title={u.why}>
          {u.loading ? 'Reading usage…' : u.retryAt ? `Rate limited by Claude; trying again at ${clock(u.retryAt)}` : `Unavailable: ${u.why || 'no reading yet'}`}
        </div>
      )}
    </div>
  )
}

/** Claude usage of every Account, always visible at the bottom of the sidebar. */
export function UsageMeter({ open, onToggle, onSettings }: { open: boolean; onToggle: (open: boolean) => void; onSettings: () => void }) {
  const api = window.workdesk
  const s = useAccounts()
  const title = { title: 'Claude', className: 'usage', open, onToggle, onTitle: onSettings, titleHint: 'Open the Claude settings' }
  if (!s) return null
  if (!s.enabled) {
    return <SideSection {...title}><button className="usage-off" onClick={onSettings}>Claude usage is off</button></SideSection>
  }
  const loading = s.accounts.some((a) => a.usage.loading)
  const last = Math.max(0, ...s.accounts.map((a) => a.usage.usage?.at ?? 0))
  const extra = (
    <>
      {last > 0 && <span className="hint" title={`Last read ${clock(last)}`}>{clock(last)}</span>}
      <button className="usage-refresh" title="Read the usage now" disabled={loading} onClick={() => void api.accountsRefresh()}>
        {loading ? '…' : '↻'}
      </button>
    </>
  )
  return (
    <SideSection {...title} extra={extra}>
      {s.accounts.map((a) => <AccountRows key={a.account.id} view={a} named={s.accounts.length > 1} onSettings={onSettings} />)}
    </SideSection>
  )
}
