import { useEffect, useState } from 'react'

/** Settings → Browser → Security: the pages visited in the browser are remembered on this machine (only) for suggestions; this switches that off and clears it. */
export function HistoryPanel() {
  const api = window.workdesk
  const [state, setState] = useState<{ enabled: boolean; count: number }>()
  useEffect(() => void api.historyState().then(setState), [api])
  if (!state) return null
  return (
    <section>
      <h2>Browsing history</h2>
      <p className="hint">
        The pages you visit in the browser are remembered on this machine only (never in the Status Repo), so the address bar and the new tab picker can suggest them as you type.
      </p>
      <label className="check">
        <input type="checkbox" checked={state.enabled} onChange={(e) => void api.historySet(e.target.checked).then(setState)} /> Remember the pages I visit
      </label>
      <p className="actions">
        <span className="hint">{state.count} page{state.count === 1 ? '' : 's'} remembered.</span>{' '}
        <button
          disabled={state.count === 0}
          onClick={() => window.confirm('Forget every page you visited?') && void api.historyClear().then(setState)}
        >
          Clear history
        </button>
      </p>
    </section>
  )
}
