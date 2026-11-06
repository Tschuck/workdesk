import { useState } from 'react'
import { decodeJwt, jwtFileText } from '../main/domain/jwt'
import { Field, Modal } from './Modal'

/** Paste a JWT: it is decoded (nothing is verified) and shown as a scratch file, so it can be searched, copied from and kept while you work. */
export function JwtModal({ deskId, onOpen, onClose }: { deskId: string; onOpen: (path: string) => void; onClose: () => void }) {
  const api = window.workdesk
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  // what is wrong with it, while typing (nothing before something was pasted)
  let problem: string | undefined
  if (text.trim()) {
    try {
      decodeJwt(text)
    } catch (e) {
      problem = (e as Error).message
    }
  }

  const open = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const decoded = decodeJwt(text)
      let path = await api.filesNewScratch(deskId)
      await api.filesWrite(deskId, path, jwtFileText(decoded))
      // a name that says what it is, and highlighted as JSON; the first free name is kept when that one is taken
      const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '')
      path = await api.filesRename(deskId, path, `jwt-${stamp}.json`).catch(() => path)
      onOpen(path)
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setBusy(false)
    }
  }

  return (
    <Modal title="Analyse a JWT" submitLabel="Decode and open" busy={busy} error={error ?? problem} canSubmit={!!text.trim() && !problem} wide onClose={onClose} onSubmit={() => void open()}>
      <Field label="The token" hint="A JWT, an SD-JWT with its disclosures, or a line such as “Bearer …”. It is only read, never checked or sent anywhere.">
        <textarea
          autoFocus
          rows={8}
          spellCheck={false}
          placeholder="eyJhbGciOiJFUzI1NiIs…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), !problem && text.trim() && void open())}
          style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}
        />
      </Field>
    </Modal>
  )
}
