import { useEffect, useState } from 'react'
import { perDomainOf, withSiteBlocking, type BlockLevel, type BrowserSession, type BrowserSessionsConfig } from '../main/domain/browser-sessions'
import type { Grant } from '../main/domain/page-origin'
import { loadBrowserSessions, setBrowserSessions } from './browser-sessions'
import { Field, Modal, PageHead } from './Modal'

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const LEVELS: { level: BlockLevel; title: string; text: string }[] = [
  { level: 'off', title: 'No blocking', text: 'Pages load everything they ask for.' },
  { level: 'trackers', title: 'Block trackers', text: 'Requests to known trackers are cancelled before they are sent (EasyPrivacy).' },
  { level: 'ads', title: 'Block trackers and ads', text: 'Trackers and ads are cancelled (EasyList, EasyPrivacy, Fanboy Annoyances, Peter Lowe).' }
]
const WHAT = { camera: 'camera', microphone: 'microphone', screen: 'screen' } as const

/** The browser sessions config, loaded when the panel opens and saved as a whole. */
function useSessionsConfig() {
  const [config, setConfig] = useState<BrowserSessionsConfig>()
  const [error, setError] = useState<string>()
  useEffect(() => void loadBrowserSessions().then(setConfig), [])
  const save = async (next: BrowserSessionsConfig): Promise<BrowserSessionsConfig | undefined> => {
    try {
      const saved = await window.workdesk.browserSessionsSet(next)
      setBrowserSessions(saved)
      setConfig(saved)
      setError(undefined)
      return saved
    } catch (e) {
      setError(clean(e as Error))
      return undefined
    }
  }
  return { config, error, setError, save }
}

/** Settings → Browser → Security: how much of the web's tracking and ads the pages are shielded from. */
export function TrackerBlockingPanel() {
  const { config, error, setError, save } = useSessionsConfig()
  if (!config) return null
  const level = config.blocking ?? 'off'
  return (
    <section>
      <h2>Tracker and ad blocking</h2>
      <p className="hint">
        The default level of protection for every page in the Browser; a site can have its own, set in its Site settings. Blocked requests never leave the app. The lists are downloaded when a level
        is first chosen and renewed weekly. Pages that are open need a reload.
      </p>
      {error && <div className="error" onClick={() => setError(undefined)}>{error}</div>}
      <div className="block-levels" role="radiogroup" aria-label="Blocking level">
        {LEVELS.map((l) => (
          <label key={l.level} className={`panel block-level${level === l.level ? ' selected' : ''}`}>
            <input type="radio" name="block-level" checked={level === l.level} onChange={() => void save({ ...config, blocking: l.level })} />
            <span><strong>{l.title}</strong><br /><span className="hint">{l.text}</span></span>
          </label>
        ))}
      </div>
      {Object.entries(config.siteBlocking ?? {}).map(([site, l]) => (
        <div key={site} className="pr-row">
          <span className="pr-title">{site}</span>
          <span className="chip small">{LEVELS.find((x) => x.level === l)?.title}</span>
          <span className="actions"><button title="Block on this site like on all pages" onClick={() => void save(withSiteBlocking(config, site, undefined))}>Like all pages</button></span>
        </div>
      ))}
    </section>
  )
}

/** Settings → Browser → Security: the sites that may use camera, microphone and screen sharing. */
export function SitePermissionsPanel() {
  const api = window.workdesk
  const [grants, setGrants] = useState<Grant[]>([])
  useEffect(() => void api.pagePermissionsList().then(setGrants), [api])
  return (
    <section>
      <h2>Camera, microphone and screen</h2>
      <p className="hint">A site asks the first time it wants them (for a meeting, say). What you allow is kept per site, here you can take it back.</p>
      {grants.length === 0 ? <p className="empty">No site is allowed yet.</p> : grants.map((g) => (
        <div key={g.origin + g.permission} className="pr-row">
          <span className="pr-title">{g.origin}</span>
          <span className="chip small">{WHAT[g.permission]}</span>
          <span className="actions"><button onClick={() => void api.pagePermissionsRevoke(g.origin, g.permission).then(setGrants)}>Take back</button></span>
        </div>
      ))}
    </section>
  )
}

