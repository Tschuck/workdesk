import { useEffect, useState } from 'react'
import type { FileRoot } from '../main/files'
import { Field, Modal } from './Modal'

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** A new note: a Markdown file in the notes (or knowledge) folder of a WorkDesk, or of the Files page. A name without a dot becomes `.md`; folders are made. */
export function NewNote({ deskId, onCreated, onClose }: { deskId: string; onCreated: (path: string) => void; onClose: () => void }) {
  const api = window.workdesk
  const [roots, setRoots] = useState<FileRoot[]>([])
  const [where, setWhere] = useState<string>()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => void api.filesRoots(deskId).then((r) => setRoots(r.filter((x) => !x.scratch)), () => setRoots([])), [api, deskId])
  // notes first, then knowledge; a Branch's folder is a choice you make on purpose
  const target = roots.find((r) => r.path === where) ?? roots.find((r) => r.label === 'notes') ?? roots.find((r) => r.label === 'knowledge') ?? roots[0]

  const create = async () => {
    const clean0 = name.trim()
    if (!target || !clean0) return
    const file = clean0.split('/').pop()!.includes('.') ? clean0 : `${clean0}.md`
    setBusy(true)
    setError(undefined)
    try {
      onCreated(await api.filesCreate(deskId, target.path, file))
    } catch (e) {
      setError(clean(e))
      setBusy(false)
    }
  }

  return (
    <Modal title="New note" submitLabel="Create" busy={busy} error={error} canSubmit={!!name.trim() && !!target} onClose={onClose} onSubmit={() => void create()}>
      <Field label="Name" hint="name.md, or folder/name.md; without a dot it becomes .md">
        <input autoFocus value={name} placeholder="meeting-notes" onChange={(e) => (setName(e.target.value), setError(undefined))} />
      </Field>
      {roots.length > 1 && (
        <Field label="Folder">
          <select value={target?.path ?? ''} onChange={(e) => setWhere(e.target.value)}>
            {roots.map((r) => (
              <option key={r.path} value={r.path}>{r.label}</option>
            ))}
          </select>
        </Field>
      )}
    </Modal>
  )
}
