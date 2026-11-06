import { useEffect, useState } from 'react'
import type { InstalledExtension } from '../main/domain/extensions'
import { Field, Modal, PageHead } from './Modal'

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Chrome extensions for the browser Tabs, installed from the Chrome Web Store. */
export function ExtensionsPanel() {
  const api = window.workdesk
  const [list, setList] = useState<InstalledExtension[]>([])
  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()

  useEffect(() => void api.extensionsList().then(setList), [api])

  const act = async (what: string, action: () => Promise<InstalledExtension[]>) => {
    setBusy(what)
    setError(undefined)
    try {
      setList(await action())
      return true
    } catch (e) {
      setError(clean(e as Error))
      return false
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <section>
      <PageHead title="Extensions" addLabel="Install an extension" onAdd={() => (setError(undefined), setAdding(true))} />
      <p className="hint">
        Chrome extensions for the browser Tabs, in the WorkDesks and on the Browser page. Open an extension in the Chrome Web Store, copy its
        address and paste it here. Only part of Chrome's extension API exists in WorkDesk: content-script extensions such as ad blockers
        or page tweaks work, those that need Chrome itself (password managers with a desktop app, sync) usually do not. An extension
        sees the pages you open, so install only what you would install in Chrome.
      </p>
      {adding && (
        <Modal
          title="Install an extension"
          submitLabel="Install"
          busy={busy === 'install'}
          error={error}
          canSubmit={!!input.trim()}
          onClose={() => setAdding(false)}
          onSubmit={() => void act('install', () => api.extensionsInstall(input)).then((ok) => ok && (setInput(''), setAdding(false)))}
        >
          <Field label="Chrome Web Store address"><input autoFocus placeholder="https://chromewebstore.google.com/detail/…" value={input} spellCheck={false} onChange={(e) => setInput(e.target.value)} /></Field>
        </Modal>
      )}
      {error && !adding && <div className="error" onClick={() => setError(undefined)}>{error}</div>}
      {list.length === 0 ? (
        <p className="empty">No extensions installed.</p>
      ) : (
        <>
          {list.map((x) => (
            <div key={x.id} className="pr-row">
              <span className="pr-title" title={x.id}>{x.name}</span>
              <span className="chip small">{x.version}</span>
              <span className="actions">
                <button disabled={!!busy} onClick={() => void act(x.id, () => api.extensionsRemove(x.id))}>{busy === x.id ? 'Removing…' : 'Remove'}</button>
              </span>
            </div>
          ))}
          <p><button disabled={!!busy} onClick={() => void act('update', () => api.extensionsUpdate())}>{busy === 'update' ? 'Updating…' : 'Check for updates'}</button></p>
        </>
      )}
    </section>
  )
}