/** Settings → Browser → Sessions: which domains get a browser session (cookies, logins) of their own. */
export function BrowserSessionsPanel() {
  const api = window.workdesk
  const { config, error, setError, save } = useSessionsConfig()
  const [draft, setDraft] = useState<BrowserSession[]>([])
  const [note, setNote] = useState<string>()
  const [adding, setAdding] = useState<{ name: string; domains: string }>()
  useEffect(() => {
    if (config) setDraft((d) => (d.length === 0 ? config.sessions : d))
  }, [config])

  if (!config) return null
  const dirty = JSON.stringify(draft.map((s) => [s.id, s.name, s.domains])) !== JSON.stringify(config.sessions.map((s) => [s.id, s.name, s.domains]))
  const edit = (i: number, patch: Partial<BrowserSession>) => setDraft(draft.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const saveRules = async () => {
    const saved = await save({ ...config, sessions: draft.filter((s) => s.name.trim() || s.domains.length > 0) })
    if (saved) {
      setDraft(saved.sessions)
      setNote('Saved. Pages that are open keep their session until they go to another address.')
    }
  }
  const forget = async (id: string | undefined, name: string) => {
    if (!window.confirm(`Sign out of everything in "${name}"? Cookies, logins and site data of its pages are deleted.`)) return
    await api.browserSessionsClear(id).then(() => setNote(`Cleared "${name}".`), (e) => setError(clean(e as Error)))
  }

  return (
    <section>
      <PageHead title="Browser sessions" addLabel="Add a session" onAdd={() => setAdding({ name: '', domains: '' })} />
      <p className="hint">
        Cookies, logins and site data are kept per session. By default every site (<code>github.com</code>, with its subdomains such as
        <code>gist.github.com</code>) has a session of its own and shares nothing with the others; a rule below puts several domains into one
        session, for example everything of Google, so that one login serves them all. A page that goes to a domain of another session
        opens there (so a "Sign in with Google" from another site works, it just changes sessions on the way). <code>github.com</code> is exactly that host, <code>*.google.com</code> is google.com and everything
        below it. Add <code>www.github.com</code> too if you use it. A domain can be in <strong>several sessions</strong> (a private and a work login of the same site: name it in both): a page that opens on it asks which session to use before it loads, and the session shown next to the address changes it later.
      </p>
      <label className="check">
        <input type="checkbox" checked={perDomainOf(config)} onChange={(e) => void save({ ...config, perDomain: e.target.checked })} /> Every site has a session of its own
      </label>
      <p className="hint">
        {perDomainOf(config)
          ? 'Sites that no rule names are kept apart from each other.'
          : 'Off: every site that no rule names shares one session (the shared session), as before. Pages that are open keep theirs until they go to another address.'}
      </p>
      {error && <div className="error" onClick={() => setError(undefined)}>{error}</div>}
      {note && <p className="hint" onClick={() => setNote(undefined)}>{note}</p>}
      {draft.map((s, i) => (
        <div key={s.id + i} className="panel session-rule">
          <div className="fields">
            <label className="field"><span>Session name</span><input value={s.name} onChange={(e) => edit(i, { name: e.target.value })} placeholder="Google" /></label>
            <label className="field">
              <span>Domains, one per line</span>
              <textarea
                rows={Math.max(2, s.domains.length + 1)}
                value={s.domains.join('\n')}
                placeholder={'*.google.com'}
                onChange={(e) => edit(i, { domains: e.target.value.split('\n') })}
              />
            </label>
          </div>
          <p className="actions">
            <button onClick={() => setDraft(draft.filter((_, j) => j !== i))}>Remove rule</button>
            <button disabled={dirty} title={dirty ? 'Save the rules first' : 'Delete cookies, logins and site data of this session'} onClick={() => void forget(s.id, s.name)}>Sign out everywhere</button>
          </p>
        </div>
      ))}
      {adding && (
        <Modal
          title="Add a session"
          canSubmit={!!adding.name.trim() && !!adding.domains.trim()}
          onClose={() => setAdding(undefined)}
          onSubmit={() => void save({ ...config, sessions: [...config.sessions, { id: '', name: adding.name.trim(), domains: adding.domains.split('\n').map((d) => d.trim()).filter(Boolean) }] }).then((saved) => {
            if (!saved) return
            setDraft(dirty ? [...draft, saved.sessions[saved.sessions.length - 1]] : saved.sessions)
            setNote('Saved. Pages that are open keep their session until they go to another address.')
            setAdding(undefined)
          })}
        >
          <Field label="Session name"><input autoFocus placeholder="Google" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} /></Field>
          <Field label="Domains, one per line"><textarea rows={4} placeholder={'*.google.com'} value={adding.domains} onChange={(e) => setAdding({ ...adding, domains: e.target.value })} /></Field>
        </Modal>
      )}
      <p className="actions">
        <button className="primary" disabled={!dirty} onClick={() => void saveRules()}>Save</button>
        <button disabled={dirty} title="Delete cookies, logins and site data of the shared session (the sites that have no session of their own)" onClick={() => void forget(undefined, 'Shared session')}>Sign out of the shared session</button>
      </p>
    </section>
  )
}
