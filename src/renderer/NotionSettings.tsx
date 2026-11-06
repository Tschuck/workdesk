import { useCallback, useEffect, useState } from 'react'
import type { NotionConfig } from '../main/sources/notion/board'
import type { NotionState } from '../main/sources/notion/service'
import { Field, Modal } from './Modal'

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function Connection({ n, apply, fail }: { n: NotionState; apply: (s: NotionState) => void; fail: (e: unknown) => void }) {
  const api = window.workdesk
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [editing, setEditing] = useState(false)
  const { configured, connected, redirectUri } = n.status

  return (
    <div className="panel">
      <h3>Connection</h3>
      <p className="hint">
        Notion is connected with your own integration (OAuth). In Notion, create an integration with the type <strong>Public</strong>, add
        <code> {redirectUri} </code> as redirect URI, and paste its OAuth client id and secret here. Both are stored in the macOS Keychain.
      </p>
      {editing && (
        <Modal
          title="Notion OAuth client"
          submitLabel="Save client"
          canSubmit={!!clientId.trim() && !!secret.trim()}
          onClose={() => (setEditing(false), setSecret(''))}
          onSubmit={() => void api.notionSaveClient(clientId, secret).then((s) => (setSecret(''), setEditing(false), apply(s)), fail)}
        >
          <Field label="Client id"><input autoFocus placeholder={configured ? 'stored; enter a new one to replace' : ''} value={clientId} spellCheck={false} onChange={(e) => setClientId(e.target.value)} /></Field>
          <Field label="Client secret"><input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} /></Field>
        </Modal>
      )}
      <p className="actions">
        {waiting ? (
          <>
            <span className="hint">Approve the connection in the browser…</span>
            <button onClick={() => void api.notionCancelConnect()}>Cancel</button>
          </>
        ) : (
          <>
            {(!configured || !connected) && <button onClick={() => setEditing(true)}>{configured ? 'Change client …' : 'Set client …'}</button>}
            <button
              disabled={!configured}
              onClick={() => {
                setWaiting(true)
                void api.notionConnect().then(apply, fail).finally(() => setWaiting(false))
              }}
            >
              {connected ? 'Reconnect' : 'Connect Notion'}
            </button>
            {connected && <button onClick={() => void api.notionDisconnect().then(apply, fail)}>Disconnect</button>}
            <span className={connected ? 'badge' : 'chip small'}>{connected ? 'connected' : configured ? 'client saved, not connected' : 'no client yet'}</span>
          </>
        )}
      </p>
    </div>
  )
}

export function Mapping({ config, save }: { config: NotionConfig; save: (c: NotionConfig) => void }) {
  const [c, setC] = useState(config)
  useEffect(() => setC(config), [config])
  const field = (key: 'databaseId' | 'sprintProperty' | 'assigneeProperty' | 'statusProperty' | 'tagsProperty' | 'epicProperty' | 'currentSprintStatus', label: string) => (
    <label className="field"><span>{label}</span><input value={c[key]} onChange={(e) => setC({ ...c, [key]: e.target.value })} /></label>
  )
  return (
    <details className="panel" open={!config.databaseId}>
      <summary>Board mapping {!config.databaseId && <span className="chip small">database id missing</span>}</summary>
      <div className="fields">
        {field('databaseId', 'Tasks database id')}
        {field('sprintProperty', 'Sprint relation (empty: no sprint filter)')}
        {field('currentSprintStatus', 'Status of the active sprint')}
        {field('assigneeProperty', 'Assignee property')}
        {field('statusProperty', 'Status property')}
        {field('tagsProperty', 'Tags property')}
        {field('epicProperty', 'Epic relation (empty: no epics)')}
        <label className="field">
          <span>Tabs for statuses outside the sprint</span>
          <input value={c.pipelineStatuses.join(', ')} onChange={(e) => setC({ ...c, pipelineStatuses: e.target.value.split(',') })} />
        </label>
        <label className="field">
          <span>Closed statuses (hidden)</span>
          <input value={c.closedStatuses.join(', ')} onChange={(e) => setC({ ...c, closedStatuses: e.target.value.split(',') })} />
        </label>
      </div>
      <button onClick={() => save(c)}>Save mapping</button>
    </details>
  )
}

/** Settings → Notion: the connection (OAuth) and where the board lives. */
export function NotionSettings() {
  const api = window.workdesk
  const [n, setN] = useState<NotionState>()
  const [error, setError] = useState<string>()
  const apply = useCallback((s: NotionState) => (setN(s), setError(undefined)), [])
  const fail = useCallback((e: unknown) => setError(clean(e as Error)), [])
  useEffect(() => void api.notionState(false).then(setN, fail), [api, fail])
  if (!n) return <section><h2>Notion</h2>{error ? <div className="error">{error}</div> : <p className="hint">Loading…</p>}</section>
  return (
    <section>
      <h2>Notion</h2>
      <Connection n={n} apply={apply} fail={fail} />
      <Mapping config={n.config} save={(c) => void api.notionSetConfig(c).then(apply, fail)} />
      {error && <div className="error" onClick={() => setError(undefined)}>{error}</div>}
    </section>
  )
}
