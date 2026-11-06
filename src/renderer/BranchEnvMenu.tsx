import { useState } from 'react'
import type { EnvActionResult } from '../main/projects/projects-service'

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function summary(r: EnvActionResult): string {
  const parts = [
    r.synced.length > 0 && `stored ${r.synced.length} file(s)`,
    r.linked.length > 0 && `linked ${r.linked.length} file(s)`,
    r.conflicts.length > 0 && `kept different local file(s): ${r.conflicts.join(', ')}`,
    r.failed && 'setup command failed'
  ].filter(Boolean)
  return parts.length > 0 ? (parts as string[]).join('; ') : 'nothing to do'
}

/** `.env` actions of one Branch: store its files, link the stored ones, regenerate. */
export function BranchEnvMenu({ deskId, project, branch }: { deskId: string; project: string; branch: string }) {
  const api = window.workdesk
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const [output, setOutput] = useState<string>()
  const [conflicts, setConflicts] = useState(false)

  const run = async (action: () => Promise<EnvActionResult>) => {
    setBusy(true)
    setOutput(undefined)
    try {
      const r = await action()
      setMessage(summary(r))
      setConflicts(r.conflicts.length > 0)
      setOutput(r.output)
    } catch (e) {
      setMessage(clean(e as Error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        className="stack-btn"
        title=".env files of this Branch"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(!open)
        }}
      >
        env
      </button>
      {open && (
        <div className="env-menu" onClick={(e) => e.stopPropagation()}>
          <button disabled={busy} title="Copy this Branch's .env files into the store" onClick={() => void run(() => api.envSync(deskId, project, branch))}>
            Store
          </button>
          <button disabled={busy} title="Link the stored .env files into this Branch" onClick={() => void run(() => api.envLink(deskId, project, branch))}>
            Link
          </button>
          {conflicts && (
            <button disabled={busy} title="Replace the differing local files by links" onClick={() => void run(() => api.envLink(deskId, project, branch, true))}>
              Force link
            </button>
          )}
          <button disabled={busy} title="Run the Project's setup commands, then store the result" onClick={() => void run(() => api.envSetup(deskId, project, branch))}>
            {busy ? 'Running…' : 'Regenerate'}
          </button>
          {message && <div className="env-msg">{message}</div>}
          {output && <pre className="env-out">{output}</pre>}
        </div>
      )}
    </>
  )
}
