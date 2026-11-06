import { useEffect, useState } from 'react'
import { Field, Modal } from './Modal'

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Where the Status Repo (Todos, notes, archive) is pushed to: a git remote of your own. */
export function StatusRepoPanel({ repoId }: { repoId?: string } = {}) {
  const api = window.workdesk
  const [saved, setSaved] = useState<string | null>()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean }>()

  useEffect(() => {
    void api.statusRemote(repoId).then((u) => (setSaved(u), setUrl(u ?? '')))
  }, [api, repoId])

  const save = async () => {
    setBusy(true)
    setMessage(undefined)
    try {
      const now = await api.setStatusRemote(url, repoId)
      setSaved(now)
      setUrl(now ?? '')
      setMessage({ text: now ? 'Pushed. From now on changes are committed and pushed in the background.' : 'Remote removed; the repo stays local.' })
      setEditing(false)
    } catch (e) {
      // the check runs first, so a failure here means the remote was not changed (or only the first push failed)
      setMessage({ text: clean(e as Error), error: true })
      void api.statusRemote(repoId).then(setSaved)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <h3>Status Repo backup</h3>
      <p className="hint">
        Your Todos, notes and archive live in a git repo on this machine. Give it a remote (an empty repository you created, e.g. on GitHub) to keep a copy and share it between machines. Tokens and the <code>.env</code> store are never pushed.
      </p>
      <p>
        {saved ? <>Pushing to <code>{saved}</code>.</> : <span className="hint">Local only, no remote.</span>}{' '}
        <button disabled={saved === undefined} onClick={() => (setMessage(undefined), setEditing(true))}>{saved ? 'Change remote …' : 'Set remote …'}</button>
      </p>
      {message && !editing && <p className={message.error ? 'error-text' : 'hint'}>{message.text}</p>}
      {editing && (
        <Modal
          title="Backup remote of the Status Repo"
          submitLabel={busy ? 'Checking …' : url.trim() ? 'Save and push' : 'Remove remote'}
          canSubmit={saved !== undefined && url.trim() !== (saved ?? '')}
          busy={busy}
          error={message?.error ? message.text : undefined}
          onClose={() => (setEditing(false), setUrl(saved ?? ''))}
          onSubmit={() => void save()}
        >
          <Field label="Remote address" hint="An empty repository you created. Leave empty to remove the remote.">
            <input autoFocus placeholder="git@github.com:you/workdesk-status.git" value={url} spellCheck={false} onChange={(e) => setUrl(e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
